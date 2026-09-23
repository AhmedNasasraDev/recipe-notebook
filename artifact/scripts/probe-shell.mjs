// Does the published page give the app the whole screen?
//
// This check exists because of a defect that shipped: the font <link> in
// apps/web/index.html spans four lines, a line-based copy left the bare
// `href="…"` line as a TEXT NODE in <body>, and that one stray line — about
// 32px — pushed a `100dvh` frame past the viewport and put the BOTTOM TAB BAR
// below the fold. The artifact looked like a one-screen app, because its only
// navigation was off screen.
//
// So the three things it asserts are the three things that went wrong:
//   · no text node sits directly in <body> (nothing leaks out of a tag)
//   · the document is exactly as tall as the viewport (no page scroll)
//   · the tab bar's bottom edge is inside the viewport
//
// At five sizes, including one shorter than any phone, because the artifact
// panel can be any height.
//
//   node artifact/scripts/probe-shell.mjs

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));
const HERE = path.dirname(fileURLToPath(import.meta.url));
/* Both default to the local build, and both can be pointed at the files the
   artifact service actually serves (downloaded with `Artifact action:"read"`),
   so this can check the LIVE page and not only the one on disk:
     PAGE=<dir>/index.html DIST=<dir> node artifact/scripts/<this>.mjs */
const DIST = process.env['DIST'] ?? path.join(HERE, '..', 'dist');
const OUT = path.join(HERE, '..', '..', '.e2e-shots', 'audit');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const PAGE = fs.readFileSync(
  process.env['PAGE'] ?? path.join(HERE, '..', 'app-page.html'),
  'utf8',
);
/* The platform's OWN skeleton, copied verbatim from the published page
   (`Artifact action:"read"` with `path:"index.html"` returns the page as the
   service stores it, wrapper included). It is quoted rather than approximated
   because two of its declarations decide layout here: the safe-area padding on
   `:root`, and `box-sizing: border-box`. */
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
  if (!fs.existsSync(file)) {
    res.writeHead(404);
    return res.end('no');
  }
  res.writeHead(200, {
    'Content-Type': file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8',
  });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8142, '127.0.0.1', r));

const results = [];
const check = (l, p, d = '') => {
  results.push({ l, p });
  console.log(`${p ? 'ok  ' : 'FAIL'} ${l}${d ? ` -- ${d}` : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  for (const [label, w, h] of [
    ['phone 402×720', 402, 720],
    ['panel 420×600', 420, 600],
    ['short 402×520', 402, 520],
    ['tall 402×900', 402, 900],
    ['desktop 1440×860', 1440, 860],
  ]) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.route('**/*', (r) =>
      r.request().url().startsWith('http://127.0.0.1:8142') ? r.continue() : r.abort(),
    );
    await page.goto('http://127.0.0.1:8142/index.html', { waitUntil: 'load' });
    await page.waitForTimeout(1100);

    const m = await page.evaluate(() => {
      const tb = document.querySelector('nav[aria-label="ניווט ראשי"]');
      const r = tb ? tb.getBoundingClientRect() : null;
      return {
        stray: [...document.body.childNodes]
          .filter((n) => n.nodeType === 3 && (n.textContent || '').trim())
          .map((n) => (n.textContent || '').trim().slice(0, 50)),
        /*
          The BODY, not `documentElement.scrollHeight`. The defect this guards
          against made the body taller than the viewport (a stray text node)
          and put the tab bar under the fold. Chromium also counts overflow
          from inside an internally scrolling container in the document's
          scrollHeight, so that number reports "page scroll" on a screen whose
          content area is legitimately scrolling and nothing is wrong.
        */
        pageScroll: document.body.scrollHeight - document.documentElement.clientHeight,
        scrolled: document.documentElement.scrollTop + document.body.scrollTop,
        tabBottom: r ? Math.round(r.bottom) : -1,
        viewport: window.innerHeight,
        tabs: tb ? tb.querySelectorAll('a').length : 0,
      };
    });

    check(`${label}: nothing leaked out of a tag into <body>`, m.stray.length === 0, m.stray.join(' | '));
    check(
      `${label}: the page itself does not scroll`,
      m.pageScroll <= 1 && m.scrolled === 0,
      `body ${m.pageScroll}px over, scrolled ${m.scrolled}px`,
    );
    check(
      `${label}: all four tabs are on screen`,
      m.tabs === 4 && m.tabBottom > 0 && m.tabBottom <= m.viewport + 1,
      `tabs=${m.tabs} bottom=${m.tabBottom} viewport=${m.viewport}`,
    );
    await page.screenshot({ path: path.join(OUT, `shell-${label.split(' ')[0]}.png`) });
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.p);
console.log(`\n${results.length - failed.length}/${results.length} shell checks passed`);
if (failed.length) process.exit(1);
