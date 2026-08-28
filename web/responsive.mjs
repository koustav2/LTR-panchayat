/**
 * Responsive verification at three widths, for both roles.
 * Confirms the phone layout is untouched and the desktop layout engages.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4000';
const OUT = new URL('./screens/', import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
const check = (l, ok, x) => { ok ? (pass++, console.log(`  PASS  ${l}`)) : (fail++, console.log(`  FAIL  ${l}${x ? ` — ${x}` : ''}`)); };

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });

const WIDTHS = [
  { name: 'phone',   w: 390,  h: 844,  sidebar: false, table: false },
  { name: 'tablet',  w: 768,  h: 1024, sidebar: false, table: false },
  { name: 'desktop', w: 1440, h: 900,  sidebar: true,  table: true  },
];

async function login(page, u, p) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByLabel('Username').fill(u);
  await page.getByLabel('Password').fill(p);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForSelector('.tiles', { timeout: 10000 });
}

const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const vp of WIDTHS) {
  console.log(`\n${vp.name} — ${vp.w}px`);
  const ctx = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e)));

  await login(page, 'sup.dharma', 'Sup@2026#DHM');
  await page.screenshot({ path: `${OUT}r-${vp.name}-1-dashboard.png`, fullPage: true });

  check(`sidebar ${vp.sidebar ? 'shown' : 'hidden'}`, (await visible(page, '.sidebar')) === vp.sidebar);
  check(`mobile top bar ${vp.sidebar ? 'hidden' : 'shown'}`, (await visible(page, '.topbar')) === !vp.sidebar);
  check('no horizontal overflow on dashboard', (await overflow(page)) <= 0, `${await overflow(page)}px`);

  // list
  await page.goto(`${BASE}/forms`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}r-${vp.name}-2-list.png`, fullPage: true });
  check(`list renders as ${vp.table ? 'a table' : 'cards'}`,
    (await visible(page, 'table.data')) === vp.table && (await visible(page, '.row')) === !vp.table);
  check('no horizontal overflow on list', (await overflow(page)) <= 0, `${await overflow(page)}px`);

  // form
  await page.goto(`${BASE}/form`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-field="aadhaar"]');
  await page.screenshot({ path: `${OUT}r-${vp.name}-3-form.png`, fullPage: true });
  const cols = await page.locator('.section-body.two-col').first()
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  check(`form is ${vp.w >= 1024 ? 'two' : 'single'} column`, cols === (vp.w >= 1024 ? 2 : 1), `${cols}`);
  check('inputs stay at 16px+', await page.locator('[data-field="aadhaar"]')
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)) >= 16);
  check('no horizontal overflow on form', (await overflow(page)) <= 0, `${await overflow(page)}px`);

  // The MLA can only decide a form the Head Sahayak has forwarded, so clear the
  // verification queue first. This runs once per viewport and is a no-op after
  // the first pass, when nothing is left waiting.
  const hctx = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
  const hp = await hctx.newPage();
  await login(hp, 'head', 'Head@2026#LRT');
  await hp.goto(`${BASE}/forms?status=pending_head`, { waitUntil: 'networkidle' });
  await hp.waitForTimeout(1200);
  const waiting = vp.table
    ? await hp.locator('table.data tr.clickable').count()
    : await hp.locator('.row').count();
  for (let i = 0; i < waiting; i += 1) {
    const row = vp.table ? hp.locator('table.data tr.clickable').first() : hp.locator('.row').first();
    await row.click();
    await hp.waitForSelector('.detail-side', { timeout: 10000 });
    await hp.getByRole('button', { name: 'Send to MLA' }).click();
    await hp.waitForSelector('.modal');
    await hp.locator('.modal [data-field="headComment"]').fill('Verified for the responsive run.');
    await hp.locator('.modal').getByRole('button', { name: 'Send to MLA' }).click();
    await hp.waitForSelector('.detail-side .badge.pending_mla', { timeout: 10000 });
    await hp.goto(`${BASE}/forms?status=pending_head`, { waitUntil: 'networkidle' });
    await hp.waitForTimeout(900);
  }
  if (vp.sidebar) {
    check('the head sidebar names the role',
      ((await hp.locator('.sidebar-user .r').textContent()) || '').includes('Head Sahayak'));
  }
  await hctx.close();

  // MLA detail
  const mctx = await b.newContext({ viewport: { width: vp.w, height: vp.h } });
  const mp = await mctx.newPage();
  await login(mp, 'mla', 'Mla@2026#LRT');
  await mp.goto(`${BASE}/forms?status=pending_mla`, { waitUntil: 'networkidle' });
  await mp.waitForTimeout(1200);
  await mp.screenshot({ path: `${OUT}r-${vp.name}-4-mla-list.png`, fullPage: true });
  if (vp.table) {
    const heads = await mp.locator('table.data th').allTextContents();
    check('MLA table has a "Submitted by" column', heads.includes('Submitted by'), heads.join('|'));
    check('MLA table separates Requested from Sanctioned',
      heads.includes('Requested') && heads.includes('Sanctioned'), heads.join('|'));
  } else {
    check('list cards label both money figures',
      ((await mp.locator('.row-money').first().textContent()) || '').includes('Sanctioned'));
  }
  const target = vp.table ? mp.locator('table.data tr.clickable').first() : mp.locator('.row').first();
  await target.click();
  await mp.waitForSelector('.rec', { timeout: 10000 });
  await mp.screenshot({ path: `${OUT}r-${vp.name}-5-mla-detail.png`, fullPage: true });

  const layoutCols = await mp.locator('.detail-layout')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  check(`detail is ${vp.sidebar ? 'two' : 'single'} column`, layoutCols === (vp.sidebar ? 2 : 1), `${layoutCols}`);
  check('decision buttons reachable', await mp.getByRole('button', { name: 'Accept' }).isVisible());
  // Visible is not the same as on-screen. The sidebar track is a fixed 300px,
  // so anything in it that refuses to wrap pushes the buttons past the right
  // edge while still reporting itself visible.
  const acceptBox = await mp.getByRole('button', { name: 'Accept' }).boundingBox();
  check('decision buttons sit inside the viewport',
    acceptBox && acceptBox.x + acceptBox.width <= vp.w + 1,
    acceptBox && `right edge ${Math.round(acceptBox.x + acceptBox.width)} vs viewport ${vp.w}`);
  const sideOverflow = await mp.locator('.detail-side')
    .evaluate((el) => el.scrollWidth - el.clientWidth);
  check('nothing overflows the sidebar column', sideOverflow <= 1, `${sideOverflow}px`);
  check('the progress rail renders all three stages', (await mp.locator('.pl-step').count()) === 3);
  const railCols = await mp.locator('.pipeline')
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  check(`progress rail is ${vp.w >= 640 ? 'horizontal' : 'vertical'}`,
    railCols === (vp.w >= 640 ? 3 : 1), `${railCols}`);
  check('no horizontal overflow on detail', (await overflow(mp)) <= 0, `${await overflow(mp)}px`);
  check('no page errors', errs.length === 0, errs.join('|'));

  await ctx.close(); await mctx.close();
}

await b.close();
console.log(`\n${'='.repeat(44)}\n  ${pass} passed, ${fail} failed\n${'='.repeat(44)}`);
process.exit(fail === 0 ? 0 : 1);
