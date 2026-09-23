// AUDIT PROBE 3 — the inspector page itself, in a browser.
//
// The artifact is a deliverable too: if its route rail, its width switcher or
// its tables are broken, the audit is unreadable. This opens the page exactly
// as it will be published (index.html beside app.html and assets/), clicks
// through it, and reports.
//
//   node artifact/scripts/probe-inspector.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(HERE, '..', 'dist');
const OUT = path.join(HERE, '..', '..', '.e2e-shots', 'audit');
fs.mkdirSync(OUT, { recursive: true });

// The published layout: index.html sits beside app.html.
fs.copyFileSync(path.join(HERE, '..', 'index.html'), path.join(DIST, 'index.html'));

const CHROME = process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  let file = path.join(DIST, url === '/' ? '/index.html' : url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'text/plain' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8134, '127.0.0.1', r));

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const errors = [];

try {
  for (const [label, width, height] of [
    ['phone', 402, 900],
    ['desktop', 1440, 1000],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      if (/ERR_CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)/.test(m.text())) return;
      errors.push(`${label} console: ${m.text()}`);
    });
    await page.goto('http://127.0.0.1:8134/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1200);

    check(`${label}: the disclosure is on the page`, (await page.getByText('ARTIFACT FIXTURE — NOT PRODUCTION DATA').count()) === 1);
    check(`${label}: the product frame loaded`, await page.frameLocator('#frame').locator('#root').isVisible());
    check(
      `${label}: the frame shows the product, not the inspector`,
      (await page.frameLocator('#frame').getByText('מחברת מתכונים').count()) >= 1,
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check(`${label}: no horizontal overflow on the inspector`, overflow <= 1, `${overflow}px`);

    // Jump to a group screen through the inspector's own control.
    await page.selectOption('#routeSelect', '/group/:groupId/perms');
    await page.waitForTimeout(900);
    check(
      `${label}: the route picker drives the product`,
      (await page.frameLocator('#frame').getByText('חברים והרשאות').count()) >= 1,
    );
    check(
      `${label}: traceability names the source file`,
      (await page.getByText('apps/web/src/routes/PermsScreen.tsx').count()) >= 1,
    );

    // The width switcher must change the frame's own viewport.
    await page.getByRole('button', { name: /דסקטופ/ }).click();
    await page.waitForTimeout(500);
    const inner = await page.frameLocator('#frame').locator('body').evaluate((b) => b.clientWidth);
    check(`${label}: the desktop chip gives the frame a 1440px viewport`, inner === 1440, `${inner}px`);
    await page.getByRole('button', { name: /מובייל/ }).click();
    await page.waitForTimeout(500);
    const inner2 = await page.frameLocator('#frame').locator('body').evaluate((b) => b.clientWidth);
    check(`${label}: and the mobile chip gives it 402px`, inner2 === 402, `${inner2}px`);

    // Every report tab renders a table.
    for (const [tab, marker] of [
      ['אודיט מסכים', 'איך מגיעים'],
      ['מצאי קוד', 'קומפוננטות, גליות ופאנלים'],
      ['ממצאים', 'שום דבר מהם לא תוקן במשימה הזאת'],
      ['מה בדיוק ראיתי', 'מה לא נבדק, ולא אטען אחרת'],
      ['כיסוי מפרט', 'COMPLETED פירושו'],
    ]) {
      await page.getByRole('button', { name: tab }).click();
      await page.waitForTimeout(250);
      check(`${label}: tab "${tab}" renders`, (await page.getByText(marker).count()) >= 1);
    }

    await page.screenshot({ path: path.join(OUT, `inspector-${label}.png`), fullPage: true });
    await ctx.close();
  }

  check('no page error anywhere', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} inspector checks passed`);
if (failed.length) process.exit(1);
