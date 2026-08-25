#!/usr/bin/env node
'use strict';

/**
 * End-to-end smoke test against a running API.
 *
 *   BASE=http://localhost:4000 npm run smoke
 *
 * Exercises the whole supervisor -> MLA journey with real HTTP requests:
 * login, master data, Aadhaar lookup miss, submit, autofill hit, second
 * application for the same Aadhaar, reference-number uniqueness, search,
 * role scoping, and accept/reject.
 */

const BASE = process.env.BASE || 'http://localhost:4000';

let passed = 0;
let failed = 0;

function check(label, condition, extra) {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label}${extra ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Minimal cookie jar so each role keeps its own session. */
function makeClient() {
  let cookie = '';
  return async function call(method, path, body, opts = {}) {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (body instanceof FormData) {
      payload = body;
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
    const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    setCookie.forEach((c) => {
      cookie = c.split(';')[0];
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    if (opts.raw) return { status: res.status, body: text, headers: res.headers };
    return { status: res.status, body: json };
  };
}

// Aadhaar numbers that satisfy the Verhoeff check digit, so the test passes
// whether or not checksum validation is switched on.
const AADHAAR_A = '999941057058';
const AADHAAR_B = '999971658847';

(async () => {
  const sup = makeClient();
  const mla = makeClient();
  const anon = makeClient();

  section('Auth');
  let r = await anon('GET', '/api/auth/me');
  check('unauthenticated /me is rejected', r.status === 401, r.body);

  r = await sup('POST', '/api/auth/login', { username: 'sup.dharma', password: 'wrong' });
  check('bad password is rejected', r.status === 401, r.body);

  r = await sup('POST', '/api/auth/login', { username: 'sup.dharma', password: 'Sup@2026#DHM' });
  check('supervisor can sign in', r.status === 200 && r.body.user.role === 'supervisor', r.body);

  r = await mla('POST', '/api/auth/login', { username: 'mla', password: 'Mla@2026#LRT' });
  check('MLA can sign in', r.status === 200 && r.body.user.role === 'mla', r.body);

  r = await sup('GET', '/api/auth/me');
  check('/me returns a server date for the form header', !!r.body.serverDate, r.body);

  section('Master data and dependent dropdowns');
  r = await sup('GET', '/api/master/bootstrap');
  const master = r.body;
  check('two blocks are seeded', master.blocks.length === 2, master.blocks);
  check('support types are seeded', master.supportTypes.length === 4);

  const blockDhm = master.blocks.find((b) => b.code === 'DHM');
  const blockRsd = master.blocks.find((b) => b.code === 'RSD');

  r = await sup('GET', `/api/master/panchayats?blockId=${blockDhm.id}`);
  const dhmPanchayats = r.body.panchayats;
  check('panchayats are filtered by block', dhmPanchayats.every((p) => p.block_id === blockDhm.id));

  const eduType = master.supportTypes.find((t) => t.name === 'Education');
  const healthType = master.supportTypes.find((t) => t.name === 'Health');
  r = await sup('GET', `/api/master/support-reasons?typeId=${eduType.id}`);
  const eduReasons = r.body.supportReasons;
  check('reasons are filtered by support type', eduReasons.every((x) => x.support_type_id === eduType.id));
  r = await sup('GET', `/api/master/support-reasons?typeId=${healthType.id}`);
  const healthReasons = r.body.supportReasons;

  section('Validation');
  const badBase = {
    fullName: 'Ramesh Kumar Sahoo',
    guardianName: 'Bhagaban Sahoo',
    phone: '9876543210',
    blockId: blockDhm.id,
    panchayatId: dhmPanchayats[0].id,
    pinCode: '755001',
    supportTypeId: eduType.id,
    supportReasonId: eduReasons[0].id,
    amount: '10000',
    ppRecommend: 'yes',
    msRecommend: 'yes',
    mpRecommend: 'yes',
  };

  r = await sup('POST', '/api/applications', { ...badBase, aadhaar: '12345' });
  check('short Aadhaar is rejected', r.status === 400, r.body);

  r = await sup('POST', '/api/applications', { ...badBase, aadhaar: AADHAAR_A, phone: '1234567890' });
  check('phone not starting 6-9 is rejected', r.status === 400, r.body);

  r = await sup('POST', '/api/applications', { ...badBase, aadhaar: AADHAAR_A, pinCode: '75' });
  check('short PIN is rejected', r.status === 400, r.body);

  r = await sup('POST', '/api/applications', {
    ...badBase,
    aadhaar: AADHAAR_A,
    supportReasonId: healthReasons[0].id,
  });
  check('reason from a different support type is rejected', r.status === 400, r.body);

  r = await sup('POST', '/api/applications', { ...badBase, aadhaar: AADHAAR_A, panchayatId: 9999 });
  check('panchayat outside the chosen block is rejected', r.status === 400, r.body);

  r = await sup('POST', '/api/applications', {
    ...badBase,
    aadhaar: AADHAAR_A,
    ppRecommend: 'no',
    ppComment: '',
  });
  check('"No" without a comment is rejected', r.status === 400, r.body);

  section('Aadhaar lookup — first time');
  r = await sup('GET', `/api/beneficiaries/lookup?aadhaar=${AADHAAR_A}`);
  check('unknown Aadhaar returns found:false', r.body.found === false, r.body);

  section('Submit first application');
  r = await sup('POST', '/api/applications', {
    ...badBase,
    aadhaar: AADHAAR_A,
    fullName: 'Ramesh Kumar Sahoo',
    guardianName: 'Bhagaban Sahoo',
    ppRecommend: 'yes',
    ppComment: 'Family is in genuine need.',
    msRecommend: 'yes',
    msComment: 'Verified.',
    mpRecommend: 'no',
    mpComment: 'Requires further documentation.',
  });
  check('application is created', r.status === 201, r.body);
  const refA = r.body.application && r.body.application.referenceNo;
  check('reference number matches LRT/DHM/<year>/NNNNNN',
    /^LRT\/DHM\/\d{4}\/\d{6}$/.test(refA || ''), refA);
  const appAId = r.body.application && r.body.application.id;

  section('Aadhaar autofill — second time');
  r = await sup('GET', `/api/beneficiaries/lookup?aadhaar=${AADHAAR_A}`);
  check('known Aadhaar returns found:true', r.body.found === true);
  check('autofills name', r.body.beneficiary.fullName === 'Ramesh Kumar Sahoo', r.body.beneficiary);
  check('autofills father/husband name', r.body.beneficiary.guardianName === 'Bhagaban Sahoo');
  check('autofills phone', r.body.beneficiary.phone === '9876543210');
  check('autofills block', r.body.beneficiary.blockId === blockDhm.id);
  check('autofills panchayat', r.body.beneficiary.panchayatId === dhmPanchayats[0].id);
  check('autofills PIN', r.body.beneficiary.pinCode === '755001');
  check('Aadhaar comes back masked', /^XXXX XXXX \d{4}$/.test(r.body.beneficiary.aadhaarMasked));
  check('previous applications are listed', r.body.previousApplications.length === 1);

  section('Same Aadhaar, second application, different support type');
  r = await sup('POST', '/api/applications', {
    ...badBase,
    aadhaar: AADHAAR_A,
    supportTypeId: healthType.id,
    supportReasonId: healthReasons[0].id,
    ppRecommend: 'yes',
    msRecommend: 'yes',
    mpRecommend: 'yes',
  });
  check('a second application for the same Aadhaar is allowed', r.status === 201, r.body);
  const refA2 = r.body.application && r.body.application.referenceNo;
  check('second reference number differs from the first', refA2 && refA2 !== refA, { refA, refA2 });

  section('Duplicate pending guard');
  r = await sup('POST', '/api/applications', {
    ...badBase,
    aadhaar: AADHAAR_A,
    supportTypeId: healthType.id,
    supportReasonId: healthReasons[1].id,
  });
  check('duplicate pending of same type warns with 409', r.status === 409 && r.body.needsAcknowledgement, r.body);

  r = await sup('POST', '/api/applications', {
    ...badBase,
    aadhaar: AADHAAR_A,
    supportTypeId: healthType.id,
    supportReasonId: healthReasons[1].id,
    acknowledgeDuplicate: true,
  });
  check('acknowledging the warning lets it through', r.status === 201, r.body);

  section('Reference number uniqueness under concurrency');
  const burst = await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      sup('POST', '/api/applications', {
        ...badBase,
        aadhaar: AADHAAR_B,
        fullName: `Concurrent Person ${i}`,
        guardianName: 'Concurrent Father',
        supportTypeId: eduType.id,
        supportReasonId: eduReasons[i % eduReasons.length].id,
        acknowledgeDuplicate: true,
      })
    )
  );
  const refs = burst.filter((x) => x.status === 201).map((x) => x.body.application.referenceNo);
  check('all 8 concurrent submissions succeeded', refs.length === 8, burst.map((b) => b.status));
  check('all 8 reference numbers are unique', new Set(refs).size === refs.length, refs);

  section('List and search');
  r = await sup('GET', '/api/applications');
  const supTotal = r.body.total;
  check('supervisor sees their own submissions', supTotal >= 11, r.body.total);
  check('status counts are returned', r.body.counts && typeof r.body.counts.pending === 'number');

  r = await sup('GET', `/api/applications?q=${encodeURIComponent(refA)}`);
  check('search by reference number works', r.body.total === 1 && r.body.applications[0].referenceNo === refA);

  r = await sup('GET', '/api/applications?q=Ramesh');
  check('search by name works', r.body.total >= 1 && r.body.applications[0].fullName.includes('Ramesh'));

  r = await sup('GET', '/api/applications?q=9876543210');
  check('search by phone works', r.body.total >= 1);

  r = await sup('GET', `/api/applications?q=${AADHAAR_A.slice(-4)}`);
  check('search by last 4 Aadhaar digits works', r.body.total >= 1);

  r = await sup('GET', '/api/applications?status=pending');
  check('status filter works', r.body.applications.every((a) => a.status === 'pending'));

  section('Role scoping');
  r = await sup('POST', `/api/applications/${appAId}/status`);
  check('supervisor cannot reach the review endpoint (wrong verb is 404)', r.status === 404);

  r = await sup('PATCH', `/api/applications/${appAId}/status`, { status: 'accepted' });
  check('supervisor is forbidden from reviewing', r.status === 403, r.body);

  r = await sup('GET', '/api/applications/export.csv');
  check('supervisor is forbidden from exporting', r.status === 403, r.body);

  // A second supervisor must not see the first one's forms.
  const sup2 = makeClient();
  await sup2('POST', '/api/auth/login', { username: 'sup.rasul', password: 'Sup@2026#RSD' });
  r = await sup2('GET', '/api/applications');
  check('another supervisor sees none of these forms', r.body.total === 0, r.body.total);
  r = await sup2('GET', `/api/applications/${appAId}`);
  check('another supervisor cannot open the form by id', r.status === 403, r.body);

  r = await mla('GET', '/api/applications');
  check('MLA sees every supervisor’s forms', r.body.total >= supTotal, r.body.total);
  check('MLA list includes who submitted it', !!r.body.applications[0].submittedByName);

  r = await mla('GET', `/api/beneficiaries/lookup?aadhaar=${AADHAAR_A}`);
  check('MLA cannot use the Aadhaar lookup', r.status === 403, r.body);

  section('Detail and Aadhaar reveal');
  r = await mla('GET', `/api/applications/${appAId}`);
  check('detail loads for the MLA', r.status === 200 && r.body.application.referenceNo === refA);
  check('Aadhaar is masked by default', r.body.application.aadhaarFull === null);
  check('all three recommendations are present',
    r.body.application.ppRecommend === 'yes' &&
    r.body.application.msRecommend === 'yes' &&
    r.body.application.mpRecommend === 'no');
  check('the "No" comment is stored', r.body.application.mpComment === 'Requires further documentation.');

  r = await mla('GET', `/api/applications/${appAId}?revealAadhaar=true`);
  check('full Aadhaar can be revealed on demand', r.body.application.aadhaarFull === AADHAAR_A);

  section('Review');
  r = await mla('PATCH', `/api/applications/${appAId}/status`, { status: 'rejected' });
  check('rejecting without a reason is refused', r.status === 400, r.body);

  r = await mla('PATCH', `/api/applications/${appAId}/status`, {
    status: 'rejected',
    rejectionReason: 'Income certificate not attached.',
  });
  check('MLA can reject with a reason', r.status === 200, r.body);

  r = await mla('PATCH', `/api/applications/${appAId}/status`, {
    status: 'accepted',
  });
  check('an already-decided application cannot be re-decided', r.status === 409, r.body);

  r = await sup('GET', `/api/applications/${appAId}`);
  check('supervisor sees the rejection reason',
    r.body.application.status === 'rejected' &&
    r.body.application.rejectionReason === 'Income certificate not attached.', r.body.application);

  const secondApp = (await mla('GET', '/api/applications?status=pending')).body.applications[0];
  r = await mla('PATCH', `/api/applications/${secondApp.id}/status`, { status: 'accepted' });
  check('MLA can accept', r.status === 200, r.body);

  section('Identity snapshot — old forms keep the details they were filed with');
  // Re-submit under the same Aadhaar with a corrected spelling. The beneficiary
  // master record must update (so autofill offers the new spelling) while the
  // earlier application keeps the name it was filed and decided under.
  r = await sup('POST', '/api/applications', {
    ...badBase,
    aadhaar: AADHAAR_A,
    fullName: 'Ramesh Kumar Sahu',
    phone: '9000000001',
    acknowledgeDuplicate: true,
  });
  check('re-submission with corrected details succeeds', r.status === 201, r.body);

  r = await sup('GET', `/api/beneficiaries/lookup?aadhaar=${AADHAAR_A}`);
  check('autofill now offers the corrected name', r.body.beneficiary.fullName === 'Ramesh Kumar Sahu');
  check('autofill now offers the corrected phone', r.body.beneficiary.phone === '9000000001');

  r = await sup('GET', `/api/applications/${appAId}`);
  check('the earlier application keeps its original name',
    r.body.application.fullName === 'Ramesh Kumar Sahoo', r.body.application.fullName);
  check('the earlier application keeps its original phone',
    r.body.application.phone === '9876543210', r.body.application.phone);

  r = await sup('GET', '/api/applications?q=Sahoo');
  check('the original name is still searchable', r.body.total >= 1, r.body.total);

  section('MLA comment on a decision');
  const freshPending = (await mla('GET', '/api/applications?status=pending')).body.applications[0];

  r = await mla('PATCH', `/api/applications/${freshPending.id}/status`, {
    status: 'accepted',
    comment: 'Approved for Rs. 10,000 towards hospital bill.',
  });
  check('MLA can accept with a comment', r.status === 200, r.body);

  r = await mla('GET', `/api/applications/${freshPending.id}`);
  check('the accept comment is stored and returned',
    r.body.application.mlaComment === 'Approved for Rs. 10,000 towards hospital bill.',
    r.body.application.mlaComment);
  check('an accepted application has no rejection reason',
    r.body.application.rejectionReason === null, r.body.application.rejectionReason);

  r = await sup('GET', `/api/applications/${freshPending.id}`);
  check('the supervisor sees the MLA comment on their own form',
    r.body.application.mlaComment === 'Approved for Rs. 10,000 towards hospital bill.');

  // A rejection keeps the required reason and the optional comment separate.
  const nextPending = (await mla('GET', '/api/applications?status=pending')).body.applications[0];
  r = await mla('PATCH', `/api/applications/${nextPending.id}/status`, {
    status: 'rejected',
    rejectionReason: 'Bank details missing.',
    comment: 'Ask the supervisor to resubmit with a passbook copy.',
  });
  check('MLA can reject with both a reason and a comment', r.status === 200, r.body);

  r = await mla('GET', `/api/applications/${nextPending.id}`);
  check('rejection reason is stored', r.body.application.rejectionReason === 'Bank details missing.');
  check('rejection comment is stored separately',
    r.body.application.mlaComment === 'Ask the supervisor to resubmit with a passbook copy.');

  section('Attachments visible on the detail page');
  r = await mla('GET', `/api/applications/${appAId}`);
  check('detail returns a files array', Array.isArray(r.body.application.files));
  check('detail exposes the beneficiary photo id field',
    'photoFileId' in r.body.application);

  section('Support type is present on every view');
  r = await mla('GET', `/api/applications/${appAId}`);
  check('detail carries the support type', !!r.body.application.supportType, r.body.application.supportType);
  check('detail carries the support reason', !!r.body.application.supportReason);

  r = await sup('GET', '/api/applications');
  check('list rows carry the support type', r.body.applications.every((a) => !!a.supportType));
  check('list rows carry the support reason', r.body.applications.every((a) => !!a.supportReason));

  section('Amount validation');
  r = await sup('POST', '/api/applications', { ...badBase, aadhaar: AADHAAR_A, amount: '' });
  check('missing amount is rejected', r.status === 400, r.body);
  r = await sup('POST', '/api/applications', { ...badBase, aadhaar: AADHAAR_A, amount: '0' });
  check('zero amount is rejected', r.status === 400, r.body);
  r = await sup('POST', '/api/applications', { ...badBase, aadhaar: AADHAAR_A, amount: 'abc' });
  check('non-numeric amount is rejected', r.status === 400, r.body);
  r = await sup('POST', '/api/applications', { ...badBase, aadhaar: AADHAAR_A, amount: '12.345' });
  check('three decimal places rejected', r.status === 400, r.body);
  r = await sup('POST', '/api/applications', { ...badBase, aadhaar: AADHAAR_A, amount: '99999999999' });
  check('absurd amount is rejected', r.status === 400, r.body);

  section('Amount rollup by block and panchayat');
  // Build a known set of figures from scratch in the Rasulpur block, which no
  // earlier test has touched, so the arithmetic can be asserted exactly.
  const sup2b = makeClient();
  await sup2b('POST', '/api/auth/login', { username: 'sup.rasul', password: 'Sup@2026#RSD' });
  const rsdPanchayats = (await sup2b('GET', `/api/master/panchayats?blockId=${blockRsd.id}`)).body.panchayats;

  const RSD_AADHAAR = ['999952981172', '999928967699', '999985285556'];
  const plan = [
    { aadhaar: RSD_AADHAAR[0], panchayat: rsdPanchayats[0], amount: '25000', decide: 'accepted' },
    { aadhaar: RSD_AADHAAR[1], panchayat: rsdPanchayats[0], amount: '15000', decide: null },
    { aadhaar: RSD_AADHAAR[2], panchayat: rsdPanchayats[1], amount: '40000', decide: 'rejected' },
  ];

  const madeIds = [];
  for (const item of plan) {
    const res = await sup2b('POST', '/api/applications', {
      ...badBase,
      aadhaar: item.aadhaar,
      fullName: `RSD Applicant ${item.amount}`,
      blockId: blockRsd.id,
      panchayatId: item.panchayat.id,
      amount: item.amount,
      acknowledgeDuplicate: true,
    });
    if (res.status !== 201) { check(`seed ${item.amount} created`, false, res.body); continue; }
    madeIds.push({ id: res.body.application.id, decide: item.decide });
  }
  check('three Rasulpur applications created', madeIds.length === 3, madeIds.length);

  for (const m of madeIds) {
    if (!m.decide) continue;
    await mla('PATCH', `/api/applications/${m.id}/status`, {
      status: m.decide,
      rejectionReason: m.decide === 'rejected' ? 'Not eligible.' : undefined,
    });
  }

  r = await mla('GET', '/api/applications/summary');
  check('summary endpoint responds', r.status === 200, r.body);

  const rsd = r.body.blocks.find((b) => b.blockId === blockRsd.id);
  check('Rasulpur block appears in the rollup', !!rsd, r.body.blocks.map((b) => b.blockName));

  check('block accepted total', rsd.accepted === 25000, rsd.accepted);
  check('block pending total', rsd.pending === 15000, rsd.pending);
  check('block rejected total', rsd.rejected === 40000, rsd.rejected);
  check('block requested = accepted + pending', rsd.requested === 40000, rsd.requested);
  check('rejected is NOT counted in requested',
    rsd.requested === rsd.accepted + rsd.pending && rsd.requested !== rsd.accepted + rsd.pending + rsd.rejected,
    { requested: rsd.requested, rejected: rsd.rejected });

  const p1 = rsd.panchayats.find((p) => p.panchayatId === rsdPanchayats[0].id);
  const p2 = rsd.panchayats.find((p) => p.panchayatId === rsdPanchayats[1].id);
  check('panchayat 1 requested is 40000', p1 && p1.requested === 40000, p1 && p1.requested);
  check('panchayat 1 accepted is 25000', p1 && p1.accepted === 25000, p1 && p1.accepted);
  check('panchayat 1 pending is 15000', p1 && p1.pending === 15000, p1 && p1.pending);
  check('panchayat 1 has no rejected amount', p1 && p1.rejected === 0, p1 && p1.rejected);
  check('panchayat 2 requested is 0 (its only form was rejected)', p2 && p2.requested === 0, p2 && p2.requested);
  check('panchayat 2 rejected is 40000', p2 && p2.rejected === 40000, p2 && p2.rejected);

  const sumPanchayats = rsd.panchayats.reduce((t, p) => t + p.requested, 0);
  check('panchayat totals add up to the block total', sumPanchayats === rsd.requested,
    { sumPanchayats, block: rsd.requested });

  const sumBlocks = r.body.blocks.reduce((t, b) => t + b.requested, 0);
  check('block totals add up to the overall total', sumBlocks === r.body.overall.requested,
    { sumBlocks, overall: r.body.overall.requested });
  check('overall requested = overall accepted + pending',
    r.body.overall.requested === r.body.overall.accepted + r.body.overall.pending);

  check('counts are returned alongside amounts',
    rsd.acceptedCount === 1 && rsd.pendingCount === 1 && rsd.rejectedCount === 1,
    { a: rsd.acceptedCount, p: rsd.pendingCount, x: rsd.rejectedCount });

  r = await sup('GET', '/api/applications/summary');
  check('a supervisor cannot read the rollup', r.status === 403, r.status);

  section('Amount on the record');
  r = await sup('GET', `/api/applications/${appAId}`);
  check('detail carries the amount', r.body.application.amount === 10000, r.body.application.amount);
  r = await sup('GET', '/api/applications');
  check('list rows carry the amount', r.body.applications.every((a) => typeof a.amount === 'number'));

  section('CSV export');
  const csv = await mla('GET', '/api/applications/export.csv', undefined, { raw: true });
  check('CSV downloads', csv.status === 200 && csv.body.includes('Reference No'), csv.status);
  check('CSV contains a reference number', csv.body.includes(refA));
  check('CSV does not contain a full Aadhaar number', !csv.body.includes(AADHAAR_A));
  check('CSV has an MLA Comment column', csv.body.includes('MLA Comment'));
  check('CSV has an Amount column', csv.body.includes('Amount'));
  check('CSV includes the accept comment', csv.body.includes('Approved for Rs. 10,000'));

  section('Audit trail');
  r = await mla('GET', '/api/health');
  check('health endpoint stays open', r.status === 200);

  console.log(`\n${'='.repeat(46)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('='.repeat(46));
  process.exit(failed === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\nSmoke test crashed:', err);
  process.exit(1);
});
