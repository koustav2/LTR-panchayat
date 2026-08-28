/**
 * Approval list and camera-only distribution, in a real browser.
 *
 *   node approvals.mjs
 *
 * The camera path is the reason this suite exists. Chromium's
 * --use-fake-device-for-media-stream feeds getUserMedia a synthetic camera and
 * --use-fake-ui-for-media-stream auto-grants the permission prompt, so the whole
 * live-capture flow — open camera, frame, shoot, upload — runs for real rather
 * than being asserted about in the abstract.
 *
 * Needs an empty database: it files its own applications and walks them all the
 * way from submission to handover.
 */

import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4000';

let pass = 0;
let fail = 0;
const check = (label, ok, extra) => {
  if (ok) { pass += 1; console.log(`  PASS  ${label}`); }
  else { fail += 1; console.log(`  FAIL  ${label}${extra !== undefined ? ` — ${extra}` : ''}`); }
};

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--allow-file-access-from-files',
  ],
});

async function session({ mobile = false } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    permissions: ['camera'],
  });
  const page = await ctx.newPage();
  const errs = [];
  const expected401 = (t) => /status of 401/.test(t);
  page.on('console', (m) => { if (m.type() === 'error' && !expected401(m.text())) errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, errs };
}

async function login(page, username, password) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('.tile', { timeout: 10000 });
}

const AADHAAR = ['999941057058', '999971658847'];

/* ------------------------------------------------ supervisor files two forms */

console.log('\nSupervisor files two applications');
const sup = await session();
let refs = [];
{
  const { page, errs } = sup;
  await login(page, 'sup.dharma', 'Sup@2026#DHM');

  for (const [i, aadhaar] of AADHAAR.entries()) {
    await page.goto(`${BASE}/form`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-field="aadhaar"]');
    await page.locator('[data-field="aadhaar"]').fill(aadhaar);
    await page.waitForTimeout(1200);
    await page.locator('[data-field="fullName"]').fill(`Applicant ${i + 1}`);
    await page.locator('[data-field="guardianName"]').fill('Guardian');
    await page.locator('[data-field="phone"]').fill('9876543210');
    await page.locator('[data-field="pinCode"]').fill('755001');
    await page.locator('[data-field="blockId"]').selectOption({ label: 'Dharmasala' });
    await page.waitForTimeout(200);
    await page.locator('[data-field="zoneId"]').selectOption({ label: 'Dharmasala Zone 1' });
    await page.waitForTimeout(200);
    await page.locator('[data-field="panchayatId"]').selectOption({ index: 1 });
    await page.locator('[data-field="supportTypeId"]').selectOption({ label: 'Education' });
    await page.waitForTimeout(250);
    await page.locator('[data-field="supportReasonId"]').selectOption({ label: 'School Admission Fee' });
    await page.locator('[data-field="amount"]').fill('20000');
    await page.locator('[data-field="ppRecommend"] button.yes').click();
    await page.locator('[data-field="msRecommend"] button.yes').click();
    await page.locator('[data-field="mpRecommend"] button.yes').click();
    await page.getByRole('button', { name: /^Submit/ }).click();
    await page.waitForSelector('.refbox', { timeout: 15000 });
    refs.push(((await page.locator('.refbox .v').textContent()) || '').trim());
  }
  check('two applications filed', refs.length === 2 && refs[0] !== refs[1], refs.join(' / '));
  check('no console errors while filing', errs.length === 0, errs.join(' | '));
}

/* -------------------------------------------- head forwards, MLA accepts one */

console.log('\nHead Sahayak forwards, MLA accepts with a deduction');
{
  const { page } = await session();
  await login(page, 'head', 'Head@2026#LRT');
  for (const ref of refs) {
    await page.goto(`${BASE}/forms?status=pending_head`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    await page.locator('table.data tr.clickable', { hasText: ref }).click();
    await page.waitForSelector('.detail-side', { timeout: 10000 });
    await page.getByRole('button', { name: 'Send to MLA' }).click();
    await page.waitForSelector('.modal');
    await page.locator('.modal [data-field="headComment"]').fill('Verified for the handover run.');
    await page.locator('.modal').getByRole('button', { name: 'Send to MLA' }).click();
    await page.waitForSelector('.detail-side .badge.pending_mla', { timeout: 10000 });
  }

  const { page: mp } = await session();
  await login(mp, 'mla', 'Mla@2026#LRT');
  // Accept only the first: the second stays with the MLA, so the approval list
  // has to prove it shows one and not two.
  await mp.goto(`${BASE}/forms?status=pending_mla`, { waitUntil: 'networkidle' });
  await mp.waitForTimeout(900);
  await mp.locator('table.data tr.clickable', { hasText: refs[0] }).click();
  await mp.waitForSelector('.detail-side', { timeout: 10000 });
  await mp.getByRole('button', { name: 'Accept' }).click();
  await mp.waitForSelector('.modal');
  await mp.locator('.modal [data-field="approvedAmount"]').fill('15000');
  await mp.waitForTimeout(200);
  await mp.locator('.modal').getByRole('button', { name: 'Accept' }).click();
  await mp.waitForSelector('.detail-side .badge.accepted', { timeout: 10000 });
  check('MLA accepted one of the two', true);
  check('the MLA has no Approval List in the sidebar',
    (await mp.locator('.sidebar-nav').textContent() || '').includes('Approval List') === false);
}

/* -------------------------------------------------- the approval list itself */

console.log('\nApproval list');
const sup2 = await session();
{
  const { page, errs } = sup2;
  // A DIFFERENT supervisor from the one who filed the forms — the whole point
  // is that the handover is not restricted to the filer.
  await login(page, 'sup.rasul', 'Sup@2026#RSD');

  check('the Approval List is in the sidebar',
    ((await page.locator('.sidebar-nav').textContent()) || '').includes('Approval List'));
  check('the dashboard offers it as a tile',
    ((await page.locator('.tiles').textContent()) || '').includes('Approval List'));

  await page.goto(`${BASE}/approvals`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  check('a supervisor sees a form another supervisor filed',
    ((await page.locator('.table-wrap').textContent()) || '').includes(refs[0]), refs[0]);
  check('and only the accepted one, not the one still with the MLA',
    ((await page.locator('.table-wrap').textContent()) || '').includes(refs[1]) === false);
  check('the sanctioned amount is the edited one, not the requested one',
    ((await page.locator('.table-wrap').textContent()) || '').includes('15,000'));
  check('it shows what is waiting to be handed over',
    (await page.locator('.count.wait .n').textContent()) === '1');
  check('the zone is shown', ((await page.locator('table.data').textContent()) || '').includes('Dharmasala Zone 1'));

  // Block -> Zone -> Panchayat, cascading, in the filter row.
  const selects = page.locator('.filter-row select');
  check('zone filter is locked until a block is chosen', await selects.nth(1).isDisabled());
  check('panchayat filter is locked until a zone is chosen', await selects.nth(2).isDisabled());

  await selects.nth(0).selectOption({ label: 'Dharmasala' });
  await page.waitForTimeout(900);
  check('choosing a block unlocks the zone filter', !(await selects.nth(1).isDisabled()));
  const zoneOpts = await selects.nth(1).locator('option').allTextContents();
  check('the zone filter lists only that block’s zones',
    zoneOpts.length === 4 && !zoneOpts.some((z) => z.startsWith('Rasulpur')), zoneOpts.join('|'));

  await selects.nth(1).selectOption({ label: 'Dharmasala Zone 1' });
  await page.waitForTimeout(900);
  check('the row survives a matching zone filter',
    ((await page.locator('.table-wrap').textContent()) || '').includes(refs[0]));

  await selects.nth(0).selectOption({ label: 'Rasulpur' });
  await page.waitForTimeout(900);
  check('changing block clears the zone filter', (await selects.nth(1).inputValue()) === '');
  const bodyAfterFilter = (await page.locator('main').textContent()) || '';
  check('a non-matching block filters the row out', !bodyAfterFilter.includes(refs[0]));
  check('and says so rather than showing a blank list',
    await page.locator('.empty').isVisible());

  await selects.nth(0).selectOption({ value: '' });
  await page.waitForTimeout(900);
  check('clearing the block filter brings the row back',
    ((await page.locator('.table-wrap').textContent()) || '').includes(refs[0]));
  check('no console errors on the approval list', errs.length === 0, errs.join(' | '));
}

/* ------------------------------------------ the camera-only handover, for real */

console.log('\nHandover with a live camera capture');
{
  const { page, errs } = sup2;
  await page.goto(`${BASE}/approvals`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.locator('table.data tr.clickable', { hasText: refs[0] }).click();
  await page.waitForSelector('.detail-side', { timeout: 10000 });

  check('the handover panel is offered', await page.getByRole('button', { name: 'Mark as distributed' }).isVisible());
  await page.getByRole('button', { name: 'Mark as distributed' }).click();
  await page.waitForSelector('.modal');

  check('confirming is blocked until a photo exists',
    await page.locator('.modal').getByRole('button', { name: 'Confirm distributed' }).isDisabled());
  check('the only way in is the camera, not a file picker',
    await page.getByRole('button', { name: /Open camera/ }).isVisible());
  // A visible file input would mean the gallery is reachable as a first choice.
  const visibleFileInputs = await page.locator('.modal input[type="file"]:visible').count();
  check('no file input is offered up front', visibleFileInputs === 0, visibleFileInputs);

  await page.getByRole('button', { name: /Open camera/ }).click();
  await page.waitForSelector('.camera-stage video', { timeout: 15000 });
  check('the live camera opens', await page.locator('.camera-stage video').isVisible());
  // Let the fake device produce a few frames so the grab is not a black square.
  await page.waitForTimeout(1200);
  const dims = await page.locator('.camera-stage video')
    .evaluate((v) => ({ w: v.videoWidth, h: v.videoHeight }));
  check('the stream is delivering frames', dims.w > 0 && dims.h > 0, JSON.stringify(dims));

  await page.getByRole('button', { name: 'Take photo' }).click();
  await page.waitForSelector('.camera-stage img', { timeout: 10000 });
  check('the still replaces the stream', await page.locator('.camera-stage img').isVisible());
  check('the camera is released once the shot is taken',
    (await page.locator('.camera-stage video').count()) === 0);
  check('retake is offered', await page.getByRole('button', { name: 'Retake' }).isVisible());

  await page.getByRole('button', { name: 'Use this photo' }).click();
  await page.waitForSelector('.handover-shot', { timeout: 15000 });
  check('the photo uploads and is held ready', await page.locator('.handover-shot .ok').isVisible());
  check('confirming is now enabled',
    !(await page.locator('.modal').getByRole('button', { name: 'Confirm distributed' }).isDisabled()));

  await page.locator('.modal').getByRole('button', { name: 'Confirm distributed' }).click();
  await page.waitForSelector('.handover-done', { timeout: 15000 });

  check('the handover is recorded on the record',
    ((await page.locator('.handover-done').textContent()) || '').includes('Recorded by'));
  const shot = page.locator('.handover-done .photo-tile img');
  check('the distribution photo is shown', await shot.isVisible());
  check('and it actually loaded', (await shot.evaluate((el) => el.naturalWidth)) > 0);
  check('the action is gone once done',
    !(await page.getByRole('button', { name: 'Mark as distributed' }).isVisible()));
  check('no console errors during the handover', errs.length === 0, errs.join(' | '));
}

/* ------------------------------------------------- it shows up for everyone */

console.log('\nThe handover is visible to the other roles');
{
  const { page } = await session();
  await login(page, 'head', 'Head@2026#LRT');
  await page.goto(`${BASE}/approvals?distributed=yes`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  check('the Head Sahayak sees it as distributed',
    ((await page.locator('.table-wrap').textContent()) || '').includes(refs[0]));

  const { page: mp } = await session();
  await login(mp, 'mla', 'Mla@2026#LRT');
  await mp.waitForTimeout(1200);
  check('the MLA rollup reports it as distributed',
    ((await mp.locator('.summary-tiles').textContent()) || '').includes('Distributed'));
  await mp.goto(`${BASE}/forms?status=accepted`, { waitUntil: 'networkidle' });
  await mp.waitForTimeout(900);
  await mp.locator('table.data tr.clickable', { hasText: refs[0] }).click();
  await mp.waitForSelector('.handover-done', { timeout: 10000 });
  check('the MLA can see the proof photo',
    (await mp.locator('.handover-done .photo-tile img').evaluate((el) => el.naturalWidth)) > 0);
  check('the MLA is not offered the handover action',
    !(await mp.getByRole('button', { name: 'Mark as distributed' }).isVisible()));
}

/* ------------------------------------------------------------ phone widths */

console.log('\nOn a phone');
{
  const { page } = await session({ mobile: true });
  await login(page, 'sup.dharma', 'Sup@2026#DHM');
  // 'all', not the default 'no': the one approved application was distributed a
  // few steps ago, so the pending queue is legitimately empty by now and there
  // would be no card to measure.
  await page.goto(`${BASE}/approvals?distributed=all`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check('no horizontal overflow on the approval list', overflow <= 0, `${overflow}px`);

  const cards = await page.locator('.row').count();
  check('the list renders as cards, not a table', cards >= 1, cards);
  const tableVisible = await page.locator('.table-wrap').isVisible();
  check('the table is hidden at phone width', tableVisible === false);

  // Three selects side by side at 390px would be unusable.
  const cols = await page.locator('.filter-row')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  check('the filter row stacks on a phone', cols === 1, `${cols} columns`);

  const fontSize = await page.locator('.filter-row select').first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check('filter selects stay at 16px so iOS does not zoom', fontSize >= 16, fontSize);
}

await browser.close();
console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}`);
process.exit(fail === 0 ? 0 : 1);
