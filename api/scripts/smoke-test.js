#!/usr/bin/env node
'use strict';

/**
 * End-to-end smoke test against a running API.
 *
 *   BASE=http://localhost:4000 npm run smoke
 *
 * Exercises the whole supervisor -> Head Sahayak -> MLA journey with real
 * HTTP requests:
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
    } else if (opts.contentType) {
      // A hand-rolled multipart body (a Buffer) — used to exercise the upload
      // route without pulling in a form-data dependency.
      headers['Content-Type'] = opts.contentType;
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
  const head = makeClient();
  const mla = makeClient();
  const anon = makeClient();

  // Every application now starts with the Head Sahayak, so anything a test
  // wants the MLA to decide has to be verified and forwarded first.
  const forwardToMla = (appId, comment = 'Documents verified at panchayat office.') =>
    head('PATCH', `/api/applications/${appId}/verify`, { decision: 'forward', comment });

  /** The next application sitting in front of the MLA, forwarding one if none is. */
  async function nextForMla() {
    let res = await mla('GET', '/api/applications?status=pending_mla');
    if (res.body.applications.length) return res.body.applications[0];
    res = await head('GET', '/api/applications?status=pending_head');
    const a = res.body.applications[0];
    await forwardToMla(a.id);
    return a;
  }

  section('Auth');
  let r = await anon('GET', '/api/auth/me');
  check('unauthenticated /me is rejected', r.status === 401, r.body);

  r = await sup('POST', '/api/auth/login', { username: 'sup.dharma', password: 'wrong' });
  check('bad password is rejected', r.status === 401, r.body);

  r = await sup('POST', '/api/auth/login', { username: 'sup.dharma', password: 'Sup@2026#DHM' });
  check('supervisor can sign in', r.status === 200 && r.body.user.role === 'supervisor', r.body);

  r = await head('POST', '/api/auth/login', { username: 'head', password: 'Head@2026#LRT' });
  check('Head Sahayak can sign in', r.status === 200 && r.body.user.role === 'head_sahayak', r.body);

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

  check('bootstrap carries zones', Array.isArray(master.zones) && master.zones.length === 6,
    master.zones && master.zones.length);

  r = await sup('GET', `/api/master/zones?blockId=${blockDhm.id}`);
  const dhmZones = r.body.zones;
  check('zones are filtered by block',
    dhmZones.length === 3 && dhmZones.every((z) => z.block_id === blockDhm.id),
    dhmZones.map((z) => z.name));

  r = await sup('GET', `/api/master/zones?blockId=${blockRsd.id}`);
  const rsdZones = r.body.zones;
  check('the other block has its own zones',
    rsdZones.length === 3 && !rsdZones.some((z) => dhmZones.find((d) => d.id === z.id)));

  r = await sup('GET', `/api/master/panchayats?zoneId=${dhmZones[0].id}`);
  const dhmPanchayats = r.body.panchayats;
  check('panchayats are filtered by zone',
    dhmPanchayats.length === 10 && dhmPanchayats.every((p) => p.zone_id === dhmZones[0].id),
    dhmPanchayats.length);

  r = await sup('GET', `/api/master/panchayats?zoneId=${dhmZones[1].id}`);
  check('a different zone returns different panchayats',
    !r.body.panchayats.some((p) => dhmPanchayats.find((d) => d.id === p.id)));
  check('panchayat names are unique across the block',
    !r.body.panchayats.some((p) => dhmPanchayats.find((d) => d.name === p.name)),
    r.body.panchayats.slice(0, 2).map((p) => p.name));

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
    zoneId: dhmZones[0].id,
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

  r = await sup('POST', '/api/applications', {
    ...badBase, aadhaar: AADHAAR_A, zoneId: rsdZones[0].id,
  });
  check('a zone from another block is rejected', r.status === 400, r.body);

  r = await sup('POST', '/api/applications', {
    ...badBase, aadhaar: AADHAAR_A, panchayatId: dhmPanchayats[0].id, zoneId: dhmZones[1].id,
  });
  check('a panchayat from another zone is rejected', r.status === 400, r.body);

  r = await sup('POST', '/api/applications', { ...badBase, aadhaar: AADHAAR_A, zoneId: undefined });
  check('a missing zone is rejected', r.status === 400, r.body);

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
  check('a new application starts with the Head Sahayak',
    r.body.application && r.body.application.status === 'pending_head', r.body.application);
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
  check('autofills zone', r.body.beneficiary.zoneId === dhmZones[0].id, r.body.beneficiary.zoneId);
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
  check('all five status counts are returned',
    r.body.counts &&
    ['pending_head', 'pending_mla', 'head_rejected', 'accepted', 'rejected']
      .every((k) => typeof r.body.counts[k] === 'number'),
    r.body.counts);

  r = await sup('GET', `/api/applications?q=${encodeURIComponent(refA)}`);
  check('search by reference number works', r.body.total === 1 && r.body.applications[0].referenceNo === refA);

  r = await sup('GET', '/api/applications?q=Ramesh');
  check('search by name works', r.body.total >= 1 && r.body.applications[0].fullName.includes('Ramesh'));

  r = await sup('GET', '/api/applications?q=9876543210');
  check('search by phone works', r.body.total >= 1);

  r = await sup('GET', `/api/applications?q=${AADHAAR_A.slice(-4)}`);
  check('search by last 4 Aadhaar digits works', r.body.total >= 1);

  r = await sup('GET', '/api/applications?status=pending_head');
  check('status filter works', r.body.applications.every((a) => a.status === 'pending_head'));

  r = await sup('GET', '/api/applications?status=open');
  check('the "open" filter covers both waiting stages',
    r.body.applications.every((a) => a.status === 'pending_head' || a.status === 'pending_mla'));

  section('Role scoping');
  r = await sup('POST', `/api/applications/${appAId}/status`);
  check('supervisor cannot reach the review endpoint (wrong verb is 404)', r.status === 404);

  r = await sup('PATCH', `/api/applications/${appAId}/status`, { status: 'accepted' });
  check('supervisor is forbidden from reviewing', r.status === 403, r.body);

  r = await sup('GET', '/api/applications/export.csv');
  check('supervisor is forbidden from exporting', r.status === 403, r.body);

  r = await sup('PATCH', `/api/applications/${appAId}/verify`, { decision: 'forward', comment: 'ok please' });
  check('supervisor is forbidden from verifying', r.status === 403, r.body);

  r = await mla('PATCH', `/api/applications/${appAId}/verify`, { decision: 'forward', comment: 'ok please' });
  check('MLA is forbidden from verifying — that stage is not theirs', r.status === 403, r.body);

  r = await head('PATCH', `/api/applications/${appAId}/status`, { status: 'accepted' });
  check('Head Sahayak is forbidden from deciding', r.status === 403, r.body);

  r = await head('POST', '/api/applications', { ...badBase, aadhaar: AADHAAR_B });
  check('Head Sahayak cannot file an application', r.status === 403, r.body);

  r = await head('GET', '/api/applications/export.csv', undefined, { raw: true });
  check('Head Sahayak can export', r.status === 200, r.status);

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

  r = await head('GET', '/api/applications');
  check('Head Sahayak sees every supervisor’s forms', r.body.total >= supTotal, r.body.total);

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

  section('Stage 2 — Head Sahayak verification');

  // The MLA must not be able to reach an unverified application at all.
  r = await mla('PATCH', `/api/applications/${appAId}/status`, {
    status: 'accepted',
  });
  check('MLA cannot decide before the Head Sahayak has verified', r.status === 409, r.body);

  r = await head('PATCH', `/api/applications/${appAId}/verify`, { decision: 'forward' });
  check('forwarding without a comment is refused', r.status === 400, r.body);

  r = await head('PATCH', `/api/applications/${appAId}/verify`, { decision: 'maybe', comment: 'unsure' });
  check('an unknown decision is refused', r.status === 400, r.body);

  r = await forwardToMla(appAId, 'Documents checked. Hospital estimate matches the amount.');
  check('Head Sahayak can forward to the MLA', r.status === 200 && r.body.status === 'pending_mla', r.body);

  r = await forwardToMla(appAId);
  check('an already-forwarded application cannot be verified twice', r.status === 409, r.body);

  r = await sup('GET', `/api/applications/${appAId}`);
  check('the head comment is stored and visible to the supervisor',
    r.body.application.headComment === 'Documents checked. Hospital estimate matches the amount.',
    r.body.application.headComment);
  check('the head reviewer is recorded', !!r.body.application.headReviewedByName,
    r.body.application.headReviewedByName);

  // A head rejection is terminal: it reaches the MLA's list, but not their hands.
  const toKill = (await head('GET', '/api/applications?status=pending_head')).body.applications[0];
  r = await head('PATCH', `/api/applications/${toKill.id}/verify`, { decision: 'reject' });
  check('rejecting without a reason is refused', r.status === 400, r.body);

  r = await head('PATCH', `/api/applications/${toKill.id}/verify`, {
    decision: 'reject',
    comment: 'Applicant already assisted this financial year.',
  });
  check('Head Sahayak can reject', r.status === 200 && r.body.status === 'head_rejected', r.body);

  r = await mla('GET', `/api/applications/${toKill.id}`);
  check('the MLA can see a head-rejected application',
    r.status === 200 && r.body.application.status === 'head_rejected', r.body.application);
  check('the MLA sees the head’s reason',
    r.body.application.headComment === 'Applicant already assisted this financial year.');

  r = await mla('PATCH', `/api/applications/${toKill.id}/status`, { status: 'accepted' });
  check('the MLA cannot overturn a head rejection', r.status === 409, r.body);

  section('Stage 3 — MLA decision');
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
  check('a rejected application has no sanctioned amount',
    r.body.application.approvedAmount === null, r.body.application.approvedAmount);

  const secondApp = await nextForMla();
  r = await mla('PATCH', `/api/applications/${secondApp.id}/status`, { status: 'accepted' });
  check('MLA can accept', r.status === 200, r.body);

  r = await mla('GET', `/api/applications/${secondApp.id}`);
  check('accepting without naming an amount sanctions the full request',
    r.body.application.approvedAmount === r.body.application.amount,
    { requested: r.body.application.amount, sanctioned: r.body.application.approvedAmount });

  section('The MLA edits the sanctioned amount');
  const toCut = await nextForMla();
  r = await mla('PATCH', `/api/applications/${toCut.id}/status`, {
    status: 'accepted',
    approvedAmount: '0',
  });
  check('a zero sanction is refused', r.status === 400, r.body);

  r = await mla('PATCH', `/api/applications/${toCut.id}/status`, {
    status: 'accepted',
    approvedAmount: 'abc',
  });
  check('a non-numeric sanction is refused', r.status === 400, r.body);

  const cutTo = Math.round(toCut.amount / 2);
  r = await mla('PATCH', `/api/applications/${toCut.id}/status`, {
    status: 'accepted',
    approvedAmount: String(cutTo),
    comment: 'Partial assistance sanctioned.',
  });
  check('the MLA can sanction less than was requested', r.status === 200, r.body);

  r = await mla('GET', `/api/applications/${toCut.id}`);
  check('the deducted amount is stored', r.body.application.approvedAmount === cutTo,
    r.body.application.approvedAmount);
  check('the requested amount is untouched by the deduction',
    r.body.application.amount === toCut.amount,
    { before: toCut.amount, after: r.body.application.amount });

  const toRaise = await nextForMla();
  const raiseTo = toRaise.amount + 5000;
  r = await mla('PATCH', `/api/applications/${toRaise.id}/status`, {
    status: 'accepted',
    approvedAmount: String(raiseTo),
  });
  check('the MLA can sanction more than was requested', r.status === 200, r.body);
  r = await mla('GET', `/api/applications/${toRaise.id}`);
  check('the increased amount is stored', r.body.application.approvedAmount === raiseTo,
    r.body.application.approvedAmount);

  r = await sup('GET', `/api/applications/${toCut.id}`);
  check('the supervisor sees what was actually sanctioned',
    r.body.application.approvedAmount === cutTo, r.body.application.approvedAmount);

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
  const freshPending = await nextForMla();

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
  const nextPending = await nextForMla();
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
  const rsdZone = rsdZones[0];
  const rsdPanchayats = (await sup2b('GET', `/api/master/panchayats?zoneId=${rsdZone.id}`)).body.panchayats;

  const RSD_AADHAAR = ['999952981172', '999928967699', '999985285556'];
  // One of each outcome, with a deliberate deduction on the accepted one so the
  // requested and sanctioned columns are forced apart and can be told apart.
  //
  //   p1: 25,000 requested -> 20,000 sanctioned   (accepted, MLA cut 5,000)
  //       15,000 requested                        (still with the Head Sahayak)
  //   p2: 40,000 requested                        (rejected by the MLA)
  const plan = [
    { aadhaar: RSD_AADHAAR[0], panchayat: rsdPanchayats[0], amount: '25000', decide: 'accepted', sanction: '20000' },
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
      zoneId: rsdZone.id,
      panchayatId: item.panchayat.id,
      amount: item.amount,
      acknowledgeDuplicate: true,
    });
    if (res.status !== 201) { check(`seed ${item.amount} created`, false, res.body); continue; }
    madeIds.push({ id: res.body.application.id, decide: item.decide, sanction: item.sanction });
  }
  check('three Rasulpur applications created', madeIds.length === 3, madeIds.length);

  for (const m of madeIds) {
    if (!m.decide) continue;
    await forwardToMla(m.id);
    await mla('PATCH', `/api/applications/${m.id}/status`, {
      status: m.decide,
      approvedAmount: m.sanction,
      rejectionReason: m.decide === 'rejected' ? 'Not eligible.' : undefined,
    });
  }

  r = await mla('GET', '/api/applications/summary');
  check('summary endpoint responds', r.status === 200, r.body);

  const rsd = r.body.blocks.find((b) => b.blockId === blockRsd.id);
  check('Rasulpur block appears in the rollup', !!rsd, r.body.blocks.map((b) => b.blockName));

  // Requested is what was asked for on everything not turned down: the accepted
  // form at its ORIGINAL 25,000, plus the 15,000 still in verification.
  check('block requested counts the accepted form at what was asked, not granted',
    rsd.requested === 40000, { requested: rsd.requested, acceptedRequested: rsd.acceptedRequested });
  check('block sanctioned is what the MLA actually granted', rsd.sanctioned === 20000, rsd.sanctioned);
  check('requested and sanctioned are genuinely different numbers',
    rsd.requested !== rsd.sanctioned, { requested: rsd.requested, sanctioned: rsd.sanctioned });
  check('the MLA’s deduction shows up as a negative variance', rsd.variance === -5000, rsd.variance);
  check('block awaitingHead total', rsd.awaitingHead === 15000, rsd.awaitingHead);
  check('nothing is left sitting with the MLA', rsd.awaitingMla === 0, rsd.awaitingMla);
  check('block mlaRejected total', rsd.mlaRejected === 40000, rsd.mlaRejected);

  check('requested = awaitingHead + awaitingMla + acceptedRequested',
    rsd.requested === rsd.awaitingHead + rsd.awaitingMla + rsd.acceptedRequested,
    { requested: rsd.requested, awaitingHead: rsd.awaitingHead, awaitingMla: rsd.awaitingMla, acceptedRequested: rsd.acceptedRequested });
  check('rejected money is NOT counted in requested',
    rsd.requested !== rsd.requested + rsd.mlaRejected + rsd.headRejected,
    { requested: rsd.requested, mlaRejected: rsd.mlaRejected });

  check('the rollup nests zones under blocks', Array.isArray(rsd.zones) && rsd.zones.length >= 1,
    rsd.zones && rsd.zones.length);
  const zoneRow = rsd.zones.find((z) => z.zoneId === rsdZone.id);
  check('the zone level appears in the rollup', !!zoneRow, rsd.zones.map((z) => z.zoneName));
  check('the zone total equals the block total (all forms are in one zone)',
    zoneRow.requested === rsd.requested && zoneRow.sanctioned === rsd.sanctioned,
    { zone: zoneRow.requested, block: rsd.requested });

  const p1 = zoneRow.panchayats.find((p) => p.panchayatId === rsdPanchayats[0].id);
  const p2 = zoneRow.panchayats.find((p) => p.panchayatId === rsdPanchayats[1].id);
  check('panchayat 1 requested is 40000', p1 && p1.requested === 40000, p1 && p1.requested);
  check('panchayat 1 sanctioned is 20000', p1 && p1.sanctioned === 20000, p1 && p1.sanctioned);
  check('panchayat 1 awaitingHead is 15000', p1 && p1.awaitingHead === 15000, p1 && p1.awaitingHead);
  check('panchayat 1 has no rejected amount',
    p1 && p1.mlaRejected === 0 && p1.headRejected === 0, p1 && p1.mlaRejected);
  check('panchayat 2 requested is 0 (its only form was rejected)', p2 && p2.requested === 0, p2 && p2.requested);
  check('panchayat 2 sanctioned is 0', p2 && p2.sanctioned === 0, p2 && p2.sanctioned);
  check('panchayat 2 mlaRejected is 40000', p2 && p2.mlaRejected === 40000, p2 && p2.mlaRejected);

  const sumPanchayats = zoneRow.panchayats.reduce((t, p) => t + p.requested, 0);
  check('panchayat totals add up to the block total', sumPanchayats === rsd.requested,
    { sumPanchayats, block: rsd.requested });
  const sumSanctioned = zoneRow.panchayats.reduce((t, p) => t + p.sanctioned, 0);
  check('panchayat sanctioned adds up to the block sanctioned', sumSanctioned === rsd.sanctioned,
    { sumSanctioned, block: rsd.sanctioned });

  const sumBlocks = r.body.blocks.reduce((t, b) => t + b.requested, 0);
  check('block totals add up to the overall total', sumBlocks === r.body.overall.requested,
    { sumBlocks, overall: r.body.overall.requested });
  const ov = r.body.overall;
  check('overall requested = awaitingHead + awaitingMla + acceptedRequested',
    ov.requested === ov.awaitingHead + ov.awaitingMla + ov.acceptedRequested,
    { requested: ov.requested, awaitingHead: ov.awaitingHead, awaitingMla: ov.awaitingMla, acceptedRequested: ov.acceptedRequested });
  check('overall variance = sanctioned − acceptedRequested',
    Math.round((ov.sanctioned - ov.acceptedRequested) * 100) === Math.round(ov.variance * 100),
    { sanctioned: ov.sanctioned, acceptedRequested: ov.acceptedRequested, variance: ov.variance });

  check('counts are returned alongside amounts',
    rsd.acceptedCount === 1 && rsd.awaitingHeadCount === 1 && rsd.mlaRejectedCount === 1,
    { a: rsd.acceptedCount, h: rsd.awaitingHeadCount, x: rsd.mlaRejectedCount });

  r = await sup('GET', '/api/applications/summary');
  check('a supervisor cannot read the rollup', r.status === 403, r.status);

  r = await head('GET', '/api/applications/summary');
  check('the Head Sahayak can read the rollup', r.status === 200, r.status);
  check('the Head Sahayak sees the same figures as the MLA',
    r.body.overall.requested === ov.requested && r.body.overall.sanctioned === ov.sanctioned,
    { head: r.body.overall.requested, mla: ov.requested });

  section('Amount on the record');
  r = await sup('GET', `/api/applications/${appAId}`);
  check('detail carries the amount', r.body.application.amount === 10000, r.body.application.amount);
  r = await sup('GET', '/api/applications');
  check('list rows carry the requested amount', r.body.applications.every((a) => typeof a.amount === 'number'));
  check('list rows carry a sanctioned amount that is null until decided',
    r.body.applications.every((a) =>
      a.status === 'accepted' ? typeof a.approvedAmount === 'number' : a.approvedAmount === null),
    r.body.applications.map((a) => [a.status, a.approvedAmount]));

  section('Approval list — every accepted application, for every field role');

  // The list is deliberately not scoped by submitter: a Sahayak must be able to
  // hand over money for a form somebody else filed.
  r = await sup('GET', '/api/applications/approved');
  check('a supervisor can read the approval list', r.status === 200, r.body);
  const approvedForSup = r.body;
  check('every row on it is accepted',
    approvedForSup.applications.every((a) => a.approvedAmount !== null), 'approvedAmount null somewhere');
  check('it carries the zone', approvedForSup.applications.every((a) => !!a.zoneName));
  check('it reports handover counts',
    typeof approvedForSup.counts.pendingHandover === 'number' &&
    typeof approvedForSup.counts.distributed === 'number', approvedForSup.counts);
  check('it reports sanctioned and distributed totals',
    typeof approvedForSup.totals.sanctioned === 'number' &&
    typeof approvedForSup.totals.distributed === 'number', approvedForSup.totals);

  r = await head('GET', '/api/applications/approved');
  check('the Head Sahayak sees the same list', r.body.total === approvedForSup.total,
    { head: r.body.total, sup: approvedForSup.total });

  // sup.rasul filed none of the Dharmasala forms, and must still see them here.
  r = await sup2('GET', '/api/applications/approved');
  check('another supervisor sees the same approvals', r.body.total === approvedForSup.total,
    { other: r.body.total, sup: approvedForSup.total });
  check('and can open one they did not file',
    (await sup2('GET', `/api/applications/${approvedForSup.applications[0].id}`)).status === 200);

  r = await sup('GET', `/api/applications/approved?blockId=${blockRsd.id}`);
  check('the block filter narrows the approval list',
    r.body.applications.every((a) => a.blockName === blockRsd.name), r.body.applications.length);
  r = await sup('GET', `/api/applications/approved?zoneId=${rsdZone.id}`);
  check('the zone filter narrows it',
    r.body.applications.every((a) => a.zoneName === rsdZone.name), r.body.applications.length);
  r = await sup('GET', `/api/applications/approved?panchayatId=${rsdPanchayats[0].id}`);
  check('the panchayat filter narrows it',
    r.body.applications.every((a) => a.panchayatName === rsdPanchayats[0].name),
    r.body.applications.length);
  r = await sup('GET', '/api/applications/approved?distributed=no');
  check('the pending-handover filter works',
    r.body.applications.every((a) => a.distributedAt === null), 'a distributed row leaked in');

  section('Distribution — recording that the money reached the applicant');

  const target = (await sup('GET', '/api/applications/approved?distributed=no')).body.applications[0];
  check('there is an approved application to hand over', !!target, 'none pending');

  r = await sup('PATCH', `/api/applications/${target.id}/distribute`, {});
  check('a handover without a photo is refused', r.status === 400, r.body);

  r = await sup('PATCH', `/api/applications/${target.id}/distribute`, { photoFileId: 999999 });
  check('a handover with an unknown photo is refused', r.status === 400, r.body);

  // A one-pixel JPEG is enough: the endpoint checks the file's kind and magic
  // number, not what the picture shows.
  const JPEG_1PX = Buffer.from(
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAA' +
    'AAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/E' +
    'ABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJgA/9k=',
    'base64'
  );

  async function uploadPhoto(client, kind) {
    const boundary = `----smoke${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n${kind}\r\n`),
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="shot.jpg"\r\n` +
        'Content-Type: image/jpeg\r\n\r\n'
      ),
      JPEG_1PX,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    return client('POST', '/api/files', body, {
      contentType: `multipart/form-data; boundary=${boundary}`,
    });
  }

  r = await uploadPhoto(sup, 'document');
  const docFileId = r.status === 201 ? r.body.file.id : null;
  check('a plain document uploads', r.status === 201, r.body);

  r = await sup('PATCH', `/api/applications/${target.id}/distribute`, { photoFileId: docFileId });
  check('a handover using a non-distribution file is refused', r.status === 400, r.body);

  r = await uploadPhoto(sup, 'distribution_photo');
  check('a distribution photo uploads', r.status === 201, r.body);
  const distPhotoId = r.status === 201 ? r.body.file.id : null;

  r = await mla('PATCH', `/api/applications/${target.id}/distribute`, { photoFileId: distPhotoId });
  check('the MLA cannot record a handover', r.status === 403, r.body);

  r = await sup('PATCH', `/api/applications/${target.id}/distribute`, { photoFileId: distPhotoId });
  check('a supervisor can record the handover', r.status === 200, r.body);

  r = await sup('PATCH', `/api/applications/${target.id}/distribute`, { photoFileId: distPhotoId });
  check('the same application cannot be distributed twice', r.status === 409, r.body);

  r = await sup('GET', `/api/applications/${target.id}`);
  check('the handover is recorded on the application', !!r.body.application.distributedAt);
  check('who recorded it is stored', !!r.body.application.distributedByName);
  check('the photo is linked', r.body.application.distributionPhotoFileId === distPhotoId);
  check('the application is still accepted, not a new status',
    r.body.application.status === 'accepted', r.body.application.status);

  // The photo must be readable by the roles that can see the list, including a
  // supervisor who did not upload it.
  r = await sup2('GET', `/api/files/${distPhotoId}`, undefined, { raw: true });
  check('another supervisor can open the distribution photo', r.status === 200, r.status);
  r = await mla('GET', `/api/files/${distPhotoId}`, undefined, { raw: true });
  check('the MLA can open the distribution photo', r.status === 200, r.status);

  // Reusing one photo across two handovers would defeat the point.
  const target2 = (await sup('GET', '/api/applications/approved?distributed=no')).body.applications[0];
  if (target2) {
    r = await sup('PATCH', `/api/applications/${target2.id}/distribute`, { photoFileId: distPhotoId });
    check('a photo cannot be reused for another application', r.status === 400, r.body);
  }

  r = await head('GET', '/api/applications/approved?distributed=yes');
  check('the distributed filter finds it',
    r.body.applications.some((a) => a.id === target.id), r.body.applications.length);

  r = await mla('GET', '/api/applications/summary');
  check('the rollup counts the handover',
    r.body.overall.distributedCount >= 1, r.body.overall.distributedCount);
  check('undistributed = sanctioned - distributed',
    Math.round((r.body.overall.sanctioned - r.body.overall.distributed) * 100) ===
      Math.round(r.body.overall.undistributed * 100),
    { sanctioned: r.body.overall.sanctioned, distributed: r.body.overall.distributed, undistributed: r.body.overall.undistributed });

  // A form that is not accepted cannot be handed over at all.
  const notAccepted = (await head('GET', '/api/applications?status=pending_head')).body.applications[0];
  if (notAccepted) {
    r = await uploadPhoto(sup, 'distribution_photo');
    r = await sup('PATCH', `/api/applications/${notAccepted.id}/distribute`, { photoFileId: r.body.file.id });
    check('an unapproved application cannot be distributed', r.status === 409, r.body);
  }

  section('CSV export');
  const csv = await mla('GET', '/api/applications/export.csv', undefined, { raw: true });
  check('CSV downloads', csv.status === 200 && csv.body.includes('Reference No'), csv.status);
  check('CSV contains a reference number', csv.body.includes(refA));
  check('CSV does not contain a full Aadhaar number', !csv.body.includes(AADHAAR_A));
  check('CSV has an MLA Comment column', csv.body.includes('MLA Comment'));
  check('CSV has a Head Comment column', csv.body.includes('Head Comment'));
  check('CSV has a Zone column', csv.body.includes('Zone'));
  check('CSV reports the handover', csv.body.includes('Distributed At'));
  check('CSV separates requested from sanctioned',
    csv.body.includes('Amount Requested') && csv.body.includes('Amount Sanctioned'));
  check('CSV has a Difference column', csv.body.includes('Difference'));
  check('CSV names the stage in words', csv.body.includes('Rejected by Head Sahayak'));
  check('CSV includes the accept comment', csv.body.includes('Approved for Rs. 10,000'));
  check('CSV includes the head’s rejection reason',
    csv.body.includes('Applicant already assisted this financial year'));

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
