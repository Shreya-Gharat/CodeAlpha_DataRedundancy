// Run against your own deployment:  npm test   (reads PORT and API_KEY from .env)
require('dotenv').config();
const BASE = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
const API_KEY = process.env.API_KEY;
let failed = 0;

const rl = (n) => Array.from({ length: n }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('');
const rd = () => '9' + Array.from({ length: 9 }, () => Math.floor(Math.random() * 10)).join('');

async function call(method, path, body, key = API_KEY) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(key ? { 'x-api-key': key } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch (e) {}
  return { status: res.status, data };
}

function check(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failed++;
}

(async () => {
  const T = rl(8);
  const phoneA = rd();
  const A = { fullName: `Riya ${T}`, email: `riya.${T}@example.com`, phone: phoneA, city: 'Mumbai' };

  let r = await call('POST', '/records', A);
  check('New record is stored as unique (201)', r.status === 201 && r.data.status === 'unique');

  r = await call('POST', '/records', A);
  check('Exact resubmission is rejected as redundant (409)', r.status === 409 && r.data.status === 'redundant');

  r = await call('POST', '/records', {
    fullName: `Other ${rl(8)}`, email: `RIYA.${T.toUpperCase()}@EXAMPLE.COM`, phone: rd(), city: 'Delhi',
  });
  check('Same email in different letter case is redundant', r.status === 409 && /email/i.test(r.data.reason));

  const G = rl(8);
  r = await call('POST', '/records', { fullName: `Gita ${rl(8)}`, email: `t${G}.x@gmail.com`, phone: rd(), city: 'Pune' });
  check('Gmail record is stored as unique', r.status === 201);
  r = await call('POST', '/records', {
    fullName: `Other ${rl(8)}`, email: `t${G}x+promo@gmail.com`, phone: rd(), city: 'Chennai',
  });
  check('Gmail dot/plus variant is redundant', r.status === 409 && /email/i.test(r.data.reason));

  r = await call('POST', '/records', {
    fullName: `Other ${rl(8)}`, email: `o${rl(8)}@example.com`,
    phone: `+91 ${phoneA.slice(0, 5)}-${phoneA.slice(5)}`, city: 'Chennai',
  });
  check('Same phone in a different format is redundant', r.status === 409 && /phone/i.test(r.data.reason));

  r = await call('POST', '/records', {
    fullName: `Riya ${T}a`, email: `x${rl(8)}@example.com`, phone: rd(), city: 'Mumbai',
  });
  check('Very similar name in the same city is redundant', r.status === 409 && /similar/i.test(r.data.reason));

  r = await call('POST', '/records', {
    fullName: `Riya ${T}`, email: `y${rl(8)}@example.com`, phone: rd(), city: 'Pune',
  });
  check('Same name in a different city is a false positive and is stored (201)',
    r.status === 201 && r.data.status === 'false_positive');

  r = await call('POST', '/records', { fullName: `Bad ${rl(6)}`, email: 'not-an-email', city: 'Mumbai' });
  check('Invalid email is rejected (400)', r.status === 400 && r.data.status === 'invalid');

  r = await call('POST', '/records', {
    fullName: "Robert'); DROP TABLE records;--", email: `z${rl(8)}@example.com`, city: 'Mumbai',
  });
  check('SQL injection string in the name is rejected (400)', r.status === 400);
  r = await call('GET', '/records');
  check('Records table still exists after the injection attempt', r.status === 200 && Array.isArray(r.data));

  r = await call('POST', '/records/bulk', {
    records: [
      { fullName: `Kiran ${rl(8)}`, email: `k${rl(8)}@example.com`, phone: rd(), city: 'Nagpur' },
      A,
      { fullName: `Meera ${rl(8)}`, email: `m${rl(8)}@example.com`, phone: rd(), city: 'Surat' },
      { fullName: 'No Email', email: '', city: 'Goa' },
    ],
  });
  const s = r.data && r.data.summary;
  check('Bulk upload classifies every record (2 unique, 1 redundant, 1 invalid)',
    r.status === 200 && s.unique === 2 && s.redundant === 1 && s.invalid === 1 && s.inserted === 2);

  const C = { fullName: `Conc ${rl(8)}`, email: `c${rl(8)}@example.com`, phone: rd(), city: 'Surat' };
  const parallel = await Promise.all(Array.from({ length: 5 }, () => call('POST', '/records', C)));
  const codes = parallel.map((p) => p.status);
  check('5 simultaneous identical submissions: exactly 1 stored, 4 rejected',
    codes.filter((c) => c === 201).length === 1 && codes.filter((c) => c === 409).length === 4);

  r = await call('GET', '/stats');
  check('Stats endpoint reports stored records', r.status === 200 && r.data.totalRecordsStored > 0);

  r = await call('GET', '/records', null, null);
  check('Request without API key is rejected (401)', r.status === 401);

  console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
})();
