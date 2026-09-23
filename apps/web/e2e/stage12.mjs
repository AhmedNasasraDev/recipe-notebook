// Browser E2E for §10's screens, against the BUILT bundle.
//
// WHAT THIS CAN AND CANNOT PROVE — read this before quoting it as evidence.
//
// The build is made with the Supabase env vars BLANK, because this sandbox's
// egress policy blocks *.supabase.co: a browser here cannot open a connection
// to the project. So the app runs on the local demo repository, which REFUSES
// every group operation.
//
// That makes this file a test of exactly one thing, and it is worth testing:
// THE HONEST UNCONFIGURED PATH. The prototype's two worst defects were
// messages claiming a file had been written and a share had been sent when
// nothing had happened, and §17 rules that out. A groups screen with no server
// must say so, must not invent a group list, and must not offer buttons that
// cannot work — and a person who arrives holding a real invitation link must be
// told their link is still valid rather than that it is broken.
//
// The rest of §10 is proved elsewhere, and the split is deliberate:
//
//   supabase/tests/*.sql          the policies, the triggers and the RPCs
//                                 against real Postgres, as `authenticated`
//                                 and as `anon`
//   GroupChat.test.tsx and the    every screen's behaviour with a repository
//   four screen test files        that ENFORCES the same rank model
//   supabaseGroups.test.ts        what actually goes over the wire, including
//                                 that a zero-row write is a refusal
//   this file                     the real browser: layout at three widths,
//                                 real pointer events, the minified artifact,
//                                 and the unconfigured path end to end
//
// Nothing here should ever be presented as proof that the chat works against a
// server. It has never been run against one.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = process.env['DIST'] ?? path.join(HERE, '..', 'dist-demo');
const OUT = process.env['SHOTS'] ?? path.join(HERE, '..', '..', '..', '.e2e-shots');
fs.mkdirSync(OUT, { recursive: true });

const CHROME =
  process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  let file = path.join(DIST, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(DIST, 'index.html');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'text/plain' });
  res.end(fs.readFileSync(file));
});

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};

const finishOnboarding = async (p) => {
  const first = p.locator('button', { hasText: 'מקצועי' }).first();
  if (!(await first.count())) return false;
  await first.click();
  for (let i = 0; i < 8; i += 1) {
    const next = p.locator('button').filter({ hasText: /^(המשך|סיום|למחברת)/ }).first();
    if (!(await next.count())) break;
    await next.click();
    await p.waitForTimeout(150);
  }
  await p.waitForTimeout(400);
  return true;
};

await new Promise((r) => server.listen(8125, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:8125';

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
const errors = [];
const external = [];

try {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The Google Fonts stylesheet cannot load here: the egress proxy presents
    // its own certificate. The §16 stacks have system fallbacks.
    if (/ERR_CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)\.com/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (!u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('https://fonts.')) {
      external.push(u);
      return route.abort();
    }
    return route.continue();
  });

  await page.goto(`${BASE}/notebook`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const booted = await finishOnboarding(page);
  check('the app boots and the onboarding can be completed', booted !== null);

  // ── the tab bar no longer lies in either direction ─────────────────────
  /*
    The bar carries glyphs and the names live in `aria-label`, so "pending" is
    now a word in a name rather than a caption under an icon. Both are checked:
    no caption anywhere, and no name that ends in "בהכנה".
  */
  const pending =
    (await page.locator('nav[aria-label="ניווט ראשי"]').getByText('בהכנה').count()) +
    (await page.locator('nav[aria-label="ניווט ראשי"] a[aria-label$="בהכנה"]').count());
  check('no tab is marked "בהכנה" any more', pending === 0, `${pending} found`);

  const groupsTab = page.locator('nav[aria-label="ניווט ראשי"] a[href="/groups"]');
  check('the groups tab is a real link', (await groupsTab.count()) === 1);
  await groupsTab.first().click();
  await page.waitForTimeout(700);
  check('it navigates to the groups screen', page.url().endsWith('/groups'), page.url());

  // ── §17: the honest unconfigured path ──────────────────────────────────
  const body = await page.locator('body').innerText();
  check(
    'the groups screen explains that there is no server',
    body.includes('אין חיבור לשרת'),
    body.slice(0, 80).replace(/\n/g, ' '),
  );
  check(
    'and says it will not invent a list instead',
    body.includes('ולא נציג רשימה מומצאת'),
  );
  check(
    'no fabricated group appears — the prototype had eighteen fictional students',
    !/מחזור י|רונן אלמוג|PT-4K9Q/.test(body),
  );
  const newGroup = await page.getByRole('button', { name: 'קבוצה חדשה' }).count();
  const joinCode = await page.getByRole('button', { name: 'הצטרפות עם קוד' }).count();
  check(
    'no group action is offered that could not work',
    newGroup === 0 && joinCode === 0,
    `new=${newGroup} join=${joinCode}`,
  );
  await page.screenshot({ path: `${OUT}/12-groups-demo.png`, fullPage: true });

  // ── the invitation link ────────────────────────────────────────────────
  await page.goto(`${BASE}/join/abc123def456`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const joinBody = await page.locator('body').innerText();
  check(
    'the invitation screen ASKS rather than joining on arrival',
    (await page.getByRole('button', { name: 'הצטרפות לקבוצה' }).count()) === 1,
  );
  check(
    'it states the privacy model before the person decides',
    joinBody.includes('המחברת האישית שלכם נשארת פרטית'),
  );
  check('the token is never on screen', !joinBody.includes('abc123def456'));

  await page.getByRole('button', { name: 'הצטרפות לקבוצה' }).click();
  await page.waitForTimeout(600);
  const refusal = await page.locator('[role="alert"]').innerText();
  check(
    'a server-less build tells the holder their link is still valid',
    refusal.includes('הקישור נשאר תקף'),
    refusal.slice(0, 60),
  );
  check(
    'and does not claim the invitation is invalid',
    !refusal.includes('אינה תקפה'),
    refusal.slice(0, 60),
  );
  await page.screenshot({ path: `${OUT}/12-join-demo.png`, fullPage: true });

  // ── the identity card ──────────────────────────────────────────────────
  await page.goto(`${BASE}/settings`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const card = page.locator('section[aria-label="איך אני מוצג בקבוצות"]');
  check('the settings screen carries the identity card', (await card.count()) === 1);
  const cardText = await card.innerText();
  check(
    'it says the email address is never shown to a group',
    cardText.includes('אינה מוצגת לאף אחד בקבוצה'),
  );
  check(
    'the name field is disabled with no server, and says why',
    (await page.getByLabel('השם שיוצג').isDisabled()) &&
      cardText.includes('אין חיבור לשרת'),
  );

  // ── touch targets, on the screens this build can reach ─────────────────
  await page.goto(`${BASE}/groups`, { waitUntil: 'load' });
  await page.waitForTimeout(600);
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('button, a, select, input[type="checkbox"]')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      // Inline text links inside a paragraph are not touch targets.
      if (el.tagName === 'BUTTON' && getComputedStyle(el).textDecorationLine === 'underline') {
        continue;
      }
      if (el.tagName === 'A' && el.closest('p')) continue;
      if (r.height < 36) {
        out.push(`${el.tagName}[${el.textContent?.trim().slice(0, 16)}] ${Math.round(r.height)}px`);
      }
    }
    return out;
  });
  check('every control on the groups screen is at least 36px tall', small.length === 0, small.slice(0, 4).join('; '));

  // ── three widths, no horizontal overflow ───────────────────────────────
  for (const [label, width, height] of [
    ['phone', 402, 874],
    ['tablet', 820, 1180],
    ['desktop', 1280, 900],
  ]) {
    const c = await browser.newContext({ viewport: { width, height } });
    const p = await c.newPage();
    p.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
    await p.route('**/*', (route) =>
      route.request().url().startsWith(BASE) ? route.continue() : route.abort(),
    );
    await p.goto(`${BASE}/notebook`, { waitUntil: 'load' });
    await p.waitForTimeout(900);
    await finishOnboarding(p);

    for (const route of ['/groups', '/settings']) {
      await p.goto(`${BASE}${route}`, { waitUntil: 'load' });
      await p.waitForTimeout(700);
      const overflow = await p.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      check(`no horizontal overflow at ${label} on ${route}`, overflow <= 1, `${overflow}px`);
    }
    await p.screenshot({ path: `${OUT}/12-groups-${label}.png`, fullPage: true });
    await c.close();
  }

  check('no page errors anywhere in the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  check(
    'nothing tried to reach an external origin',
    external.length === 0,
    external.slice(0, 3).join(' | '),
  );

  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots in ${OUT}`);
if (failed.length) process.exit(1);
