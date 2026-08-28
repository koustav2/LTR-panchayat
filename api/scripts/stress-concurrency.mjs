/**
 * Forces the gap-lock deadlock that db.js's transaction retry exists for.
 *
 *   BASE=http://localhost:4000 node scripts/stress-concurrency.mjs
 *   N=20 ROUNDS=6 node scripts/stress-concurrency.mjs
 *
 * A fresh Aadhaar has no `beneficiaries` row yet, so every concurrent
 * submission takes a *gap* lock on the unique index; gap locks are mutually
 * compatible, and then each of those transactions tries to INSERT into the same
 * gap. InnoDB picks victims and returns ER_LOCK_DEADLOCK.
 *
 * That is expected. What must not happen is a field worker seeing a 500, or two
 * applications sharing a reference number. Every request here must come back
 * 201, and every reference number must be unique.
 *
 * The smoke test's 8-way burst covers the same ground more gently; this one is
 * for when the locking behaviour itself is under suspicion.
 */
const BASE = process.env.BASE || 'http://localhost:4000';
const N = Number(process.env.N || 20);
const ROUNDS = Number(process.env.ROUNDS || 6);

let cookie = '';
async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  if (sc.length) cookie = sc.map((c) => c.split(';')[0]).join('; ');
  const t = await res.text();
  return { status: res.status, body: t ? JSON.parse(t) : null };
}

await call('POST', '/api/auth/login', { username: 'sup.dharma', password: 'Sup@2026#DHM' });
const m = (await call('GET', '/api/master/bootstrap')).body;
const block = m.blocks[0];
const panchayat = m.panchayats.find((p) => p.block_id === block.id);
const type = m.supportTypes[0];
const reason = m.supportReasons.find((r) => r.support_type_id === type.id);

let bad = 0;
const allRefs = new Set();

for (let round = 1; round <= ROUNDS; round += 1) {
  // A different Aadhaar each round, so every round starts from "this person
  // does not exist yet" — which is the case that deadlocks. Twelve digits,
  // never starting 0 or 1; the validator rejects both.
  const aadhaar = String(2e11 + Math.floor(Math.random() * 7e11));

  const results = await Promise.all(
    Array.from({ length: N }, (_, i) =>
      call('POST', '/api/applications', {
        aadhaar,
        fullName: `Burst ${round}-${i}`,
        guardianName: 'Guardian',
        phone: '9876543210',
        blockId: block.id,
        panchayatId: panchayat.id,
        pinCode: '753001',
        supportTypeId: type.id,
        supportReasonId: reason.id,
        amount: '1000',
        ppRecommend: 'yes', msRecommend: 'yes', mpRecommend: 'yes',
        acknowledgeDuplicate: true,
      })
    )
  );

  const codes = results.map((r) => r.status);
  const created = results.filter((r) => r.status === 201);
  created.forEach((r) => allRefs.add(r.body.application.referenceNo));

  const fails = codes.filter((c) => c >= 500);
  bad += fails.length;

  const other = results.find((r) => r.status !== 201);
  if (created.length !== N && other) {
    console.log('   first non-201:', other.status, JSON.stringify(other.body));
  }
  console.log(
    `round ${round}: ${created.length}/${N} created, 5xx=${fails.length}` +
      (fails.length ? `  codes=${JSON.stringify(codes)}` : '')
  );
}

const ok = bad === 0 && allRefs.size === N * ROUNDS;
console.log(`\nunique reference numbers: ${allRefs.size} (expected ${N * ROUNDS})`);
console.log(ok ? 'PASS — no 5xx, no duplicate reference numbers' : 'FAIL');
process.exit(ok ? 0 : 1);
