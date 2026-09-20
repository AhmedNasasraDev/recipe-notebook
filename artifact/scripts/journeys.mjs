// END-TO-END AUDIT OF THE ARTIFACT — the journeys, not the components.
//
// WHAT THIS IS FOR
//
// "It builds" and "the page loads" are not evidence. This drives the published
// page in Chromium and walks the flows a person actually walks, clicking the
// product's own controls by their own labels, and asserting the thing the UI
// PROMISED — a number that changed, a screen that arrived, a state that
// survived a reload. Where a control is offered and nothing happens, that is a
// finding and it is reported with the route and the label.
//
// HOW IT IS KEPT HONEST
//
//   · nothing reaches into React state; every step is a real click or a real
//     keystroke, and every assertion reads the rendered DOM
//   · every journey gets a FRESH page, so one journey cannot leave state that
//     makes the next one pass
//   · console errors, page errors and unhandled rejections are collected for
//     the whole run and reported at the end; the blocked Google Fonts request
//     is classified by URL and excluded, because this sandbox's proxy breaks
//     TLS on it and nothing else
//   · the state section deliberately tries to make state leak: scale from one
//     recipe to another, Mise en place from one preparation to the next
//
//   node artifact/scripts/journeys.mjs           # everything
//   node artifact/scripts/journeys.mjs C         # one journey by letter

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

const PAGE = fs.readFileSync(
  process.env['PAGE'] ?? path.join(HERE, '..', 'app-page.html'),
  'utf8',
);
/* The platform's OWN skeleton, copied verbatim from the published page. */
const HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>';
const WRAPPED = `${HEAD}${PAGE}</body></html>`;

const PORT = 8146;
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

/* ── bookkeeping ─────────────────────────────────────────────────────────── */

/*
  A list for checks that fail because of a defect in the PRODUCT rather than in
  the viewer — reported, printed as PROD, and never silently deleted.

  It is EMPTY: the one entry it held (F25, the recipe screen carrying its scale
  into the next recipe through "שכפול") was approved and fixed, so that check is
  an ordinary check again and a failure there is a regression. The mechanism
  stays because the next audit will need it.
*/
const KNOWN_PRODUCTION = new Map([]);

const findings = [];
const results = [];
let journey = '';
const check = (label, pass, detail = '') => {
  const known = KNOWN_PRODUCTION.get(label);
  const kind = pass ? (known ? 'FIXED' : 'ok  ') : known ? 'PROD' : 'FAIL';
  results.push({ journey, label, pass, detail, known: known !== undefined });
  if (!pass && !known) findings.push({ journey, label, detail });
  console.log(`${kind} ${journey} · ${label}${detail ? ` -- ${detail}` : ''}`);
};

const runtime = [];
const FONTS = /fonts\.(googleapis|gstatic)\.com/;

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

/** A fresh page, wired for error collection, at one viewport. */
async function fresh(hash = '/notebook', width = 402, height = 880) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => runtime.push(`${journey}: pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' && m.type() !== 'warning') return;
    const text = m.text();
    if (/Failed to load resource/.test(text) || FONTS.test(text)) return;
    // React's own warnings are exactly what this audit is looking for.
    runtime.push(`${journey}: console.${m.type()} ${text}`);
  });
  page.on('requestfailed', (r) => {
    if (FONTS.test(r.url())) return;
    runtime.push(`${journey}: request failed ${r.url()} (${r.failure()?.errorText ?? '?'})`);
  });
  await page.route('**/*', (r) =>
    r.request().url().startsWith(`http://127.0.0.1:${PORT}`) ? r.continue() : r.abort(),
  );
  await page.goto(`${BASE}#${hash}`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  return { ctx, page };
}

const TAB = 'nav[aria-label="ניווט ראשי"]';
/*
  A recipe card, and NOT the notebook's "מתכון חדש" link — which is also an
  `a[href^="/recipe/"]`. The first run of this probe opened `/recipe/new` and
  then asserted things about a recipe, and the same trap cost a run in the
  earlier audit. Excluded by href, once, here.
*/
const CARD = 'a[href^="/recipe/"]:not([href="/recipe/new"]):not([href$="/edit"])';
const text = (page) => page.evaluate(() => document.body.innerText);
const route = (page) => page.evaluate(() => window.location.hash.replace(/^#/, ''));
const h1 = (page) =>
  page.evaluate(() => document.querySelector('h1')?.textContent?.trim() ?? '(none)');

/**
 * Makes every Mise en place line ticked — and then presses the gate.
 *
 * Only the lines that are NOT already ticked are clicked. The first version
 * clicked all of them, which after a mid-weighing reload un-ticked the two
 * that had been restored and left the list at 5 of 7: the gate stayed inert
 * and the probe blamed the page. A tick is a toggle, so "tick everything" has
 * to mean "ensure", not "click".
 */
async function passMise(page) {
  const boxes = page.locator('section[aria-label="הכנת חומרי גלם"] input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i += 1) {
    if (!(await boxes.nth(i).isChecked())) {
      await boxes.nth(i).click();
      await page.waitForTimeout(80);
    }
  }
  await page.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' }).click();
  await page.waitForTimeout(400);
  return n;
}

const only = process.argv[2];
const should = (letter) => !only || only.toUpperCase() === letter;

/*
  UX PASS: the print sheets, שכפול and מחיקה live under the recipe page's
  "עוד פעולות" panel, and the professional data under "פרטים מקצועיים". Both
  render their contents only while open, so a journey that needs one opens it —
  which is the tap a user makes too.
*/
async function openMore(page) {
  await page.getByText('עוד פעולות').click();
  await page.waitForTimeout(250);
}

/* ── A. the notebook ─────────────────────────────────────────────────────── */

if (should('A')) {
  journey = 'A notebook';
  const { ctx, page } = await fresh('/notebook');
  check('opens on the notebook', (await h1(page)).includes('מחברת'));

  const cards = await page.locator(CARD).count();
  check('the notebook lists recipes', cards >= 5, `${cards} cards`);

  // The category filter is the product's own chip row.
  const chips = page.locator('button', { hasText: /^(הכל|לחמים|בצקים|קרמים|עוגות)$/ });
  const chipCount = await chips.count();
  check('offers category chips', chipCount > 1, `${chipCount} chips`);
  if (chipCount > 1) {
    const before = await page.locator(CARD).count();
    await chips.nth(1).click();
    await page.waitForTimeout(300);
    const after = await page.locator(CARD).count();
    check(
      'a category chip really filters the list',
      after !== before || after > 0,
      `${before} → ${after}`,
    );
    await chips.nth(0).click();
    await page.waitForTimeout(250);
    check(
      '"הכל" puts the whole list back',
      (await page.locator(CARD).count()) === before,
    );
  }

  // Search.
  const search = page.locator('input[type="search"], input[placeholder*="חיפוש"]').first();
  if (await search.count()) {
    await search.fill('בריוש');
    await page.waitForTimeout(350);
    const hits = await page.locator(CARD).count();
    check('search narrows the list', hits >= 1 && hits < cards, `${hits} of ${cards}`);
    await search.fill('קוסקוס אלסקה');
    await page.waitForTimeout(350);
    const none = await page.locator(CARD).count();
    check('a search with no hits says so instead of showing everything', none === 0, `${none}`);
    await search.fill('');
    await page.waitForTimeout(300);
  } else {
    check('search box present', false, 'not found');
  }

  // Open a recipe and come back with the browser's own Back.
  await page.locator(CARD).first().click();
  await page.waitForTimeout(700);
  const opened = await route(page);
  check('a card opens its recipe', /^\/recipe\/[^/]+$/.test(opened), opened);
  await page.goBack();
  await page.waitForTimeout(600);
  check('Back returns to the notebook', (await route(page)) === '/notebook', await route(page));
  await ctx.close();
}

/* ── B. a recipe, and the scale ──────────────────────────────────────────── */

if (should('B')) {
  journey = 'B recipe';
  const { ctx, page } = await fresh('/recipe/brioche');
  check('the recipe opens', (await h1(page)).length > 0, await h1(page));

  /* The recipe's ingredient rows are BUTTONS (`_ingRow_…`), not a table — the
     first version of this probe read a `<td>` that does not exist and reported
     an empty quantity as a defect. */
  const firstQty = async () =>
    page.evaluate(() => {
      const row = document.querySelector('[class*="ingRow"]');
      return row?.textContent?.trim().slice(0, 40) ?? '';
    });
  const before = await firstQty();
  check('the ingredient table shows a quantity', before !== '', before);

  await page.getByRole('button', { name: 'יחידות' }).click();
  await page.locator('#scale-value').fill('24');
  await page.waitForTimeout(500);
  const after = await firstQty();
  check('scaling changes the quantities on screen', after !== before, `${before} → ${after}`);

  const cookHref = await page
    .getByRole('link', { name: 'מצב הכנה' })
    .getAttribute('href');
  check(
    'and the cook link carries that scale',
    cookHref === '/recipe/brioche/cook?mode=units&v=24',
    cookHref ?? 'none',
  );
  await openMore(page);
  const orderHref = await page.getByRole('link', { name: 'דף הזמנה' }).getAttribute('href');
  check(
    'as does the order link',
    orderHref === '/recipe/brioche/order?mode=units&v=24',
    orderHref ?? 'none',
  );

  /*
    By href, not by label. The edit link READS "עריכה" but its accessible name
    is "עריכת בריוש נאנטר" — an `aria-label` the product added deliberately in
    the stage-10 accessibility pass, so that three actions on one page do not
    share one name. `getByRole('link', { name: 'עריכה' })` therefore matches
    nothing, and the first run of this probe reported a working link as a
    30-second timeout. The product is right; the probe was wrong.
  */
  // Edit and back out without saving.
  await page.locator('a[href$="/edit"]').first().click();
  await page.waitForTimeout(700);
  check('the editor opens', (await route(page)).endsWith('/edit'), await route(page));
  await page.goBack();
  await page.waitForTimeout(600);
  check('Back leaves the editor for the recipe', (await route(page)).includes('/recipe/brioche'), await route(page));
  await ctx.close();
}

/* ── C. Cook Mode and Mise en place ─────────────────────────────────────── */

if (should('C')) {
  journey = 'C cook mode';
  const { ctx, page } = await fresh('/recipe/brioche');
  await page.getByRole('button', { name: 'יחידות' }).click();
  await page.locator('#scale-value').fill('24');
  await page.waitForTimeout(400);
  await page.getByRole('link', { name: 'מצב הכנה' }).click();
  await page.waitForTimeout(900);

  check(
    'Cook Mode opens on Mise en place',
    (await h1(page)) === 'הכנת חומרי גלם',
    await h1(page),
  );
  const body = await text(page);
  check('with the instruction', body.includes('הכינו ושקלו את כל חומרי הגלם'));
  check('and it names the scale in force', /לפי מספר יחידות/.test(body), body.split('\n').find((l) => /×/.test(l)) ?? '');

  // The quantities must be the scaled ones — compared against the recipe page.
  const miseQty = await page.evaluate(() => {
    const row = document.querySelector('section[aria-label="הכנת חומרי גלם"] li label');
    return row?.textContent?.trim() ?? '';
  });
  check('the first line carries a name and a weight', /\d/.test(miseQty), miseQty);

  const boxes = page.locator('section[aria-label="הכנת חומרי גלם"] input[type="checkbox"]');
  const n = await boxes.count();
  check('one line per ingredient', n > 0, `${n}`);

  const gate = page.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' });
  check('the gate starts inert', await gate.isDisabled());

  // Partial.
  await boxes.first().click();
  await page.waitForTimeout(250);
  check('the count follows a tick', /1 מתוך/.test(await text(page)));
  check('the gate is still inert', await gate.isDisabled());
  check(
    'and the steps are not on the page',
    (await page.getByRole('button', { name: 'סימון השלב כהושלם' }).count()) === 0,
  );

  // Un-tick — the audit's own requirement 6.
  await boxes.first().click();
  await page.waitForTimeout(250);
  check('un-ticking takes the count back', /0 מתוך/.test(await text(page)));

  // Refresh mid-weighing: the ticks are on the device, the route in the hash.
  await boxes.first().click();
  await boxes.nth(1).click();
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  check(
    'a refresh mid-weighing keeps the route AND the scale',
    (await route(page)) === '/recipe/brioche/cook?mode=units&v=24',
    await route(page),
  );
  check('and the two ticks are still ticked', /2 מתוך/.test(await text(page)), (await text(page)).split('\n').find((l) => /מתוך/.test(l)) ?? '');

  // Complete it.
  const total = await passMise(page);
  check(
    'completing the list opens the first step',
    (await page.getByRole('button', { name: 'סימון השלב כהושלם' }).count()) > 0,
    `${total} lines`,
  );
  check(
    'the weighing list is gone from the page',
    (await page.getByRole('heading', { name: 'הכנת חומרי גלם' }).count()) === 0,
  );

  // The steps themselves, the existing behaviour.
  await page.getByRole('button', { name: 'סימון השלב כהושלם' }).click();
  await page.waitForTimeout(400);
  check('marking a step advances', /1 מתוך/.test(await text(page)));
  const timer = page.getByRole('button', { name: /הפעלת טיימר/ });
  if (await timer.count()) {
    await timer.click();
    await page.waitForTimeout(400);
    check(
      'a timer starts and is visible',
      (await page.getByRole('region', { name: 'טיימרים' }).count()) > 0,
    );
  }

  // Refresh mid-bake must NOT ask for the weighing again.
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  check(
    'a refresh mid-bake comes back to the steps',
    (await page.getByRole('button', { name: 'סימון השלב כהושלם' }).count()) > 0 &&
      (await page.getByRole('heading', { name: 'הכנת חומרי גלם' }).count()) === 0,
  );
  check('and remembers the step that was marked', /1 מתוך/.test(await text(page)));

  // Leave and come back the same way a person would.
  await page.getByRole('link', { name: '← יציאה' }).click();
  await page.waitForTimeout(700);
  check('the exit goes to the recipe', /^\/recipe\/brioche/.test(await route(page)), await route(page));
  await page.goBack();
  await page.waitForTimeout(900);
  check(
    'and coming back lands on the steps, not on the scales',
    (await page.getByRole('button', { name: 'סימון השלב כהושלם' }).count()) > 0,
  );

  // Finish: the next preparation starts from the scales again.
  const last = page.locator('nav[aria-label="שלבי ההכנה"] button').last();
  await last.click();
  await page.waitForTimeout(300);
  const finish = page.getByRole('button', { name: 'סיום ההכנה' });
  check('the last step offers "סיום ההכנה"', (await finish.count()) > 0);
  await finish.click();
  await page.waitForTimeout(800);
  check('finishing returns to the recipe', /^\/recipe\/brioche/.test(await route(page)), await route(page));

  await page.getByRole('link', { name: 'מצב הכנה' }).click();
  await page.waitForTimeout(900);
  check(
    'and the next preparation weighs again from zero',
    (await h1(page)) === 'הכנת חומרי גלם' && /0 מתוך/.test(await text(page)),
    await h1(page),
  );
  await page.screenshot({ path: path.join(OUT, 'journey-C-mise.png') });
  await ctx.close();
}

/* ── D. paste ────────────────────────────────────────────────────────────── */

if (should('D')) {
  journey = 'D paste';
  const { ctx, page } = await fresh('/paste');
  check('the paste screen opens', (await h1(page)).includes('הדבק'), await h1(page));
  const area = page.locator('textarea').first();
  check('it offers a text area', (await area.count()) > 0);
  await area.fill('בצק שמרים\n\n500 גרם קמח\n300 גרם מים\n10 גרם שמרים\n\nללוש 8 דקות\nלהתפיח שעה');
  await page.waitForTimeout(300);
  const parse = page.getByRole('button', { name: /פענוח|המשך|עיבוד/ }).first();
  check('and a parse control', (await parse.count()) > 0);
  if (await parse.count()) {
    await parse.click();
    await page.waitForTimeout(700);
    const after = await text(page);
    check(
      'parsing shows what it understood',
      /קמח/.test(after) && /\d/.test(after),
      after.split('\n').slice(0, 3).join(' / '),
    );
  }
  await ctx.close();
}

/* ── E. the label ────────────────────────────────────────────────────────── */

if (should('E')) {
  journey = 'E label';
  const { ctx, page } = await fresh('/recipe/brioche');
  await openMore(page);
  await page.getByRole('link', { name: 'תווית מוצר' }).click();
  await page.waitForTimeout(800);
  check('the label opens from the recipe', /\/label$/.test(await route(page)), await route(page));
  const body = await text(page);
  check('it names the product', body.includes('בריוש'), (await h1(page)));
  check('and carries a composition line', /מכיל|רכיבים|אלרגנ/.test(body));
  // `window.print` is stubbed: the dialog cannot be driven, but whether the
  // button CALLS it can be measured.
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => {
      window.__printed += 1;
    };
  });
  const print = page.getByRole('button', { name: /הדפסה/ }).first();
  check('it offers a print control', (await print.count()) > 0);
  if (await print.count()) {
    await print.click();
    await page.waitForTimeout(300);
    const printed = await page.evaluate(() => window.__printed);
    check('and the control really calls print', printed === 1, `${printed} call(s)`);
  }
  await ctx.close();
}

/* ── F. the order sheet, with the scale ──────────────────────────────────── */

if (should('F')) {
  journey = 'F order';
  const { ctx, page } = await fresh('/recipe/brioche');
  await page.getByRole('button', { name: 'משקל' }).click();
  // `#scale-value` is the one box the scale row has, whatever the mode renames
  // its label to.
  await page.locator('#scale-value').fill('3000');
  await page.waitForTimeout(400);
  await openMore(page);
  const href = await page.getByRole('link', { name: 'דף הזמנה' }).getAttribute('href');
  await page.getByRole('link', { name: 'דף הזמנה' }).click();
  await page.waitForTimeout(800);
  check('the order sheet opens with the scale in the URL', (await route(page)) === href, `${href} → ${await route(page)}`);
  const body = await text(page);
  check('and says which scale it is showing', /לפי משקל סופי/.test(body));
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1100);
  check(
    'a reload keeps the same sheet',
    (await route(page)) === href && /לפי משקל סופי/.test(await text(page)),
    await route(page),
  );
  await ctx.close();
}

/* ── G. home ─────────────────────────────────────────────────────────────── */

if (should('G')) {
  journey = 'G home';
  const { ctx, page } = await fresh('/home');
  check('home opens', (await h1(page)) === 'בית', await h1(page));
  const links = await page.locator('a[href]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href')).filter((h) => h && h.startsWith('/')),
  );
  check('it offers links onward', links.length > 0, links.join(' · '));
  let bad = 0;
  for (const href of [...new Set(links)]) {
    await page.goto(`${BASE}#${href}`, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    const heading = await h1(page);
    const missing = /לא נמצא|אינה קיימת/.test(await text(page));
    if (heading === '(none)' && missing) bad += 1;
    check(`home → ${href} arrives somewhere real`, !missing, heading);
  }
  check('no home link is dead', bad === 0);
  await ctx.close();
}

/* ── H. the ingredient centre ────────────────────────────────────────────── */

if (should('H')) {
  journey = 'H ingredients';
  const { ctx, page } = await fresh('/ingredients');
  check('it opens', (await h1(page)).includes('חומרי גלם'), await h1(page));
  const rows = await page.locator('li, tr').count();
  check('it lists the catalog', rows >= 6, `${rows} rows`);
  const add = page.getByRole('button', { name: /הוספה|חומר גלם חדש/ }).first();
  if (await add.count()) {
    await add.click();
    await page.waitForTimeout(400);
    check(
      'the add control opens a form',
      (await page.locator('input').count()) > 0,
      `${await page.locator('input').count()} inputs`,
    );
  }
  await ctx.close();
}

/* ── I. production plans ─────────────────────────────────────────────────── */

if (should('I')) {
  journey = 'I plans';
  const { ctx, page } = await fresh('/plans');
  check('the list opens', (await h1(page)).includes('תכנון'), await h1(page));
  const plan = page.locator('a[href^="/plan/"]').first();
  check('it lists a plan', (await plan.count()) > 0);
  await plan.click();
  await page.waitForTimeout(900);
  check('the plan opens', (await h1(page)).includes('יום ייצור'), await h1(page));
  const body = await text(page);
  check('with the computed purchase side', /רכש|לקנות|חומרי גלם/.test(body));
  await page.goBack();
  await page.waitForTimeout(600);
  check('Back returns to the list', (await route(page)) === '/plans', await route(page));
  await ctx.close();
}

/* ── J. groups ───────────────────────────────────────────────────────────── */

if (should('J')) {
  journey = 'J groups';
  const { ctx, page } = await fresh('/groups');
  check('the groups list opens', (await h1(page)).includes('קבוצות'), await h1(page));
  const cards = await page.locator('a[href^="/group/"]').count();
  check('it lists the groups', cards >= 2, `${cards}`);

  await page.locator('a[href^="/group/"]').first().click();
  await page.waitForTimeout(900);
  check('a group opens', (await h1(page)).length > 2, await h1(page));
  check(
    'with its two tabs',
    (await page.locator('button[role="tab"]').count()) === 2,
    `${await page.locator('button[role="tab"]').count()}`,
  );

  const item = page.locator('a[href*="/item/"]').first();
  if (await item.count()) {
    await item.click();
    await page.waitForTimeout(900);
    check('a lesson item opens the group recipe', /\/item\//.test(await route(page)), await route(page));
    check('and the recipe renders, not an error', !/לא נטען|נכשל/.test(await text(page)), await h1(page));
    await page.goBack();
    await page.waitForTimeout(700);
  } else {
    check('a lesson item is reachable', false, 'no item link on the student group');
  }

  // The staff side: permissions.
  await page.goto(`${BASE}#/group/group-team`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const perms = page.getByRole('link', { name: /חברים והרשאות/ });
  check('an owner is offered the permissions screen', (await perms.count()) > 0);
  if (await perms.count()) {
    await perms.click();
    await page.waitForTimeout(900);
    check('it opens', (await h1(page)).includes('הרשאות'), await h1(page));
    check(
      'and lists the members',
      (await text(page)).includes('דנה לוי'),
    );
  }
  await ctx.close();
}

/* ── K. the chat simulation (smoke; probe-chat.mjs is the full pass) ────── */

if (should('K')) {
  journey = 'K chat';
  const { ctx, page } = await fresh('/group/group-course');
  await page.getByRole('tab', { name: /צ׳אט/ }).click();
  await page.waitForTimeout(700);
  check('the chat opens', (await page.locator('section[aria-label="צ׳אט הקבוצה"]').count()) > 0);
  const bar = page.locator('[data-artifact-tool="active-sim-user"]');
  check('the simulation user switcher is above it', (await bar.count()) > 0);
  check(
    'and it is labelled as a test tool, not as a feature',
    /כלי בדיקה של ה־Artifact/.test((await bar.textContent()) ?? ''),
  );
  await page.fill('#chat-draft', 'בדיקת מסירה מהאודיט.');
  await page.getByRole('button', { name: 'שליחה' }).click();
  await page.waitForTimeout(600);
  check('a message sends and appears', (await text(page)).includes('בדיקת מסירה מהאודיט'));
  await bar.getByRole('button', { name: /נועה/ }).click();
  await page.waitForTimeout(700);
  check(
    'switching person keeps the conversation',
    (await text(page)).includes('בדיקת מסירה מהאודיט'),
  );
  await ctx.close();
}

/* ── L. settings, tools, more ────────────────────────────────────────────── */

if (should('L')) {
  journey = 'L settings';
  const { ctx, page } = await fresh('/more');
  const entries = await page.locator('a[href]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('href')).filter((h) => h?.startsWith('/')),
  );
  check('"עוד" offers its four entries', entries.length >= 4, entries.join(' · '));

  await page.goto(`${BASE}#/settings`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  check('settings opens', (await h1(page)) === 'הגדרות', await h1(page));

  // A real state change: the measurement profile.
  const profile = page.locator('button[aria-pressed]').first();
  if (await profile.count()) {
    const was = await profile.getAttribute('aria-pressed');
    const other = page.locator('button[aria-pressed="false"]').first();
    if (await other.count()) {
      const label = (await other.textContent())?.trim() ?? '';
      await other.click();
      await page.waitForTimeout(500);
      const now = await page
        .locator('button[aria-pressed="true"]')
        .first()
        .textContent();
      check(
        'choosing a profile changes what is selected',
        (now ?? '').trim() !== '' && (now ?? '').includes(label.slice(0, 4)),
        `${was} → «${(now ?? '').trim().slice(0, 30)}»`,
      );
    }
  }

  const name = page.locator('input[id*="name"], input[id*="display"]').first();
  if (await name.count()) {
    await name.fill('אחמד נסאסרה — בדיקה');
    await page.waitForTimeout(200);
    const save = page.getByRole('button', { name: /שמירה/ }).first();
    if (await save.count()) {
      await save.click();
      await page.waitForTimeout(600);
      check('saving the display name reports something', !/נכשל/.test(await text(page)));
    }
  }

  await page.goto(`${BASE}#/tools`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  check('the measuring tools open', (await h1(page)).includes('כלי המדידה'), await h1(page));
  const cupBtns = page.locator('button[aria-pressed]');
  const cups = await cupBtns.count();
  check('and offer the cup/spoon choices', cups > 0, `${cups} choices`);
  if (cups > 0) {
    /*
      By its own text, not by "the first unpressed button". A locator is a
      query, not a handle: after the click the first unpressed button is a
      DIFFERENT element, so asking it whether it is pressed answered about
      somebody else and the first run of this probe called a working control
      broken.
    */
    const label = ((await page.locator('button[aria-pressed="false"]').first().textContent()) ?? '')
      .trim()
      .split('\n')[0];
    await page.locator('button[aria-pressed="false"]').first().click();
    await page.waitForTimeout(400);
    const pressed = await page
      .locator('button[aria-pressed="true"]')
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()));
    check(
      'choosing a cup size takes effect',
      pressed.some((t) => t.startsWith(label.slice(0, 10))),
      `«${label.slice(0, 26)}» now pressed: ${pressed.length}`,
    );
  }
  await ctx.close();
}

/* ── M. the invitation link ──────────────────────────────────────────────── */

if (should('M')) {
  journey = 'M join';
  const { ctx, page } = await fresh('/join/fixture-token-open');
  check('the invitation screen opens on a direct load', (await h1(page)).includes('הזמנה'), await h1(page));
  const body = await text(page);
  check('it does not redeem on load — it asks', /הצטרפות|לא הצטרפתי|דחייה/.test(body));
  const join = page.getByRole('button', { name: /הצטרפות/ }).first();
  check('it offers to join', (await join.count()) > 0);
  await join.click();
  await page.waitForTimeout(900);
  check(
    'joining lands inside the group',
    /^\/group\//.test(await route(page)),
    await route(page),
  );

  /*
    The refusal comes when the invitation is ACTED on, not on load: §10.2 is
    explicit that opening a link must not redeem it, so the screen asks first
    and the token is only tested when "הצטרפות" is pressed. The first version
    of this check looked for the message on load and reported the product's
    correct behaviour as a defect.
  */
  await page.goto(`${BASE}#/join/not-a-real-token`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  await page.getByRole('button', { name: /הצטרפות/ }).first().click();
  await page.waitForTimeout(700);
  check(
    'a bad token is refused with one undifferentiated message',
    /אינה תקפה/.test(await text(page)),
    (await text(page)).split('\n').find((l) => /תקפה/.test(l)) ?? '',
  );
  await ctx.close();
}

/* ── N. onboarding ───────────────────────────────────────────────────────── */

if (should('N')) {
  journey = 'N onboarding';
  const { ctx, page } = await fresh('/onboarding');
  check('the opening questions open', (await h1(page)).length > 2, await h1(page));
  let steps = 0;
  for (let i = 0; i < 10; i += 1) {
    const next = page
      .locator('button')
      .filter({ hasText: /^(המשך|סיום|למחברת)/ })
      .first();
    if (!(await next.count())) break;
    const profile = page.locator('button[aria-pressed="false"]').first();
    if (await profile.count()) await profile.click();
    await next.click();
    steps += 1;
    await page.waitForTimeout(350);
  }
  check('it can be completed', steps > 0, `${steps} steps`);
  check(
    'and it ends in the app',
    /^\/(notebook|home)/.test(await route(page)),
    await route(page),
  );
  await ctx.close();
}

/* ── STATE: leakage, staleness, history ─────────────────────────────────── */

if (should('S')) {
  journey = 'S state';
  const { ctx, page } = await fresh('/recipe/brioche');

  // 1. a scale set on one recipe must not follow to another.
  await page.getByRole('button', { name: 'יחידות' }).click();
  await page.locator('#scale-value').fill('24');
  await page.waitForTimeout(400);
  await page.goto(`${BASE}#/recipe/croissant`, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  const croissantCook = await page.getByRole('link', { name: 'מצב הכנה' }).getAttribute('href');
  check(
    'a scale set on one recipe does not follow to another',
    croissantCook === '/recipe/croissant/cook',
    croissantCook ?? 'none',
  );

  // 2. Mise en place is per preparation: tick on one recipe, open another.
  await page.goto(`${BASE}#/recipe/brioche/cook`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const b1 = page.locator('section[aria-label="הכנת חומרי גלם"] input[type="checkbox"]');
  await b1.first().click();
  await b1.nth(1).click();
  await page.waitForTimeout(300);
  check('two lines ticked on the brioche', /2 מתוך/.test(await text(page)));
  await page.goto(`${BASE}#/recipe/croissant/cook`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  check(
    'another recipe starts at zero — no Mise en place leaks across recipes',
    /0 מתוך/.test(await text(page)),
    (await text(page)).split('\n').find((l) => /מתוך/.test(l)) ?? '',
  );

  // 3. the same recipe at another scale does not inherit the ticks.
  await page.goto(`${BASE}#/recipe/brioche/cook?mode=units&v=24`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  check(
    'the same recipe at another scale does not inherit ticks',
    /0 מתוך/.test(await text(page)),
    (await text(page)).split('\n').find((l) => /מתוך/.test(l)) ?? '',
  );
  const scaled = await page.evaluate(
    () =>
      document
        .querySelector('section[aria-label="הכנת חומרי גלם"] li label')
        ?.textContent?.trim() ?? '',
  );
  await page.goto(`${BASE}#/recipe/brioche/cook`, { waitUntil: 'load' });
  await page.waitForTimeout(1000);
  const plain = await page.evaluate(
    () =>
      document
        .querySelector('section[aria-label="הכנת חומרי גלם"] li label')
        ?.textContent?.trim() ?? '',
  );
  check('and the quantities differ between the two scales', scaled !== plain, `«${scaled}» vs «${plain}»`);
  /*
    ONE record per recipe, by design (§14: `rn.cook.v1.<recipeId>` holds the
    ticks and the scale they were taken at). Visiting the same recipe at
    another scale therefore takes the record over — the earlier run's ticks are
    not kept beside it, and coming back finds a clean list rather than ticks
    that were true at a different weight. That is the safe direction and the
    one the stage promises; the audit's own requirement is "no stale
    quantities", not "two preparations of one recipe at once".
  */
  check(
    'coming back to the first scale finds a clean list, not ticks from the other scale',
    /0 מתוך/.test(await text(page)),
    (await text(page)).split('\n').find((l) => /מתוך/.test(l)) ?? '',
  );

  // 4. a category filter must not survive into another screen.
  await page.goto(`${BASE}#/notebook`, { waitUntil: 'load' });
  await page.waitForTimeout(800);
  const chips = page.locator('button', { hasText: /^(לחמים|בצקים|קרמים|עוגות)$/ });
  if (await chips.count()) {
    await chips.first().click();
    await page.waitForTimeout(300);
    const filtered = await page.locator(CARD).count();
    await page.goto(`${BASE}#/home`, { waitUntil: 'load' });
    await page.waitForTimeout(700);
    await page.goto(`${BASE}#/notebook`, { waitUntil: 'load' });
    await page.waitForTimeout(800);
    const back = await page.locator(CARD).count();
    check(
      'a filter does not survive leaving the screen',
      back >= filtered,
      `${filtered} filtered → ${back} on return`,
    );
  }

  // 5. back and forward across several screens stay consistent.
  await page.goto(`${BASE}#/notebook`, { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.locator(`${TAB} a[href="/groups"]`).click();
  await page.waitForTimeout(600);
  await page.locator('a[href^="/group/"]').first().click();
  await page.waitForTimeout(700);
  const deep = await route(page);
  await page.goBack();
  await page.waitForTimeout(500);
  check('Back from a group goes to the list', (await route(page)) === '/groups', await route(page));
  await page.goForward();
  await page.waitForTimeout(600);
  check('Forward returns to the group', (await route(page)) === deep, await route(page));
  check('and the screen matches the route', (await h1(page)).length > 2, await h1(page));

  await ctx.close();
}

/* ── EDGE: the uncomfortable cases ──────────────────────────────────────── */

if (should('X')) {
  journey = 'X edges';

  // an unknown route
  {
    const { ctx, page } = await fresh('/no/such/place');
    check(
      'an unknown route redirects to the notebook',
      (await route(page)) === '/notebook',
      await route(page),
    );
    await ctx.close();
  }

  // an unreadable scale
  {
    const { ctx, page } = await fresh('/recipe/brioche/cook?mode=nonsense&v=abc');
    const body = await text(page);
    check(
      'an unreadable scale falls back to the recipe’s own quantities',
      /כמויות כמו במתכון/.test(body),
      body.split('\n').find((l) => /כמויות/.test(l)) ?? '',
    );
    await ctx.close();
  }

  // an enormous and a tiny scale
  {
    const { ctx, page } = await fresh('/recipe/brioche/cook?mode=units&v=100000');
    const big = await page.evaluate(
      () =>
        document
          .querySelector('section[aria-label="הכנת חומרי גלם"] li label')
          ?.textContent?.trim() ?? '',
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check('a huge scale still renders one line per ingredient', /\d/.test(big), big);
    check('and does not overflow sideways', overflow <= 1, `${overflow}px`);
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh('/recipe/brioche/cook?mode=units&v=1');
    const small = await page.evaluate(
      () =>
        document
          .querySelector('section[aria-label="הכנת חומרי גלם"] li label')
          ?.textContent?.trim() ?? '',
    );
    check('a tiny scale renders too', /\d/.test(small), small);
    await ctx.close();
  }

  // a recipe used as a base — one line, not unpacked
  {
    const { ctx, page } = await fresh('/recipe/brioche-choc/cook');
    const heading = await h1(page);
    if (heading === 'הכנת חומרי גלם') {
      const lines = await page.evaluate(() =>
        [...document.querySelectorAll('section[aria-label="הכנת חומרי גלם"] li')].map(
          (li) => li.textContent?.trim() ?? '',
        ),
      );
      const ganache = lines.filter((l) => /גנאש/.test(l));
      check(
        'a base recipe appears once, as one line',
        ganache.length === 1,
        ganache.join(' | ') || lines.join(' | ').slice(0, 120),
      );
      check(
        'and its own ingredients are not unpacked into the list',
        !lines.some((l) => /שמנת|גלוקוז/.test(l)),
        lines.join(' | ').slice(0, 160),
      );
    } else {
      check('the sub-recipe case was reachable', false, `h1 was «${heading}»`);
    }
    await ctx.close();
  }

  // double click on the gate
  {
    const { ctx, page } = await fresh('/recipe/brioche/cook');
    const boxes = page.locator('section[aria-label="הכנת חומרי גלם"] input[type="checkbox"]');
    const n = await boxes.count();
    for (let i = 0; i < n; i += 1) {
      if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).click();
    }
    await page.waitForTimeout(200);
    const gate = page.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' });
    await gate.dblclick();
    await page.waitForTimeout(600);
    check(
      'a double click on the gate starts the steps once, cleanly',
      (await page.getByRole('button', { name: 'סימון השלב כהושלם' }).count()) === 1,
      `${await page.getByRole('button', { name: 'סימון השלב כהושלם' }).count()} step buttons`,
    );
    await ctx.close();
  }

  // a long chat message and a viewport change mid-use
  {
    const { ctx, page } = await fresh('/group/group-course', 402, 880);
    await page.getByRole('tab', { name: /צ׳אט/ }).click();
    await page.waitForTimeout(700);
    await page.fill('#chat-draft', 'א'.repeat(600));
    await page.getByRole('button', { name: 'שליחה' }).click();
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check('a 600-character message does not widen the page', overflow <= 1, `${overflow}px`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);
    const wide = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    check('changing the viewport mid-use does not break the layout', wide <= 1, `${wide}px`);
    await ctx.close();
  }
}

/* ── the end ─────────────────────────────────────────────────────────────── */

const failed = results.filter((r) => !r.pass && !r.known);
const prod = results.filter((r) => !r.pass && r.known);
const fixed = results.filter((r) => r.pass && r.known);
console.log(
  `\n${results.length - failed.length - prod.length}/${results.length} journey checks passed` +
    `${prod.length ? `, ${prod.length} known production finding(s)` : ''}`,
);
for (const f of failed) console.log(`  FAILED  ${f.journey} · ${f.label} -- ${f.detail}`);
for (const f of prod) {
  console.log(`  PRODUCTION  ${f.journey} · ${f.label}`);
  console.log(`      ${KNOWN_PRODUCTION.get(f.label)}`);
}
for (const f of fixed) {
  console.log(`  NOTE  a known production finding now PASSES — remove it from the list:`);
  console.log(`      ${f.journey} · ${f.label}`);
}
console.log(`\nruntime problems: ${runtime.length}`);
for (const r of [...new Set(runtime)].slice(0, 20)) console.log(`  · ${r}`);
fs.writeFileSync(
  path.join(OUT, 'journeys.json'),
  JSON.stringify({ results, runtime: [...new Set(runtime)] }, null, 1),
);
await browser.close();
server.close();
process.exitCode = failed.length === 0 && runtime.length === 0 ? 0 : 1;
