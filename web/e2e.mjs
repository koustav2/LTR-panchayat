/**
 * Browser end-to-end walkthrough on a phone-sized viewport.
 *
 *   node e2e.mjs
 *
 * Drives the real UI the way all three roles would: the supervisor signs in,
 * fills the Sahayak form, watches the Aadhaar autofill populate on a repeat
 * applicant, submits and searches the list; the Head Sahayak verifies and sends
 * one form on; the MLA rejects it with a reason. Screenshots land in ./screens.
 */

import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

let pass = 0;
let fail = 0;
const check = (label, ok, extra) => {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ''}`);
  }
};

const AADHAAR = '999941057058';

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
);

async function session(name) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },      // iPhone 14 class
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const page = await ctx.newPage();
  const errors = [];
  // The app probes /auth/me on cold load to discover whether a session exists.
  // A 401 there is the expected "not signed in" answer, and the browser logs it
  // as a console error regardless — so it is not treated as a failure.
  const expected401 = (text) => /status of 401/.test(text);
  page.on('console', (m) => {
    if (m.type() === 'error' && !expected401(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return { ctx, page, errors, name };
}

const shot = (page, file) => page.screenshot({ path: `${OUT}${file}`, fullPage: true });

async function login(page, username, password) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('.tile', { timeout: 10000 });
}

/* ------------------------------------------------------------ supervisor */

console.log('\nSupervisor journey');
const sup = await session('supervisor');
{
  const { page, errors } = sup;

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot(page, '01-login.png');
  check('login screen renders', await page.getByRole('button', { name: 'Sign in' }).isVisible());

  // 16px inputs are what stop iOS zooming the whole page on focus.
  const fontSize = await page
    .getByLabel('Username')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check('inputs are at least 16px (no iOS zoom on focus)', fontSize >= 16, `${fontSize}px`);

  await login(page, 'sup.dharma', 'Sup@2026#DHM');
  await shot(page, '02-dashboard-supervisor.png');

  const tiles = await page.locator('.tile').count();
  check('supervisor sees all three dashboard tiles', tiles === 3, `${tiles} tiles`);
  check('"Sahayak Form" tile is present', await page.getByText('Sahayak Form', { exact: true }).first().isVisible());
  check('"List of Form Uploaded" tile is present', await page.getByText('List of Form Uploaded').first().isVisible());
  // Scoped to .tiles: the sidebar carries the same words and is display:none at
  // this width, so an unscoped match resolves to the hidden one.
  check('"Approval List" tile is present',
    await page.locator('.tiles').getByText('Approval List').isVisible());

  // No horizontal scrolling on a 390px screen.
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check('dashboard does not scroll sideways on a phone', overflow <= 0, `${overflow}px overflow`);

  await page.getByText('Sahayak Form', { exact: true }).first().click();
  await page.waitForSelector('[data-field="aadhaar"]');
  await shot(page, '03-form-empty.png');

  const dateShown = await page.locator('.datestrip .value').first().textContent();
  check("today's date is shown at the top of the form", /\d{1,2}\s\w+\s\d{4}/.test(dateShown || ''), dateShown);

  const inputMode = await page.locator('[data-field="aadhaar"]').getAttribute('inputmode');
  check('Aadhaar field asks for the numeric keypad', inputMode === 'numeric', inputMode);

  // Block -> Zone -> Panchayat: each level stays locked until its parent is set.
  check('Zone is disabled before a block is picked',
    await page.locator('[data-field="zoneId"]').isDisabled());
  check('Panchayat is disabled before a zone is picked',
    await page.locator('[data-field="panchayatId"]').isDisabled());
  check('Reason of Support is disabled before a type is picked',
    await page.locator('[data-field="supportReasonId"]').isDisabled());

  // ---- first submission (new applicant)
  await page.locator('[data-field="aadhaar"]').fill(AADHAAR);
  await page.waitForTimeout(1200);
  check('a new Aadhaar is reported as a new applicant',
    (await page.locator('.field .hint').first().textContent() || '').includes('New applicant'));

  await page.locator('[data-field="fullName"]').fill('Ramesh Kumar Sahoo');
  await page.locator('[data-field="guardianName"]').fill('Bhagaban Sahoo');
  await page.locator('[data-field="phone"]').fill('9876543210');
  await page.locator('[data-field="pinCode"]').fill('755001');

  await page.locator('[data-field="blockId"]').selectOption({ label: 'Dharmasala' });
  await page.waitForTimeout(150);
  check('Zone unlocks once a block is chosen',
    !(await page.locator('[data-field="zoneId"]').isDisabled()));
  check('Panchayat is still locked until a zone is chosen',
    await page.locator('[data-field="panchayatId"]').isDisabled());

  const zoneOptions = await page.locator('[data-field="zoneId"] option').allTextContents();
  check('Zone list is filtered to that block',
    zoneOptions.length === 4 && zoneOptions.includes('Dharmasala Zone 1') &&
    !zoneOptions.some((z) => z.startsWith('Rasulpur')),
    zoneOptions.join('|'));

  await page.locator('[data-field="zoneId"]').selectOption({ label: 'Dharmasala Zone 2' });
  await page.waitForTimeout(150);
  check('Panchayat unlocks once a zone is chosen',
    !(await page.locator('[data-field="panchayatId"]').isDisabled()));

  const panchayatOptions = await page.locator('[data-field="panchayatId"] option').allTextContents();
  check('Panchayat list is filtered to that zone — ten plus the placeholder',
    panchayatOptions.length === 11, `${panchayatOptions.length} options`);
  check('Zone 2 holds panchayats 11-20, not 1-10',
    panchayatOptions.includes('Dharmasala Panchayat 11') &&
    !panchayatOptions.includes('Dharmasala Panchayat 1'),
    panchayatOptions.slice(1, 3).join('|'));

  // Changing the block must clear BOTH levels below it, not just the next one.
  await page.locator('[data-field="blockId"]').selectOption({ label: 'Rasulpur' });
  await page.waitForTimeout(150);
  check('changing block clears the zone',
    (await page.locator('[data-field="zoneId"]').inputValue()) === '');
  check('changing block re-locks the panchayat',
    await page.locator('[data-field="panchayatId"]').isDisabled());
  await page.locator('[data-field="blockId"]').selectOption({ label: 'Dharmasala' });
  await page.waitForTimeout(150);
  await page.locator('[data-field="zoneId"]').selectOption({ label: 'Dharmasala Zone 2' });
  await page.waitForTimeout(150);
  await page.locator('[data-field="panchayatId"]').selectOption({ index: 1 });

  await page.locator('[data-field="supportTypeId"]').selectOption({ label: 'Education' });
  await page.waitForTimeout(150);
  const reasonOptions = await page.locator('[data-field="supportReasonId"] option').allTextContents();
  check('Reasons are filtered to Education', reasonOptions.includes('School Admission Fee'), reasonOptions.join('|'));
  check('Reasons exclude other support types', !reasonOptions.includes('Dialysis'));
  await page.locator('[data-field="supportReasonId"]').selectOption({ label: 'School Admission Fee' });

  // Amount is required and echoes back formatted, so a stray zero is visible.
  await page.locator('[data-field="amount"]').fill('12500');
  await page.waitForTimeout(200);
  check('amount echoes back in rupees',
    ((await page.locator('.field .hint').allTextContents()).join('|')).includes('12,500'));

  // Validation: "No" must carry a comment.
  await page.locator('[data-field="ppRecommend"] button.no').click();
  await page.getByRole('button', { name: 'Submit Form' }).click();
  await page.waitForTimeout(400);
  check('submitting "No" without a comment is blocked',
    await page.locator('.field .err').first().isVisible());
  await shot(page, '04-form-validation.png');

  await page.locator('[data-field="ppComment"]').fill('Verified — family is in genuine need.');
  await page.locator('[data-field="ppRecommend"] button.yes').click();
  await page.locator('[data-field="msRecommend"] button.yes').click();
  await page.locator('[data-field="mpRecommend"] button.no').click();
  await page.locator('[data-field="mpComment"]').fill('Requires income certificate.');

  await shot(page, '05-form-filled.png');
  await page.getByRole('button', { name: 'Submit Form' }).click();
  await page.waitForSelector('.refbox', { timeout: 15000 });
  await shot(page, '06-submitted.png');

  const ref = (await page.locator('.refbox .v').textContent() || '').trim();
  check('reference number is shown after submit', /^LRT\/DHM\/\d{4}\/\d{6}$/.test(ref), ref);

  // ---- second submission — autofill
  await page.getByRole('button', { name: 'Start a new form' }).click();
  await page.waitForSelector('[data-field="aadhaar"]');
  await page.locator('[data-field="aadhaar"]').fill(AADHAAR);
  await page.waitForSelector('.banner.success', { timeout: 10000 });
  await shot(page, '07-autofill.png');

  check('autofilled name', await page.locator('[data-field="fullName"]').inputValue() === 'Ramesh Kumar Sahoo');
  check('autofilled father/husband name',
    await page.locator('[data-field="guardianName"]').inputValue() === 'Bhagaban Sahoo');
  check('autofilled phone', await page.locator('[data-field="phone"]').inputValue() === '9876543210');
  check('autofilled PIN', await page.locator('[data-field="pinCode"]').inputValue() === '755001');
  check('autofilled block',
    await page.locator('[data-field="blockId"] option:checked').textContent() === 'Dharmasala');
  check('autofilled zone',
    ((await page.locator('[data-field="zoneId"] option:checked').textContent()) || '') === 'Dharmasala Zone 2');
  check('autofilled panchayat',
    ((await page.locator('[data-field="panchayatId"] option:checked').textContent()) || '')
      .startsWith('Dharmasala Panchayat'));
  check('autofilled fields are locked until "Edit" is pressed',
    await page.locator('[data-field="fullName"]').getAttribute('readonly') !== null);
  check('previous application count is shown',
    ((await page.locator('.banner.success').textContent()) || '').includes('1 previous application'));

  await page.getByRole('button', { name: 'Edit these details' }).click();
  check('"Edit these details" unlocks the fields',
    await page.locator('[data-field="fullName"]').getAttribute('readonly') === null);

  await page.locator('[data-field="supportTypeId"]').selectOption({ label: 'Health' });
  await page.waitForTimeout(150);
  await page.locator('[data-field="supportReasonId"]').selectOption({ label: 'Dialysis' });
  await page.locator('[data-field="amount"]').fill('30000');
  await page.locator('[data-field="ppRecommend"] button.yes').click();
  await page.locator('[data-field="msRecommend"] button.yes').click();
  await page.locator('[data-field="mpRecommend"] button.yes').click();
  await page.getByRole('button', { name: 'Submit Form' }).click();
  await page.waitForSelector('.refbox', { timeout: 15000 });
  const ref2 = (await page.locator('.refbox .v').textContent() || '').trim();
  check('second application gets a different reference number', ref2 !== ref, `${ref} vs ${ref2}`);

  // ---- list & search
  await page.getByRole('button', { name: 'View my forms' }).click();
  await page.waitForSelector('.row', { timeout: 10000 });
  await shot(page, '08-list.png');
  check('both submissions appear in the list', (await page.locator('.row').count()) === 2);

  await page.getByLabel('Search forms').fill(ref);
  await page.waitForTimeout(900);
  check('search by reference number narrows to one', (await page.locator('.row').count()) === 1);

  await page.getByLabel('Search forms').fill('Ramesh');
  await page.waitForTimeout(900);
  check('search by name works', (await page.locator('.row').count()) >= 1);

  await page.getByLabel('Clear search').click();
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /^Accepted/ }).click();
  await page.waitForTimeout(900);
  check('filtering by Accepted shows the empty state', await page.locator('.empty').isVisible());
  await shot(page, '09-list-empty-filter.png');

  await page.getByRole('button', { name: /^With Head/ }).click();
  await page.waitForTimeout(900);
  check('a new form starts with the Head Sahayak', (await page.locator('.row').count()) === 2);
  check('the badge names the stage',
    ((await page.locator('.row .badge').first().textContent()) || '').includes('Head'));

  check('no console errors during the supervisor journey', errors.length === 0, errors.join(' | '));
  globalThis.__ref = ref;
}

/* ------------------------------------------------------- Head Sahayak --- */

console.log('\nHead Sahayak journey');
const headS = await session('head');
{
  const { page, errors } = headS;

  await login(page, 'head', 'Head@2026#LRT');
  await shot(page, '10a-dashboard-head.png');

  const tiles = await page.locator('.tile').count();
  // The list and the approval list, but no form entry — the head verifies and
  // hands over; they do not file.
  check('Head Sahayak sees the list and approval tiles, but no form entry',
    tiles === 2 && !(await page.getByText('Sahayak Form', { exact: true }).first().isVisible().catch(() => false)),
    `${tiles} tiles`);
  check('Head Sahayak sees a queue of 2 waiting on them',
    (await page.locator('.count.wait .n').textContent()) === '2');
  check('the ringed tile is the head’s own queue',
    await page.locator('.count.wait.mine').isVisible());

  await page.getByText('List of Form Uploaded').first().click();
  await page.waitForSelector('.row', { timeout: 10000 });
  check('Head Sahayak sees every supervisor’s forms', (await page.locator('.row').count()) === 2);
  check('the head’s own queue chip comes first, ahead of All',
    ((await page.locator('.chip').first().textContent()) || '').includes('To verify'),
    JSON.stringify(await page.locator('.chip').allTextContents()));
  await shot(page, '10b-list-head.png');

  await page.locator('.row').filter({ hasText: globalThis.__ref }).click();
  await page.waitForSelector('.pipeline', { timeout: 10000 });
  check('the progress rail is shown', (await page.locator('.pl-step').count()) === 3);
  check('the MLA step is not yet reached',
    await page.locator('.pl-step.todo').isVisible());
  check('Send to MLA and Reject are offered',
    (await page.getByRole('button', { name: 'Send to MLA' }).isVisible()) &&
    (await page.getByRole('button', { name: 'Reject' }).isVisible()));
  await shot(page, '10c-detail-head.png');

  await page.getByRole('button', { name: 'Send to MLA' }).click();
  await page.waitForSelector('.modal');
  check('Send to MLA is disabled until a comment is typed',
    await page.locator('.modal').getByRole('button', { name: 'Send to MLA' }).isDisabled());
  await shot(page, '10d-forward-modal.png');

  await page.locator('.modal [data-field="headComment"]').fill('Documents verified at the panchayat office.');
  await page.locator('.modal').getByRole('button', { name: 'Send to MLA' }).click();
  await page.waitForSelector('.detail-side .badge.pending_mla', { timeout: 10000 });
  check('status becomes With MLA',
    await page.locator('.detail-side .badge.pending_mla').first().isVisible());
  check('the verification comment is shown on the record',
    ((await page.locator('.stage-note').textContent()) || '').includes('Documents verified'));
  check('the head cannot verify the same form twice',
    !(await page.getByRole('button', { name: 'Send to MLA' }).isVisible()));
  await shot(page, '10e-forwarded.png');

  check('no console errors during the Head Sahayak journey', errors.length === 0, errors.join(' | '));
}

/* ------------------------------------------------------------------ MLA */

console.log('\nMLA journey');
const mla = await session('mla');
{
  const { page, errors } = mla;

  await login(page, 'mla', 'Mla@2026#LRT');
  await shot(page, '10-dashboard-mla.png');

  const tiles = await page.locator('.tile').count();
  // The MLA decides; they neither file nor hand over, so exactly one tile.
  check('MLA sees only the list tile — no form entry, no approval list',
    tiles === 1, `${tiles} tiles`);
  check('MLA sees one form waiting on them',
    (await page.locator('.count.sent .n').textContent()) === '1');
  check('MLA sees the other still in verification',
    (await page.locator('.count.wait .n').textContent()) === '1');

  await page.getByText('List of Form Uploaded').first().click();
  await page.waitForSelector('.row', { timeout: 10000 });
  await shot(page, '11-list-mla.png');
  check('MLA sees the supervisor’s forms', (await page.locator('.row').count()) === 2);
  check('MLA list shows who submitted each form',
    ((await page.locator('.row').first().textContent()) || '').includes('Submitted by'));
  check('MLA has a CSV export link', await page.getByText('Export CSV').isVisible());

  await page.locator('.row').filter({ hasText: globalThis.__ref }).click();
  await page.waitForSelector('.rec', { timeout: 10000 });
  await shot(page, '12-detail-mla.png');

  check('all three recommendations are rendered', (await page.locator('.rec').count()) === 3);
  check('Aadhaar is masked by default',
    ((await page.locator('.dl').first().textContent()) || '').includes('XXXX XXXX'));

  await page.getByRole('button', { name: 'Show' }).click();
  await page.waitForTimeout(700);
  check('Aadhaar can be revealed on demand',
    ((await page.locator('.dl').first().textContent()) || '').includes(AADHAAR));

  check('the head’s comment is visible to the MLA',
    ((await page.locator('.stage-note').textContent()) || '').includes('Documents verified'));
  check('Accept and Reject are offered on a verified form',
    (await page.getByRole('button', { name: 'Accept' }).isVisible()) &&
    (await page.getByRole('button', { name: 'Reject' }).isVisible()));

  // The other form is still with the Head Sahayak, so the MLA must be told why
  // there is nothing to press rather than shown a panel with no buttons.
  await page.goBack();
  await page.waitForSelector('.row', { timeout: 10000 });
  await page.locator('.row').filter({ hasText: 'With Head' }).first().click();
  await page.waitForSelector('.detail-side', { timeout: 10000 });
  check('an unverified form offers the MLA no decision buttons',
    !(await page.getByRole('button', { name: 'Accept' }).isVisible()));
  check('and says why',
    ((await page.locator('.detail-side .banner').textContent()) || '').includes('Head Sahayak'));
  await page.goBack();
  await page.waitForSelector('.row', { timeout: 10000 });
  await page.locator('.row').filter({ hasText: globalThis.__ref }).click();
  await page.waitForSelector('.rec', { timeout: 10000 });

  await page.getByRole('button', { name: 'Reject' }).click();
  await page.waitForSelector('.modal');
  await shot(page, '13-reject-modal.png');
  check('Reject is disabled until a reason is typed',
    await page.locator('.modal').getByRole('button', { name: 'Reject' }).isDisabled());

  await page.locator('.modal [data-field="rejectReason"]').fill('Income certificate not attached.');
  await page.locator('.modal').getByRole('button', { name: 'Reject' }).click();
  await page.waitForSelector('.detail-side .badge.rejected', { timeout: 10000 });
  await shot(page, '14-rejected.png');
  check('status becomes Rejected', await page.locator('.detail-side .badge.rejected').first().isVisible());
  check('the reason is shown on the detail page',
    ((await page.locator('.row-reject').textContent()) || '').includes('Income certificate'));
  check('a rejected form shows no sanctioned amount',
    ((await page.locator('.money-pair').textContent()) || '').includes('—'));
  check('accept/reject disappear once decided',
    !(await page.getByRole('button', { name: 'Accept' }).isVisible()));

  check('no console errors during the MLA journey', errors.length === 0, errors.join(' | '));
}

/* ------------------------------- supervisor sees the rejection reason --- */

console.log('\nSupervisor sees the outcome');
{
  const { page, errors } = await session('supervisor2');
  await login(page, 'sup.dharma', 'Sup@2026#DHM');
  await page.getByText('List of Form Uploaded').first().click();
  await page.waitForSelector('.row', { timeout: 10000 });
  await shot(page, '15-list-rejected.png');
  check('the rejection reason is visible inline in the list',
    ((await page.locator('.row-reject').first().textContent()) || '').includes('Income certificate'));
  check('no console errors', errors.length === 0, errors.join(' | '));
}

/* ------------------------------------------------- desktop sanity check */

console.log('\nDesktop layout');
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await login(page, 'sup.dharma', 'Sup@2026#DHM');
  await page.getByText('Sahayak Form', { exact: true }).first().click();
  await page.waitForSelector('[data-field="aadhaar"]');
  await page.screenshot({ path: `${OUT}16-desktop-form.png`, fullPage: true });
  const cols = await page.locator('.section-body.two-col').first()
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  check('the form goes two-column on a wide screen', cols === 2, `${cols} columns`);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check('no horizontal overflow on desktop', overflow <= 0, `${overflow}px`);
}

await browser.close();

console.log(`\n${'='.repeat(46)}`);
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(46));
process.exit(fail === 0 ? 0 : 1);
