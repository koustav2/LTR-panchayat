/**
 * Browser end-to-end walkthrough on a phone-sized viewport.
 *
 *   node e2e.mjs
 *
 * Drives the real UI the way a supervisor and the MLA would: sign in, fill the
 * Sahayak form, watch the Aadhaar autofill populate on a repeat applicant,
 * submit, search the list, then sign in as the MLA and reject with a reason.
 * Screenshots land in ./screens.
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
  check('supervisor sees both dashboard tiles', tiles === 2, `${tiles} tiles`);
  check('"Sahayak Form" tile is present', await page.getByText('Sahayak Form', { exact: true }).first().isVisible());
  check('"List of Form Uploaded" tile is present', await page.getByText('List of Form Uploaded').first().isVisible());

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

  // Panchayat must stay locked until a block is chosen.
  check('Panchayat is disabled before a block is picked',
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
  check('Panchayat unlocks once a block is chosen',
    !(await page.locator('[data-field="panchayatId"]').isDisabled()));

  const panchayatOptions = await page.locator('[data-field="panchayatId"] option').count();
  check('Panchayat list is filtered to that block', panchayatOptions === 13, `${panchayatOptions} options incl. placeholder`);
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
  check('autofilled panchayat',
    ((await page.locator('[data-field="panchayatId"] option:checked').textContent()) || '').startsWith('Panchayat'));
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

  check('no console errors during the supervisor journey', errors.length === 0, errors.join(' | '));
  globalThis.__ref = ref;
}

/* ------------------------------------------------------------------ MLA */

console.log('\nMLA journey');
const mla = await session('mla');
{
  const { page, errors } = mla;

  await login(page, 'mla', 'Mla@2026#LRT');
  await shot(page, '10-dashboard-mla.png');

  const tiles = await page.locator('.tile').count();
  check('MLA sees only the list tile (no form entry)', tiles === 1, `${tiles} tiles`);
  check('MLA pending count is shown', await page.locator('.count.pending .n').textContent() === '2');

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

  check('Accept and Reject are offered on a pending form',
    (await page.getByRole('button', { name: 'Accept' }).isVisible()) &&
    (await page.getByRole('button', { name: 'Reject' }).isVisible()));

  await page.getByRole('button', { name: 'Reject' }).click();
  await page.waitForSelector('.modal');
  await shot(page, '13-reject-modal.png');
  check('Reject is disabled until a reason is typed',
    await page.locator('.modal').getByRole('button', { name: 'Reject' }).isDisabled());

  await page.locator('.modal [data-field="rejectReason"]').fill('Income certificate not attached.');
  await page.locator('.modal').getByRole('button', { name: 'Reject' }).click();
  await page.waitForSelector('.detail-group .badge.rejected', { timeout: 10000 });
  await shot(page, '14-rejected.png');
  check('status becomes Rejected', await page.locator('.detail-group .badge.rejected').first().isVisible());
  check('the reason is shown on the detail page',
    ((await page.locator('.row-reject').textContent()) || '').includes('Income certificate'));
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
