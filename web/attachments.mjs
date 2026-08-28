/**
 * Browser test for the three detail-page changes:
 *
 *   1. The MLA can leave a comment when accepting as well as rejecting.
 *   2. The applicant photo and every supporting document appear on the detail
 *      page, for the supervisor and the MLA alike — including for a repeat
 *      applicant who did not re-upload their photo.
 *   3. Type of Support and Reason of Support are shown explicitly.
 *
 * Uploads real files, so it needs a clean database:
 *   node attachments.mjs
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE || 'http://localhost:4000';
const HERE = path.dirname(new URL(import.meta.url).pathname);
const OUT = path.join(HERE, 'screens') + '/';
fs.mkdirSync(OUT, { recursive: true });

const PHOTO = path.join(HERE, 'fixtures', 'applicant.jpg');
const DOC = path.join(HERE, 'fixtures', 'income-certificate.pdf');

let pass = 0;
let fail = 0;
const check = (l, ok, x) => {
  if (ok) { pass += 1; console.log(`  PASS  ${l}`); }
  else { fail += 1; console.log(`  FAIL  ${l}${x !== undefined ? ` — ${x}` : ''}`); }
};

const AADHAAR = '999941057058';

const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}
);

async function session(width = 1440, height = 1000) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  return { ctx, page, errs };
}

async function login(page, u, p) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByLabel('Username').fill(u);
  await page.getByLabel('Password').fill(p);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('.tiles', { timeout: 10000 });
}

/** Fills and submits one application. Returns its reference number. */
/** The figure every form in this run is filed for, and what the MLA cuts it to. */
const REQUESTED = '12500';
const SANCTIONED = '9000';

async function submitForm(page, { supportType, supportReason, withFiles, amount = REQUESTED }) {
  await page.goto(`${BASE}/form`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-field="aadhaar"]');

  await page.locator('[data-field="aadhaar"]').fill(AADHAAR);
  await page.waitForTimeout(1300);

  // Only fill identity when this is a new applicant; otherwise it autofills
  // and the fields are read-only.
  const locked = await page.locator('[data-field="fullName"]').getAttribute('readonly');
  if (locked === null) {
    await page.locator('[data-field="fullName"]').fill('Ramesh Kumar Sahoo');
    await page.locator('[data-field="guardianName"]').fill('Bhagaban Sahoo');
    await page.locator('[data-field="phone"]').fill('9876543210');
    await page.locator('[data-field="pinCode"]').fill('755001');
    await page.locator('[data-field="blockId"]').selectOption({ label: 'Dharmasala' });
    await page.waitForTimeout(200);
    await page.locator('[data-field="panchayatId"]').selectOption({ index: 1 });
  }

  await page.locator('[data-field="supportTypeId"]').selectOption({ label: supportType });
  await page.waitForTimeout(250);
  await page.locator('[data-field="supportReasonId"]').selectOption({ label: supportReason });
  await page.locator('[data-field="amount"]').fill(amount);

  await page.locator('[data-field="ppRecommend"] button.yes').click();
  await page.locator('[data-field="msRecommend"] button.yes').click();
  await page.locator('[data-field="mpRecommend"] button.yes').click();

  if (withFiles) {
    await page.locator('input[type=file][accept="image/*"]').setInputFiles(PHOTO);
    await page.waitForSelector('.photo-preview img', { timeout: 20000 });

    const img = page.locator('.photo-preview img');
    check('preview appears straight after choosing the file', await img.isVisible());
    check('preview image actually renders', (await img.evaluate((el) => el.naturalWidth)) > 0);
    check('preview shows the file name',
      ((await page.locator('.photo-preview-meta .name').textContent()) || '').includes('applicant'));
    check('preview offers Replace and Remove',
      (await page.locator('.photo-preview-actions button').count()) === 2);

    await page.locator('input[type=file][multiple]').setInputFiles(DOC);
    await page.waitForTimeout(2500);
  }

  await page.getByRole('button', { name: 'Submit Form' }).click();
  // A repeat submission of the same support type triggers the duplicate guard.
  const dup = page.getByRole('button', { name: 'Submit anyway' });
  if (await dup.isVisible().catch(() => false)) await dup.click();

  await page.waitForSelector('.refbox', { timeout: 20000 });
  return (await page.locator('.refbox .v').textContent()).trim();
}

/* ---------------------------------------------- supervisor submits ------- */

console.log('\nSupervisor submits with a photo and a document');
const sup = await session();
let refWithFiles;
let refNoReupload;
{
  const { page, errs } = sup;
  await login(page, 'sup.dharma', 'Sup@2026#DHM');

  refWithFiles = await submitForm(page, {
    supportType: 'Education',
    supportReason: 'School Admission Fee',
    withFiles: true,
  });
  check('application with attachments submitted', /^LRT\/DHM\//.test(refWithFiles), refWithFiles);

  // Second application, same Aadhaar, no photo re-uploaded. This is the case
  // that previously showed no photo at all on the detail page.
  await page.getByRole('button', { name: 'Start a new form' }).click();
  refNoReupload = await submitForm(page, {
    supportType: 'Health',
    supportReason: 'Dialysis',
    withFiles: false,
  });
  check('repeat application without re-upload submitted', /^LRT\/DHM\//.test(refNoReupload), refNoReupload);

  check('no page errors during submission', errs.length === 0, errs.join('|'));
}

/* ---------------------------------------- supervisor sees attachments ---- */

console.log('\nSupervisor detail page');
{
  const { page, errs } = sup;
  await page.goto(`${BASE}/forms`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('table.data tr.clickable', { hasText: refWithFiles }).click();
  await page.waitForSelector('.support-callout', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}a1-supervisor-detail.png`, fullPage: true });

  check('Support Requested section is shown',
    (await page.locator('.support-type').textContent()) === 'Education');
  check('Reason of Support is shown',
    (await page.locator('.support-reason').textContent()) === 'School Admission Fee');
  check('Amount Requested is shown on the detail page',
    ((await page.locator('.support-amount').first().textContent()) || '').includes('12,500'),
    await page.locator('.support-amount').first().textContent());

  const photoImg = page.locator('.photo-tile img');
  check('applicant photo is rendered', await photoImg.isVisible());
  const natural = await photoImg.evaluate((el) => el.naturalWidth);
  check('the photo actually loaded (not a broken image)', natural > 0, `naturalWidth=${natural}`);

  check('supporting document is listed',
    (await page.locator('.attachments a').count()) >= 2,
    await page.locator('.attachments a').count());
  check('document filename is shown',
    (await page.locator('.attachments .cap').allTextContents()).some((t) => t.includes('income-certificate')));

  check('no page errors', errs.length === 0, errs.join('|'));
}

/* ------------------------------- repeat applicant falls back to the photo -- */

console.log('\nRepeat application — photo falls back to the beneficiary record');
{
  const { page } = sup;
  await page.goto(`${BASE}/forms`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('table.data tr.clickable', { hasText: refNoReupload }).click();
  await page.waitForSelector('.support-callout', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}a2-repeat-detail.png`, fullPage: true });

  check('support type reflects the second application',
    (await page.locator('.support-type').textContent()) === 'Health');

  const photoImg = page.locator('.photo-tile img');
  check('photo still shown even though it was not re-uploaded', await photoImg.isVisible());
  const natural = await photoImg.evaluate((el) => el.naturalWidth);
  check('fallback photo actually loaded', natural > 0, `naturalWidth=${natural}`);
  check('no documents on this one, and it says so',
    (await page.locator('.no-files').count()) === 1);
}

/* --------------------------- preview survives a reload (dead blob URL) ---- */

console.log('\nDraft restored after reload still shows the photo');
{
  const { page } = await session();
  await login(page, 'sup.dharma', 'Sup@2026#DHM');
  await page.goto(`${BASE}/form`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-field="aadhaar"]');
  await page.locator('[data-field="aadhaar"]').fill(AADHAAR);
  await page.waitForTimeout(1300);
  await page.locator('input[type=file][accept="image/*"]').setInputFiles(PHOTO);
  await page.waitForSelector('.photo-preview img', { timeout: 20000 });
  await page.waitForTimeout(900); // let the draft autosave

  // Reload. The blob: URL saved in the draft is now dead — the component must
  // fall back to fetching the uploaded file from the server.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.photo-preview img', { timeout: 15000 });
  // Wait for the image to actually decode rather than sleeping a fixed amount —
  // the fallback fetch has to round-trip to the server.
  await page
    .waitForFunction(() => {
      const el = document.querySelector('.photo-preview img');
      return el && el.naturalWidth > 0;
    }, { timeout: 15000 })
    .catch(() => {});
  await page.screenshot({ path: `${OUT}a8-restored-draft.png`, fullPage: true });

  const w = await page.locator('.photo-preview img').evaluate((el) => el.naturalWidth);
  check('restored draft still renders the photo, not a broken image', w > 0, `naturalWidth=${w}`);

  // Leave nothing behind for the next block.
  await page.evaluate(() => localStorage.clear());
}

/* ------------------------------------------------- MLA accepts with note -- */

// The MLA never sees an unverified form as actionable, so the Head Sahayak has
// to send this one on first. That step is also where the attachments get their
// first pair of eyes, so it is checked here rather than skipped past.
console.log('\nHead Sahayak verifies the form with attachments');
{
  const { page, errs } = await session();
  await login(page, 'head', 'Head@2026#LRT');
  await page.goto(`${BASE}/forms`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('table.data tr.clickable', { hasText: refWithFiles }).click();
  await page.waitForSelector('.support-callout', { timeout: 10000 });

  check('Head Sahayak sees the applicant photo',
    await page.locator('.photo-tile img').isVisible());
  check('Head Sahayak sees the supporting document',
    (await page.locator('.attachments a').count()) >= 2);
  const moneyText = (await page.locator('.money-pair').textContent()) || '';
  check('sanctioned reads as not-yet-decided, never as zero',
    moneyText.includes('not yet verified') && !/₹\s*0\b/.test(moneyText), moneyText);

  await page.getByRole('button', { name: 'Send to MLA' }).click();
  await page.waitForSelector('.modal');
  await page.locator('.modal [data-field="headComment"]').fill('Photo and income certificate both checked.');
  await page.locator('.modal').getByRole('button', { name: 'Send to MLA' }).click();
  // The badge inside .detail-group is the phone-layout duplicate and is hidden
  // from 1024px up, which is the width this suite runs at. The sidebar Status
  // card carries it at every width.
  await page.waitForSelector('.detail-side .badge.pending_mla', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}a2b-head-forwarded.png`, fullPage: true });
  check('no page errors', errs.length === 0, errs.join('|'));
}

console.log('\nMLA detail page, amount edit, and accept with a comment');
{
  const { page, errs } = await session();
  await login(page, 'mla', 'Mla@2026#LRT');
  await page.goto(`${BASE}/forms`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('table.data tr.clickable', { hasText: refWithFiles }).click();
  await page.waitForSelector('.support-callout', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}a3-mla-detail.png`, fullPage: true });

  check('MLA sees the Support Requested section',
    (await page.locator('.support-type').textContent()) === 'Education');
  const photoImg = page.locator('.photo-tile img');
  check('MLA sees the applicant photo', await photoImg.isVisible());
  check('MLA photo actually loaded', (await photoImg.evaluate((el) => el.naturalWidth)) > 0);
  check('MLA sees the supporting document',
    (await page.locator('.attachments a').count()) >= 2);

  check('the head’s comment carries through to the MLA',
    ((await page.locator('.stage-note').textContent()) || '').includes('income certificate both checked'));

  await page.getByRole('button', { name: 'Accept' }).click();
  await page.waitForSelector('.modal');
  await page.screenshot({ path: `${OUT}a4-accept-modal.png`, fullPage: true });
  check('Accept opens a comment box', await page.locator('.modal [data-field="mlaComment"]').isVisible());
  check('Accept prefills the sanctioned amount with what was requested',
    (await page.locator('.modal [data-field="approvedAmount"]').inputValue()) === REQUESTED,
    `${await page.locator('.modal [data-field="approvedAmount"]').inputValue()} vs ${REQUESTED}`);

  // A zero sanction must be refused in the browser, not only by the server.
  await page.locator('.modal [data-field="approvedAmount"]').fill('0');
  await page.waitForTimeout(200);
  check('a zero sanction disables Accept',
    await page.locator('.modal').getByRole('button', { name: 'Accept' }).isDisabled());

  // Deduct, and confirm the preview says so before anything is saved.
  await page.locator('.modal [data-field="approvedAmount"]').fill(SANCTIONED);
  await page.waitForTimeout(200);
  check('the preview spells out the deduction',
    ((await page.locator('.sanction-preview .d').textContent()) || '').includes('below the requested'));
  await page.screenshot({ path: `${OUT}a4b-accept-deducted.png`, fullPage: true });

  await page.locator('.modal [data-field="mlaComment"]').fill('Approved for Rs. 10,000 towards school fees.');
  await page.locator('.modal').getByRole('button', { name: 'Accept' }).click();
  await page.waitForSelector('.mla-note', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}a5-accepted-with-comment.png`, fullPage: true });

  check('status becomes Accepted',
    (await page.locator('.detail-side .badge.accepted').isVisible()));
  check('the accept comment is displayed',
    ((await page.locator('.mla-note').textContent()) || '').includes('Rs. 10,000 towards school fees'));
  check('the sanctioned amount replaces the dash',
    ((await page.locator('.support-amount.granted').textContent()) || '').length > 0);
  check('the deduction is shown against the requested figure',
    ((await page.locator('.support-amount .delta').textContent()) || '').includes('vs requested'));
  check('no page errors', errs.length === 0, errs.join('|'));
}

/* ------------------------------- supervisor sees the MLA's accept comment -- */

console.log('\nSupervisor sees the MLA comment');
{
  const { page } = sup;
  await page.goto(`${BASE}/forms`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.locator('table.data tr.clickable', { hasText: refWithFiles }).click();
  await page.waitForSelector('.mla-note', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}a6-supervisor-sees-comment.png`, fullPage: true });
  check('supervisor sees the MLA comment on an accepted form',
    ((await page.locator('.mla-note').textContent()) || '').includes('Rs. 10,000 towards school fees'));
}

/* ------------------------------------------------- MLA amount summary ----- */

console.log('\nMLA dashboard amount summary');
{
  const { page, errs } = await session();
  await login(page, 'mla', 'Mla@2026#LRT');
  await page.waitForSelector('.summary-card', { timeout: 15000 });
  await page.screenshot({ path: `${OUT}a9-mla-summary.png`, fullPage: true });

  check('summary card is on the MLA dashboard', await page.locator('.summary-card').isVisible());
  check('five headline tiles are shown — one per stage plus the two money totals',
    (await page.locator('.summary-tiles .stat').count()) === 5,
    await page.locator('.summary-tiles .stat').count());
  check('the rule is stated on screen',
    ((await page.locator('.summary-note').textContent()) || '').includes('only counted once they decide'),
    await page.locator('.summary-note').textContent());

  const headers = await page.locator('.summary-table th').allTextContents();
  check('the table separates requested from sanctioned',
    ['Requested', 'Sanctioned', 'With Head', 'With MLA', 'Rejected'].every((h) => headers.includes(h)),
    headers.join('|'));

  // This run sanctioned 9,000 against a 12,500 request, so the two money tiles
  // must disagree and the variance must name the 3,500 difference.
  const requestedTile = (await page.locator('.summary-tiles .requested .n').textContent()) || '';
  const sanctionedTile = (await page.locator('.summary-tiles .sanctioned .n').textContent()) || '';
  check('the requested tile is not the sanctioned tile',
    requestedTile !== sanctionedTile, `${requestedTile} vs ${sanctionedTile}`);
  check('the sanctioned tile shows what the MLA actually granted',
    sanctionedTile.includes('9,000'), sanctionedTile);
  check('the MLA’s deduction is reported as a variance',
    ((await page.locator('.summary-tiles .sanctioned .var').textContent()) || '').includes('3,500'),
    await page.locator('.summary-tiles .sanctioned .c').textContent());

  check('block rows are present', (await page.locator('.summary-table .block-row').count()) >= 1);
  check('panchayat rows are shown under a block',
    (await page.locator('.summary-table .panchayat-row').count()) >= 1);
  check('a grand total row is present', await page.locator('.summary-table .grand-row').isVisible());

  // Collapsing a block hides its panchayats.
  const before = await page.locator('.summary-table .panchayat-row').count();
  await page.locator('.summary-table .block-row').first().click();
  await page.waitForTimeout(300);
  const after = await page.locator('.summary-table .panchayat-row').count();
  check('clicking a block collapses its panchayats', after < before, `${before} -> ${after}`);

  check('no page errors on the dashboard', errs.length === 0, errs.join('|'));
}

console.log('\nHead Sahayak sees the same summary as the MLA');
{
  const { page, errs } = await session();
  await login(page, 'head', 'Head@2026#LRT');
  await page.waitForSelector('.summary-card', { timeout: 15000 });
  check('summary card is on the Head Sahayak dashboard',
    await page.locator('.summary-card').isVisible());
  check('the head sees the same sanctioned total as the MLA',
    ((await page.locator('.summary-tiles .sanctioned .n').textContent()) || '').includes('9,000'));
  check('no page errors on the head dashboard', errs.length === 0, errs.join('|'));
}

console.log('\nSupervisor must not see the summary');
{
  const { page } = await session();
  await login(page, 'sup.dharma', 'Sup@2026#DHM');
  await page.waitForTimeout(1200);
  check('supervisor dashboard has no amount summary',
    (await page.locator('.summary-card').count()) === 0);
}

/* ------------------------------------------------------- mobile check ----- */

console.log('\nMobile detail page');
{
  const { page } = await session(390, 844);
  await login(page, 'mla', 'Mla@2026#LRT');
  await page.goto(`${BASE}/forms`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.locator('.row').filter({ hasText: refWithFiles }).click();
  await page.waitForSelector('.support-callout', { timeout: 10000 });
  await page.screenshot({ path: `${OUT}a7-mobile-detail.png`, fullPage: true });

  check('support section renders on mobile', await page.locator('.support-type').isVisible());
  check('photo renders on mobile', await page.locator('.photo-tile img').isVisible());
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  check('no horizontal overflow on mobile detail', overflow <= 0, `${overflow}px`);
}

await browser.close();
console.log(`\n${'='.repeat(46)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(46)}`);
process.exit(fail === 0 ? 0 : 1);
