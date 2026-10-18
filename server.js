require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');

const pool = require('./db');
const { recordSchema } = require('./validation');
const { classifyAndStore, logIntake } = require('./dedup');

if (!process.env.API_KEY || process.env.API_KEY.length < 16) {
  throw new Error('API_KEY must be set to at least 16 characters in .env');
}

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(express.json({ limit: '200kb' }));

// Simple shared-key guard so strangers cannot write to or read from the database.
function requireApiKey(req, res, next) {
  const given = Buffer.from(String(req.headers['x-api-key'] || ''));
  const expected = Buffer.from(process.env.API_KEY);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: 'Invalid or missing API key' });
  }
  next();
}

const HTTP_STATUS = { unique: 201, false_positive: 201, redundant: 409, invalid: 400 };

// Validate, then classify and (only if verified as new) store one record.
async function processOne(body) {
  const { error, value } = recordSchema.validate(body, { abortEarly: false, stripUnknown: true });
  if (error) {
    const fields = [...new Set(error.details.map((d) => d.path.join('.') || 'record'))];
    const reason = `Invalid ${fields.join(', ')}`;
    await logIntake('invalid', body, { reason });
    return { status: 'invalid', reason };
  }
  return classifyAndStore({ ...value, phone: value.phone || null });
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.post('/records', requireApiKey, async (req, res, next) => {
  try {
    const result = await processOne(req.body);
    res.status(HTTP_STATUS[result.status]).json(result);
  } catch (err) {
    next(err);
  }
});

// Submit up to 100 records at once; each is classified independently.
app.post('/records/bulk', requireApiKey, async (req, res, next) => {
  try {
    const items = req.body && req.body.records;
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
      return res.status(400).json({ error: 'Send {"records": [...]} with 1 to 100 items' });
    }
    const summary = { total: items.length, unique: 0, false_positive: 0, redundant: 0, invalid: 0 };
    const results = [];
    for (let i = 0; i < items.length; i++) {
      const r = await processOne(items[i]);
      summary[r.status] += 1;
      results.push({ index: i, email: (items[i] && items[i].email) || null, ...r });
    }
    summary.inserted = summary.unique + summary.false_positive;
    res.json({ summary, results });
  } catch (err) {
    next(err);
  }
});

app.get('/records', requireApiKey, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, full_name, email, phone, city, created_at FROM records ORDER BY id DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

app.get('/stats', requireApiKey, async (req, res, next) => {
  try {
    const [[{ total }]] = await pool.execute('SELECT COUNT(*) AS total FROM records');
    const [rows] = await pool.execute('SELECT status, COUNT(*) AS count FROM intake_log GROUP BY status');
    const intake = { unique: 0, false_positive: 0, redundant: 0, invalid: 0 };
    rows.forEach((r) => { intake[r.status] = Number(r.count); });
    res.json({ totalRecordsStored: Number(total), submissionsByClassification: intake });
  } catch (err) {
    next(err);
  }
});

app.get('/log', requireApiKey, async (req, res, next) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, status, record_id, matched_record_id, similarity, reason, created_at FROM intake_log ORDER BY id DESC LIMIT 100'
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// Generic error handler: never leak SQL errors or stack traces.
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`DataRedundancy listening on port ${PORT}`));
