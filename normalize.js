// Turns messy input into a standard form so the same real-world value always looks identical.

// john.doe+news@gmail.com and johndoe@gmail.com are the same Gmail inbox.
function normalizeEmail(email) {
  const [localRaw, domainRaw] = String(email).trim().toLowerCase().split('@');
  let local = localRaw;
  let domain = domainRaw;
  if (domain === 'googlemail.com') domain = 'gmail.com';
  if (domain === 'gmail.com') local = local.split('+')[0].replace(/\./g, '');
  return `${local}@${domain}`;
}

// "+91 98765-43210" and "9876543210" both become "9876543210" (last 10 digits).
function normalizePhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  return digits.slice(-10);
}

// "Rahul Sharma" and "sharma, rahul" both become "rahul sharma" (words lowercased and sorted).
function nameKey(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');
}

// Only names that start with the same two letters are compared with each other,
// so the fuzzy check never has to scan the whole table.
function nameBlock(key) {
  return key.replace(/\s/g, '').slice(0, 2);
}

function normalizeCity(city) {
  return String(city)
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

module.exports = { normalizeEmail, normalizePhone, nameKey, nameBlock, normalizeCity };
