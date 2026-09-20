// AUDIT PROBE 2 — clicks the product's own navigation inside the viewer.
//
// probe.mjs proves every route RENDERS. This one proves the product's
// navigation REACHES them: the tab bar, the group cards, the tabs inside a
// group, the deep links off a recipe. It also exercises four actions that run
// entirely in the fixture (send a chat message, edit it, flip a permission,
// save a group recipe to the notebook) so the audit can say whether the UI
// path works, separately from whether a server was involved.
//
// It fixes nothing. Every line prints what happened.
//
//   node artifact/scripts/probe-nav.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env['DIST'] ?? path.join(HERE, '..', 'dist');
const CHROME = process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/* The platform's OWN skeleton, copied verbatim from the published page. */
const HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';
/* With PAGE set, every HTML request is answered with the PUBLISHED page inside
   that skeleton instead of the build's own app.html, so this can be run over
   the files the artifact service actually serves:
     PAGE=<dir>/index.html DIST=<dir> node artifact/scripts/<this>.mjs */
const LIVE =
  process.env['PAGE'] === undefined
    ? null
    : `${HEAD}${fs.readFileSync(process.env['PAGE'], 'utf8')}</body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  if (LIVE !== null && (url === '/' || url.endsWith('.html'))) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(LIVE);
  }
  let file = path.join(DIST, url === '/' ? '/app.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'app.html');
  const type = file.endsWith('.js')
    ? 'text/javascript; charset=utf-8'
    : file.endsWith('.css')
      ? 'text/css; charset=utf-8'
      : 'text/html; charset=utf-8';
  res.writeHead(200, { 'Content-Type': type });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8132, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:8132/app.html';

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const errors = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  /*
    The page's one cross-origin request is the Google Fonts stylesheet, and this
    sandbox blocks it (measured: that URL and nothing else, with no uncaught
    error). Its console line carries no URL, so failures are classified by URL
    here and the bare "Failed to load resource" line is not counted — while a
    failure of anything else still is.
  */
  const fontsBlocked = [];
  page.on('requestfailed', (r) => {
    const url = r.url();
    if (/fonts\.(googleapis|gstatic)\.com/.test(url)) {
      fontsBlocked.push(url);
      return;
    }
    errors.push(`request failed: ${url} (${r.failure()?.errorText ?? '?'})`);
  });
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/.test(m.text())) return;
    if (/ERR_CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  await page.route('**/*', (r) =>
    r.request().url().startsWith('http://127.0.0.1:8132') ? r.continue() : r.abort(),
  );

  // The route the viewer reports back to its host, so a click can be checked
  // against the product's own router rather than against a guess.
  await page.addInitScript(() => {
    window.__route = null;
    window.addEventListener('message', (e) => {
      if (e.data?.source === 'recipe-notebook-viewer' && e.data.type === 'route') {
        window.__route = e.data.path;
      }
    });
  });

  await page.goto(`${BASE}#/notebook`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);

  check('the document is RTL', await page.evaluate(() => document.documentElement.dir === 'rtl'));

  // ── the tab bar ────────────────────────────────────────────────────────
  for (const [label, expected] of [
    ['בית', '/home'],
    ['קבוצות', '/groups'],
    ['עוד', '/more'],
    ['מחברת', '/notebook'],
  ]) {
    /*
      Selected by ADDRESS, not by text. The bar is glyphs now: the Hebrew name
      is the link's `aria-label`, and the only text inside it is the desktop
      tooltip, which is `display: none` at this width. Matching on that text
      happened to work — Playwright's `hasText` reads `textContent` and does
      not care that it is hidden — and "happened to work" is not a selector.
    */
    await page.locator(`nav[aria-label="ניווט ראשי"] a[href="${expected}"]`).first().click();
    await page.waitForTimeout(400);
    const at = await page.evaluate(() => window.__route);
    check(`tab "${label}" navigates`, at === expected, `${at}`);
  }

  // ── notebook → recipe → cook mode ──────────────────────────────────────
  // Not just `a[href^="/recipe/"]`: the FIRST of those on the notebook is the
  // "מתכון חדש" button at /recipe/new, which is a different thing entirely.
  await page.locator('a[href^="/recipe/"]:not([href="/recipe/new"])').first().click();
  await page.waitForTimeout(500);
  let at = await page.evaluate(() => window.__route);
  check('a recipe card opens the recipe', at?.startsWith('/recipe/') === true, `${at}`);

  const cook = page.locator('a[href$="/cook"]').first();
  check('the recipe page offers Cook Mode', (await cook.count()) === 1);
  await cook.click();
  await page.waitForTimeout(500);
  at = await page.evaluate(() => window.__route);
  check('Cook Mode opens, outside the tab bar', at?.endsWith('/cook') === true, `${at}`);
  check(
    'and Cook Mode has no tab bar (a §2 deep screen)',
    (await page.locator('nav[aria-label="ניווט ראשי"]').count()) === 0,
  );

  // ── groups → a group → its chat ────────────────────────────────────────
  await page.goto(`${BASE}#/groups`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  const cards = await page.locator('a[href^="/group/"]').count();
  check('the groups list shows both fixture groups', cards === 2, `${cards} cards`);

  await page.locator('a[href="/group/group-course"]').click();
  await page.waitForTimeout(500);
  check('a group card opens the group', (await page.evaluate(() => window.__route)) === '/group/group-course');

  const lessonItem = page.locator('a[href^="/group/group-course/item/"]');
  check(
    'a student sees only the items with perm_view on',
    (await lessonItem.count()) === 2,
    `${await lessonItem.count()} items`,
  );
  check(
    'and is offered no teaching control',
    (await page.getByRole('button', { name: 'הוספת מתכון מהמחברת' }).count()) === 0,
  );

  await page.getByRole('tab', { name: 'צ׳אט' }).click();
  await page.waitForTimeout(600);
  check('the chat tab opens the conversation', (await page.getByLabel('הודעה חדשה').count()) === 1);
  check(
    'a deleted message shows a tombstone',
    (await page.getByText('ההודעה נמחקה').count()) === 1,
  );
  check(
    'an announcement is marked',
    (await page.getByText('הכרזה').count()) >= 1,
  );

  await page.getByLabel('הודעה חדשה').fill('בדיקה מתוך התצוגה');
  await page.getByRole('button', { name: 'שליחה' }).click();
  await page.waitForTimeout(500);
  check(
    'sending a message renders it (FIXTURE — no server)',
    (await page.getByText('בדיקה מתוך התצוגה').count()) === 1,
  );

  await page.getByRole('button', { name: 'עריכה' }).first().click();
  await page.waitForTimeout(200);
  check('the author is offered edit on their own message', (await page.getByLabel('עריכת ההודעה').count()) === 1);
  await page.getByRole('button', { name: 'ביטול' }).first().click();

  // ── the staff group, its permissions screen, and one toggle ────────────
  await page.goto(`${BASE}#/group/group-team`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  check(
    'an owner IS offered the teaching controls',
    (await page.getByRole('button', { name: 'הוספת מתכון מהמחברת' }).count()) >= 1,
  );
  check(
    'and staff see the item whose view is off, marked מוסתר',
    (await page.getByText('מוסתר').count()) >= 1,
  );

  await page.getByRole('link', { name: 'חברים והרשאות' }).click();
  await page.waitForTimeout(600);
  check('the permissions screen opens', (await page.evaluate(() => window.__route)) === '/group/group-team/perms');
  // `>= 1`, not `=== 1`: the name appears twice by design — once in the row
  // and once in the screen-reader label of that member's role picker
  // ("תפקיד של דנה לוי"). Counting exactly one was my mistake, not the UI's.
  check('it lists the roster by name', (await page.getByText('דנה לוי').count()) >= 1);
  check('it shows a waiting join request', (await page.getByRole('button', { name: 'אישור' }).count()) === 1);
  check(
    'an expired invitation is called expired',
    (await page.getByText('פג תוקף').count()) === 1,
  );

  const save = page.getByLabel('שמירה למחברת האישית').first();
  const before = await save.isChecked();
  await save.click();
  await page.waitForTimeout(500);
  check(
    'a permission toggle flips (FIXTURE — no server)',
    (await page.getByLabel('שמירה למחברת האישית').first().isChecked()) !== before,
  );

  // ── §11, from the student's side ───────────────────────────────────────
  await page.goto(`${BASE}#/group/group-course/item/item-croissant`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  check(
    'save OFF shows the spec wording and no button',
    (await page.getByText(/המדריך לא אישר שמירה/).count()) === 1 &&
      (await page.getByRole('button', { name: 'שמירת עותק למחברת שלי' }).count()) === 0,
  );

  await page.goto(`${BASE}#/group/group-course/item/item-brioche`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  check(
    'save ON offers the copy, and the private note is loaded',
    (await page.getByRole('button', { name: 'שמירת עותק למחברת שלי' }).count()) === 1 &&
      (await page.getByLabel('הערה אישית על המתכון').inputValue()).includes('התנור שלי'),
  );
  await page.getByRole('button', { name: 'שמירת עותק למחברת שלי' }).click();
  await page.waitForTimeout(500);
  check(
    '§11 copy reports the spec sentence (FIXTURE — no server)',
    (await page.getByText('נוצר עותק אישי במחברת שלכם. המתכון של הקבוצה לא השתנה.').count()) === 1,
  );

  // ── the invitation link ────────────────────────────────────────────────
  await page.goto(`${BASE}#/join/fixture-token-broken`, { waitUntil: 'load' });
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'הצטרפות לקבוצה' }).click();
  await page.waitForTimeout(400);
  const refusal = await page.locator('[role="alert"]').innerText();
  check('a bad token gets one undifferentiated refusal', refusal.includes('ההזמנה אינה תקפה'), refusal.slice(0, 50));

  check('no page error in the whole walk', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} navigation checks passed`);
if (failed.length) process.exit(1);
