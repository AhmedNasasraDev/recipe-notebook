// The four actions the simulation layer had to grow so they could be
// demonstrated inside the artifact: recipe versions (§9), the delete guard
// (stage 6), a recipe photograph (§5) and the group avatar (§10.1).
//
// Each one runs the PRODUCT's code path — the same components, the same
// conversion, the same guard logic — with the fixture standing in for the
// server. This proves the buttons do what they say inside the artifact.
//
//   node artifact/scripts/probe-actions.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env['DIST'] ?? path.join(HERE, '..', 'dist');
const CHROME = process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const PAGE = fs.readFileSync(
  process.env['PAGE'] ?? path.join(HERE, '..', 'app-page.html'),
  'utf8',
);
/* The platform's OWN skeleton, copied verbatim from the published page. */
const HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';
const WRAPPED = `${HEAD}${PAGE}</body></html>`;

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(WRAPPED);
  }
  const file = path.join(DIST, url);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('no'); }
  res.writeHead(200, { 'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8136, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:8136/index.html';

const results = [];
const check = (l, p, d = '') => { results.push({ l, p }); console.log(`${p ? 'ok  ' : 'FAIL'} ${l}${d ? ` -- ${d}` : ''}`); };

/*
  A real 64×48 RGB PNG, generated here rather than pasted: the first version of
  this probe used a hand-typed 2×2 base64 that `createImageBitmap` refused to
  decode, and the app correctly reported "לא הצלחנו לפתוח את התמונה" — a
  passing error path and a failing test. The product's converter needs a real
  image; so it gets one.
*/
const PNG = (() => {
  const crcTable = (() => {
    const t = [];
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc32 = (buf) => {
    let crc = 0xffffffff;
    for (const b of buf) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const W = 64;
  const H = 48;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = [];
  for (let y = 0; y < H; y += 1) {
    raw.push(Buffer.from([0]));
    const row = Buffer.alloc(W * 3);
    for (let x = 0; x < W; x += 1) {
      row[x * 3] = 200 - y;
      row[x * 3 + 1] = 120 + ((x * 2) % 100);
      row[x * 3 + 2] = 90;
    }
    raw.push(row);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
})();

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const errors = [];
try {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/*', (r) => (r.request().url().startsWith('http://127.0.0.1:8136') ? r.continue() : r.abort()));

  const load = async (route) => {
    await page.goto(`${BASE}#${route}`, { waitUntil: 'load' });
    await page.reload({ waitUntil: 'load' });
    await page.waitForTimeout(700);
    /*
      THE RECIPE SCREEN KEEPS ITS PROFESSIONAL TOOLS FOLDED AWAY.

      The UX pass put the version history, the food cost, the pan card and the
      destructive actions behind two disclosures — "פרטים מקצועיים" and
      "עוד פעולות" — and what is closed is NOT BUILT (`{showPro && …}`), so
      those controls are not in the document at all until the summary is
      pressed. This probe was written before that and looked for a restore
      button on a page that no longer has one; opening both panels here is what
      it means to "load the recipe page" now.
    */
    for (const name of ['פרטים מקצועיים', 'עוד פעולות']) {
      const summary = page.getByText(name, { exact: true }).first();
      if (await summary.count()) {
        await summary.click();
        await page.waitForTimeout(350);
      }
    }
  };

  // ── §9 versions ──────────────────────────────────────────────────────
  // `brioche` first: it is `locked: true` in the demo data, so its restore is
  // disabled — §9's rule about an approved formula, and a real state to see.
  await load('/recipe/brioche');
  check(
    'a locked recipe shows its versions with the restore disabled',
    await page.getByLabel('שחזור גרסה V2').first().isDisabled(),
  );

  // `ganache` is unlocked, so the restore runs there.
  await load('/recipe/ganache');
  /* No click to "open" it: the history is a section on the recipe page. The
     first version of this probe clicked a button matching /גרסאות/ and opened
     the COMPARISON sheet instead, which then swallowed every later click. */
  check('the version history lists the fixture versions', (await page.getByText('V2').count()) >= 1);
  /* Exact aria-labels, not a regex: the panel has a restore button, a
     confirmation button and a comparison button, and a loose match picks the
     disabled one. */
  const restore = page.getByLabel('שחזור גרסה V2');
  check('a version offers a restore', (await restore.count()) >= 1);
  if (await restore.count()) {
    await restore.click();
    await page.waitForTimeout(500);
    await page.getByLabel('אישור שחזור גרסה V2').last().click();
    await page.waitForTimeout(900);
    check('the restore runs without an error', (await page.locator('[role="alert"]').count()) === 0);
  }

  // ── the delete guard ─────────────────────────────────────────────────
  await load('/recipe/ganache');
  /* The label is `מחיקת <שם המתכון>`, not "מחיקת המתכון" — read off the
     component rather than guessed. */
  const del = page.getByLabel(/^מחיקת /).first();
  check('the recipe page offers a delete', (await del.count()) >= 1);
  if (await del.count()) {
    await del.click();
    await page.waitForTimeout(400);
    const confirm = page.getByRole('button', { name: 'כן, למחוק' });
    if (await confirm.count()) await confirm.click();
    await page.waitForTimeout(700);
    const body = await page.locator('body').innerText();
    check(
      'deleting a base recipe in use is refused, and names what uses it',
      /משמש כמתכון בסיס|אי אפשר למחוק/.test(body),
      body.slice(0, 60).replace(/\n/g, ' '),
    );
  }

  // ── §5 a photograph ──────────────────────────────────────────────────
  await load('/recipe/brioche');
  const fileInputs = await page.locator('input[type="file"]').count();
  check('the recipe page offers a photo input', fileInputs >= 1);
  if (fileInputs) {
    await page.setInputFiles('input[type="file"]', { name: 'pic.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForTimeout(1500);
    check('the uploaded photo appears on the recipe', (await page.locator('img[src^="blob:"]').count()) >= 1);
  }

  // ── §10.1 the avatar ─────────────────────────────────────────────────
  await load('/settings');
  const avatar = page.locator('section[aria-label="איך אני מוצג בקבוצות"] input[type="file"]');
  check('the settings screen offers an avatar input', (await avatar.count()) === 1);
  if (await avatar.count()) {
    await avatar.setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForTimeout(1500);
    check(
      'the avatar appears after the upload',
      (await page.locator('section[aria-label="איך אני מוצג בקבוצות"] img[src^="blob:"]').count()) === 1,
    );
    await page.getByRole('button', { name: 'הסרת התמונה' }).click();
    await page.waitForTimeout(700);
    check(
      'and removing it puts the initials back',
      (await page.locator('section[aria-label="איך אני מוצג בקבוצות"] img').count()) === 0,
    );
  }

  check('no page error', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} action checks passed`);
if (failed.length) process.exit(1);
