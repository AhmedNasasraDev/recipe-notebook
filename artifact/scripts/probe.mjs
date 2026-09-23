// AUDIT PROBE — drives the built viewer in a real browser and reports.
//
// It fixes nothing and asserts nothing about what SHOULD be there. It opens
// every route the viewer carries, at the three widths the audit asks for, and
// records what it finds: the heading, whether the page threw, whether anything
// overflowed horizontally, and which routes show an alert. The output is the
// evidence behind the Mobile/Tablet/Desktop columns in UI_AUDIT.md.
//
//   node artifact/scripts/probe.mjs            # all three widths
//   node artifact/scripts/probe.mjs 402        # one width

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env['DIST'] ?? path.join(HERE, '..', 'dist');
const OUT = path.join(HERE, '..', '..', '.e2e-shots', 'audit');
fs.mkdirSync(OUT, { recursive: true });

const CHROME = process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

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
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'text/plain' });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8131, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:8131/app.html';

/** Every route in the viewer, with the ids the fixture actually carries. */
const ROUTES = [
  ['/home', 'בית'],
  ['/notebook', 'מחברת'],
  ['/paste', 'הדבקה'],
  ['/recipe/brioche', 'מתכון'],
  ['/recipe/brioche/edit', 'עריכת מתכון'],
  ['/recipe/new', 'מתכון חדש'],
  ['/recipe/brioche/cook', 'Cook Mode'],
  ['/recipe/brioche/label', 'תווית'],
  ['/recipe/brioche/order', 'דף הזמנה'],
  ['/groups', 'קבוצות'],
  ['/group/group-course', 'קבוצה (תלמיד)'],
  ['/group/group-team', 'קבוצה (בעלים)'],
  ['/group/group-team/perms', 'הרשאות'],
  ['/group/group-course/item/item-brioche', 'מתכון קבוצתי (שמירה מותרת)'],
  ['/group/group-course/item/item-croissant', 'מתכון קבוצתי (שמירה חסומה)'],
  ['/ingredients', 'חומרי גלם'],
  ['/plans', 'תוכניות ייצור'],
  ['/plan/fixture-plan-1', 'יום ייצור'],
  ['/more', 'עוד'],
  ['/settings', 'הגדרות'],
  ['/tools', 'כלי מדידה'],
  ['/onboarding', 'Onboarding'],
  ['/join/fixture-token-open', 'הזמנה לקבוצה'],
  ['/__inspector/auth', 'AuthScreen (component)'],
];

const WIDTHS = process.argv[2]
  ? [[`w${process.argv[2]}`, Number(process.argv[2]), 900]]
  : [
      ['mobile', 402, 874],
      ['tablet', 820, 1180],
      ['desktop', 1440, 900],
    ];

const rows = [];
const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

try {
  for (const [label, width, height] of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const page = await ctx.newPage();
    await page.route('**/*', (route) =>
      route.request().url().startsWith('http://127.0.0.1:8131')
        ? route.continue()
        : route.abort(),
    );

    for (const [route, name] of ROUTES) {
      const errors = [];
      const blocked = [];
      /*
        WHY A FAILED REQUEST HERE IS NOT A FINDING, AND HOW THAT WAS ESTABLISHED

        This sandbox's egress terminates TLS with its own CA, so the page's one
        cross-origin request — the Google Fonts stylesheet — fails with
        ERR_CERT_AUTHORITY_INVALID. Measured, not assumed: a run that logged
        `requestfailed` URLs showed that single URL and nothing else, with no
        uncaught error. In a normal browser it loads; if it did not, the font
        stack falls through to the next family. The console line for a failed
        subresource carries no URL, so failures are classified by their URL
        through `requestfailed` and the bare "Failed to load resource" line is
        not read as evidence of anything.
      */
      const onError = (e) => errors.push(String(e.message ?? e));
      const onFailed = (r) => {
        const url = r.url();
        if (/fonts\.(googleapis|gstatic)\.com/.test(url)) {
          blocked.push(url);
          return;
        }
        // `requestfailed` hands the handler a Request: `url()` and `failure()`
        // are on it directly, and `r.request()` is a TypeError.
        // `requestfailed` hands the handler a Request: `url()` and `failure()`
      // are on it directly, and `r.request()` is a TypeError.
      errors.push(`request failed: ${url} (${r.failure()?.errorText ?? '?'})`);
      };
      const onConsole = (m) => {
        if (m.type() !== 'error') return;
        if (/Failed to load resource/.test(m.text())) return;
        if (/ERR_CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)/.test(m.text())) return;
        errors.push(`console: ${m.text()}`);
      };
      page.on('pageerror', onError);
      page.on('console', onConsole);
      page.on('requestfailed', onFailed);

      await page.goto(`${BASE}#${route}`, { waitUntil: 'load' });
      // A hash change alone does not remount; a reload after setting it does.
      await page.reload({ waitUntil: 'load' });
      await page.waitForTimeout(700);

      const found = await page.evaluate(() => {
        const h = document.querySelector('h1, h2');
        const alerts = [...document.querySelectorAll('[role="alert"]')].map((n) =>
          (n.textContent ?? '').trim().slice(0, 70),
        );
        const statuses = [...document.querySelectorAll('[role="status"]')].map((n) =>
          (n.textContent ?? '').trim().slice(0, 70),
        );
        return {
          heading: (h?.textContent ?? '').trim().slice(0, 40),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          alerts,
          statuses,
          nodes: document.querySelectorAll('*').length,
        };
      });

      rows.push({ width: label, route, name, ...found, errors, fontsBlocked: blocked.length });
      const safe = route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      await page.screenshot({ path: path.join(OUT, `${label}-${safe}.png`), fullPage: true });

      page.off('pageerror', onError);
      page.off('console', onConsole);
      page.off('requestfailed', onFailed);
    }

    await ctx.close();
  }
} finally {
  await browser.close();
  server.close();
}

fs.writeFileSync(path.join(OUT, 'probe.json'), JSON.stringify(rows, null, 2));

const bad = rows.filter((r) => r.errors.length > 0 || r.overflow > 1);
console.log(`${rows.length} route/width pairs opened, ${bad.length} with a finding`);
for (const r of bad) {
  console.log(
    `FINDING ${r.width} ${r.route} overflow=${r.overflow}px ${r.errors.slice(0, 2).join(' | ')}`,
  );
}
console.log('\nheadings seen (mobile):');
for (const r of rows.filter((x) => x.width === 'mobile' || x.width.startsWith('w'))) {
  console.log(
    `  ${r.route.padEnd(46)} ${String(r.heading).padEnd(26)} nodes=${r.nodes} ` +
      `${r.alerts.length ? `alert="${r.alerts[0]}"` : ''}`,
  );
}
console.log(`\nscreenshots + probe.json in ${OUT}`);
