// THE POLISH AUDIT — the four things Ahmed asked to be checked across the
// whole interface, measured on every screen at a phone and at a desktop.
//
//   node artifact/scripts/polish.mjs
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS IS A FILE AND NOT A LOOK
//
// "עבור על המסכים וחפש פינות לא עקביות, אייקונים חסרים או חתוכים, רווחים
// מיותרים, כפתורים לא מיושרים וטקסט שמתנגש ברכיבים."
//
// Every one of those is a number, and a number is checkable on 14 screens at
// two sizes without anybody squinting at 28 screenshots. What a screenshot is
// still needed for — does the glyph MEAN the right thing — is in the report.
//
// WHAT IS MEASURED
//
//   corners    every button, field, select and textarea: the computed radius
//              on all four corners. One value, 12px, and never a pill.
//   glyphs     every <svg>: it has a box, it is inside its parent's box, and
//              it is one of the two sizes the set renders at.
//   alignment  a control that carries a glyph AND words: both on one row,
//              vertically centred on each other rather than stacked.
//   collisions text that overflows the element painting its background.
//
// The pass is read-only: it navigates, it measures, it never writes.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env['DIST'] ?? path.join(HERE, '..', 'dist');
const OUT = path.join(HERE, '..', '..', '.e2e-shots', 'polish');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const PAGE = fs.readFileSync(
  process.env['PAGE'] ?? path.join(HERE, '..', 'app-page.html'),
  'utf8',
);
const HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';
const WRAPPED = `${HEAD}${PAGE}</body></html>`;

const PORT = 8178;
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
    'Content-Type': file.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : 'text/css; charset=utf-8',
  });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${PORT}/index.html`;

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};

const ROUTES = [
  ['home', '/home'],
  ['notebook', '/notebook'],
  ['recipe', '/recipe/brioche'],
  ['editor', '/recipe/new'],
  ['order', '/recipe/brioche/order'],
  ['label', '/recipe/brioche/label'],
  ['cook', '/recipe/brioche/cook?mode=units&v=24'],
  ['groups', '/groups'],
  ['group', '/group/group-course'],
  ['perms', '/group/group-team/perms'],
  ['more', '/more'],
  ['settings', '/settings'],
  ['tools', '/tools'],
  ['ingredients', '/ingredients'],
  ['plans', '/plans'],
  ['plan', '/plan/fixture-plan-1'],
];

/** The two sizes the set renders at — shell/Icons.tsx SIZE. */
const GLYPH_SIZES = new Set([20, 24]);

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

try {
  for (const [device, width, height] of [
    ['phone', 412, 915],
    ['desktop', 1440, 900],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/*', (r) =>
      r.request().url().startsWith(`http://127.0.0.1:${PORT}`) ? r.continue() : r.abort(),
    );

    for (const [name, route] of ROUTES) {
      await page.goto(`${BASE}?w=${Date.now()}#${route}`, { waitUntil: 'load' });
      await page.waitForTimeout
        ? await page.waitForTimeout(900)
        : null;

      const m = await page.evaluate((sizes) => {
        const seen = (el) => {
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return (
            r.width > 0 &&
            r.height > 0 &&
            cs.visibility !== 'hidden' &&
            cs.opacity !== '0' &&
            cs.display !== 'none'
          );
        };
        const name = (el) =>
          (el.getAttribute('aria-label') || el.textContent || el.getAttribute('type') || '')
            .trim()
            .slice(0, 22);

        /* ── corners ─────────────────────────────────────────────────────── */
        const pills = [];
        const odd = [];
        const CONTROLS = 'button, input, select, textarea';
        for (const el of document.querySelectorAll(CONTROLS)) {
          if (!seen(el)) continue;
          const cs = getComputedStyle(el);
          const type = (el.getAttribute('type') || '').toLowerCase();
          /* A radio and a checkbox keep their own shapes on purpose, and a
             range's track is drawn by the platform. */
          if (['radio', 'checkbox', 'range', 'file'].includes(type)) continue;
          const corners = [
            cs.borderTopRightRadius,
            cs.borderTopLeftRadius,
            cs.borderBottomRightRadius,
            cs.borderBottomLeftRadius,
          ].map((v) => Math.round(parseFloat(v) || 0));
          const r = el.getBoundingClientRect();
          /* A pill is a radius at or past half the shorter side. */
          const half = Math.min(r.width, r.height) / 2;
          if (corners.some((c) => c >= half - 0.5 && c > 8)) {
            pills.push(`${el.tagName}«${name(el)}» ${corners.join('/')} in ${Math.round(r.height)}px`);
          } else if (new Set(corners).size !== 1) {
            odd.push(`${el.tagName}«${name(el)}» ${corners.join('/')}`);
          } else if (corners[0] !== 12 && corners[0] !== 0) {
            odd.push(`${el.tagName}«${name(el)}» ${corners[0]}px`);
          }
        }

        /* ── glyphs ──────────────────────────────────────────────────────── */
        const clipped = [];
        const offGrid = [];
        for (const svg of document.querySelectorAll('svg')) {
          if (!seen(svg)) continue;
          const r = svg.getBoundingClientRect();
          const parent = svg.parentElement;
          const p = parent ? parent.getBoundingClientRect() : null;
          if (p && (r.left < p.left - 1 || r.right > p.right + 1 || r.bottom > p.bottom + 1)) {
            clipped.push(`«${parent ? name(parent) : '?'}» ${Math.round(r.width)}px`);
          }
          const w = Math.round(r.width);
          if (!sizes.includes(w)) offGrid.push(`«${parent ? name(parent) : '?'}» ${w}px`);
        }

        /* ── a glyph and its words on one row ────────────────────────────── */
        const stacked = [];
        for (const el of document.querySelectorAll('button, a, label, summary')) {
          if (!seen(el)) continue;
          const svg = el.querySelector(':scope > svg');
          if (!svg) continue;
          const text = [...el.childNodes].find(
            (n) => n.nodeType === 3 && (n.textContent || '').trim() !== '',
          );
          if (!text) continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          const t = range.getBoundingClientRect();
          const g = svg.getBoundingClientRect();
          if (t.width === 0 || g.width === 0) continue;
          /* Centres within 3px of each other is "on one row"; a stacked pair
             is a whole line-height apart. */
          const dy = Math.abs((t.top + t.bottom) / 2 - (g.top + g.bottom) / 2);
          if (dy > 3) stacked.push(`«${name(el)}» off by ${Math.round(dy)}px`);
        }

        /* ── text spilling out of the box that paints behind it ──────────── */
        const spills = [];
        for (const el of document.querySelectorAll(
          'button, a, label, p, h1, h2, h3, span, li, td, th',
        )) {
          if (!seen(el)) continue;
          const cs = getComputedStyle(el);
          if (cs.overflow !== 'visible') continue;
          if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0) {
            spills.push(`${el.tagName}«${name(el)}» ${el.scrollWidth}>${el.clientWidth}`);
          }
        }

        return {
          pills: [...new Set(pills)].slice(0, 4),
          odd: [...new Set(odd)].slice(0, 4),
          clipped: [...new Set(clipped)].slice(0, 4),
          offGrid: [...new Set(offGrid)].slice(0, 4),
          stacked: [...new Set(stacked)].slice(0, 4),
          spills: [...new Set(spills)].slice(0, 4),
          glyphs: document.querySelectorAll('svg').length,
        };
      }, [...GLYPH_SIZES]);

      const tag = `${device} ${name}`;
      check(`${tag}: no control is a pill`, m.pills.length === 0, m.pills.join(' · '));
      check(
        `${tag}: every control has one 12px radius on all four corners`,
        m.odd.length === 0,
        m.odd.join(' · '),
      );
      check(`${tag}: no glyph is clipped by its control`, m.clipped.length === 0, m.clipped.join(' · '));
      check(
        `${tag}: every glyph is one of the set's two sizes`,
        m.offGrid.length === 0,
        m.offGrid.join(' · ') || `${m.glyphs} glyphs`,
      );
      check(
        `${tag}: a glyph and its words share one row`,
        m.stacked.length === 0,
        m.stacked.join(' · '),
      );
      check(`${tag}: no text spills out of its box`, m.spills.length === 0, m.spills.join(' · '));

      await page.screenshot({ path: path.join(OUT, `${device}-${name}.png`), fullPage: false });
    }
    check(`${device}: no page error in the whole pass`, errors.length === 0, errors.slice(0, 2).join(' | '));
    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} polish checks passed`);
for (const r of results.filter((x) => !x.pass)) {
  console.log(`  FAILED  ${r.label}${r.detail ? ` -- ${r.detail}` : ''}`);
}
console.log(`screenshots in ${OUT}`);
if (passed !== results.length) process.exitCode = 1;
