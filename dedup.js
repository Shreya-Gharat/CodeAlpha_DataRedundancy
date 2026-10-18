const pool = require('./db');
const { normalizeEmail, normalizePhone, nameKey, nameBlock, normalizeCity } = require('./normalize');
const { similarity } = require('./similarity');

// Names at least this similar are flagged as possible duplicates.
const SIMILARITY_THRESHOLD = 0.85;

async function logIntake(status, input, { recordId, matchedId, score, reason } = {}) {
  try {
    await pool.execute(
      'INSERT INTO intake_log (status, submitted, record_id, matched_record_id, similarity, reason) VALUES (?, ?, ?, ?, ?, ?)',
      [
        status,
        JSON.stringify(input ?? null).slice(0, 1000),
        recordId ?? null,
        matchedId ?? null,
        score != null ? Number(score.toFixed(3)) : null,
        (reason ?? '').slice(0, 255),
      ]
    );
  } catch (e) {
    console.error('Failed to write intake log:', e.message);
  }
}

async function finish(status, input, details) {
  await logIntake(status, input, details);
  return {
    status,
    recordId: details.recordId ?? null,
    matchedRecordId: details.matchedId ?? null,
    similarity: details.score != null ? Number(details.score.toFixed(3)) : null,
    reason: details.reason,
  };
}

async function findStrongMatch(emailNorm, phoneNorm) {
  const [rows] = await pool.execute(
    'SELECT id, email_norm, phone_norm FROM records WHERE email_norm = ? OR phone_norm = ? LIMIT 1',
    [emailNorm, phoneNorm]
  );
  return rows[0] || null;
}

async function attemptOnce(input) {
  const emailNorm = normalizeEmail(input.email);
  const phoneNorm = normalizePhone(input.phone);
  const key = nameKey(input.fullName);
  const block = nameBlock(key);
  const cityNorm = normalizeCity(input.city);

  // Stage 1 - exact check on strong identifiers (indexed lookups, very fast).
  const strong = await findStrongMatch(emailNorm, phoneNorm);
  if (strong) {
    const reason =
      strong.email_norm === emailNorm ? 'Same email address (after normalization)' : 'Same phone number';
    return finish('redundant', input, { matchedId: strong.id, reason });
  }

  // Stage 2 - fuzzy check on the name, only against records in the same name block.
  const [candidates] = await pool.execute(
    'SELECT id, name_key, city_norm FROM records WHERE name_block = ? LIMIT 500',
    [block]
  );
  const flagged = candidates
    .map((c) => ({ ...c, score: similarity(key, c.name_key) }))
    .filter((c) => c.score >= SIMILARITY_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  // Stage 3 - verification. A similar name in the SAME city is a probable duplicate.
  const sameCity = flagged.find((c) => c.city_norm === cityNorm);
  if (sameCity) {
    return finish('redundant', input, {
      matchedId: sameCity.id,
      score: sameCity.score,
      reason: `Very similar name (${Math.round(sameCity.score * 100)}%) in the same city`,
    });
  }

  // Verified as new: append it. The UNIQUE keys catch any duplicate that slipped in concurrently.
  try {
    const [result] = await pool.execute(
      'INSERT INTO records (full_name, email, phone, city, email_norm, phone_norm, name_key, name_block, city_norm) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [input.fullName, input.email, input.phone || null, input.city, emailNorm, phoneNorm, key, block, cityNorm]
    );
    if (flagged.length) {
      // The name looked like a duplicate, but email, phone and city all differ: a false alarm.
      return finish('false_positive', input, {
        recordId: result.insertId,
        matchedId: flagged[0].id,
        score: flagged[0].score,
        reason: 'Similar name flagged, but email, phone and city all differ',
      });
    }
    return finish('unique', input, { recordId: result.insertId, reason: 'No match found' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const dup = await findStrongMatch(emailNorm, phoneNorm);
      return finish('redundant', input, {
        matchedId: dup ? dup.id : null,
        reason: 'Duplicate caught by database unique constraint (concurrent insert)',
      });
    }
    throw err;
  }
}

async function classifyAndStore(input) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await attemptOnce(input);
    } catch (err) {
      // Two simultaneous inserts can occasionally deadlock; retrying is safe.
      if (err.code === 'ER_LOCK_DEADLOCK' && attempt < 2) continue;
      throw err;
    }
  }
}

module.exports = { classifyAndStore, logIntake };
