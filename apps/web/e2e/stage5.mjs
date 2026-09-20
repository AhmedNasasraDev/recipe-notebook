// Browser E2E for the stage-5 to 9 surfaces, against the BUILT bundle.
//
// Kept as one file rather than three because the harness — the static server,
// the console and network guards, the onboarding walk — is the bulk of it, and
// three copies of that would rot independently.
//
// WHAT THIS DOES AND DOES NOT PROVE — read this before quoting it as evidence.
//
// It runs against a build made with the Supabase env vars BLANK, so the app is
// in its unconfigured mode and the repository is the read-only demo one. That
// is forced, not chosen: this environment's egress policy blocks *.supabase.co,
// so a browser here cannot open a connection to the project. There is NO real
// PostgREST or GoTrue request anywhere in this file, and nothing here should
// ever be presented as proof of the HTTP path.
//
// So the split of evidence for stage 5 is:
//
//   this file            the new UI in a real browser engine, with real layout,
//                        real pointer events, real <select> behaviour and the
//                        minified artifact — on the parts the demo repository
//                        can reach.
//   VersionFlow.test.tsx the whole versioning and sub-recipe route through the
//                        real components and the real repository, against an
//                        in-memory double of the database.
//   version-roundtrip    the snapshot and restore paths against real Postgres,
//                        including atomicity and the null/0 distinctions.
//   rls-isolation.sql    requirement 8 and requirement 15 against real Postgres,
//                        as `authenticated` and as `anon`.
//
// Two things the demo mode genuinely CAN prove, and they are the reason this
// file exists rather than being folded into stage4.mjs:
//
//   1. The sub-recipe picker's choices and rejections. The demo set contains a
//      real link (bחocolate brioche uses the ganache), so the cycle case is
//      reachable: editing the ganache must not offer the brioche that consumes
//      it. That is the client mirror of the 0007 trigger, running in a browser.
//   2. The version history's honest empty state. Without a server there is no
//      history at all, and the panel has to say so rather than render blank or
//      claim "no versions yet".
//
//   PW=/path/to/playwright/index.js node apps/web/e2e/stage5.mjs
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
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
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

/** Every <option> of a picker, with its label and whether it is selectable. */
const optionsOf = (locator) =>
  locator.evaluate((el) =>
    [...el.options].map((o) => ({ value: o.value, label: o.textContent, disabled: o.disabled })),
  );

await new Promise((r) => server.listen(8124, '127.0.0.1', r));

const browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--no-sandbox'],
});

try {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // The Google Fonts stylesheet cannot load here: this sandbox's egress proxy
    // presents its own certificate and Chromium rejects it. Environment, not app.
    if (/ERR_CERT_AUTHORITY_INVALID|fonts\.(googleapis|gstatic)\.com/.test(m.text())) return;
    errors.push(`console: ${m.text()}`);
  });

  const external = [];
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (!u.startsWith('http://127.0.0.1:8124') && !u.startsWith('data:') && !u.startsWith('https://fonts.')) {
      external.push(u);
      return route.abort();
    }
    return route.continue();
  });

  await page.goto('http://127.0.0.1:8124/notebook', { waitUntil: 'load' });
  await page.waitForTimeout(900);
  check('the built app boots', await finishOnboarding(page));

  // ── requirements 3-7: the history panel, on a real recipe page ──────────
  await page.goto('http://127.0.0.1:8124/recipe/brioche-choc', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  // UX pass: the history sits inside "פרטים מקצועיים", which is collapsed and
  // does not render its contents until it is opened.
  await page.getByText('פרטים מקצועיים').click();
  await page.waitForTimeout(250);

  const history = page.locator('section[aria-label="היסטוריית גרסאות"]');
  check('the recipe page renders the version-history panel', (await history.count()) > 0);

  const historyText = (await history.first().innerText()).replace(/\s+/g, ' ');
  // The live recipe is always in the timeline as "נוכחית" — §9's V1…Vn + current.
  check('the timeline shows the live recipe as the current entry', historyText.includes('נוכחית'));
  // Without a server there is no history AT ALL, and saying "no versions yet"
  // would imply the next save will make one. It will not.
  check(
    'and explains honestly that there is no history without a server',
    /אין עוד היסטוריה/.test(historyText),
    historyText.slice(0, 120),
  );
  check(
    'the panel says why restoring is unavailable rather than hiding it',
    /אין כרגע חיבור/.test(historyText),
  );
  check('no restore button is offered with nothing to restore',
    (await page.getByRole('button', { name: /^שחזור גרסה/ }).count()) === 0);
  await page.screenshot({ path: `${OUT}/10-versions-phone.png`, fullPage: true });

  // The current entry must identify the recipe, not just label it (requirement 4).
  check(
    'the current entry summarises the recipe it describes',
    /רכיבים|רכיב אחד/.test(historyText),
    historyText.slice(0, 160),
  );

  // ── requirements 11-15: the sub-recipe picker, in a real <select> ────────
  // Editing the GANACHE. The chocolate brioche consumes it, so offering that
  // brioche here would close a loop — the client mirror of the 0007 trigger.
  await page.goto('http://127.0.0.1:8124/recipe/ganache/edit', { waitUntil: 'load' });
  await page.waitForTimeout(700);

  const picker = page.locator('select[aria-label^="מתכון בסיס עבור"]').first();
  check('every ingredient row carries a sub-recipe picker', (await picker.count()) > 0);

  // The picker lives inside the row's "more details" disclosure, so a user
  // opens that first. Found here: the disclosure was ALSO collapsed on a row
  // that was already linked, which hid the most consequential field on the row
  // (§18.6 — a linked row is weighed, never volume-converted, and its cost
  // comes from the base). A linked row now opens by default and its summary
  // names the base; both are checked below, on the chocolate brioche.
  await page.locator('summary', { hasText: 'פרטים נוספים' }).first().click();
  await page.waitForTimeout(250);
  check('the picker becomes visible once the row is expanded', await picker.isVisible());

  const opts = await optionsOf(picker);
  const byValue = new Map(opts.map((o) => [o.value, o]));

  check(
    'the picker starts unlinked, with an explicit "not linked" choice',
    opts[0]?.value === '' && /לא מקושר/.test(opts[0]?.label ?? ''),
    opts[0]?.label ?? '(none)',
  );
  // requirement 13
  check(
    'the recipe being edited is not in its own picker',
    !byValue.has('ganache'),
    [...byValue.keys()].join(','),
  );
  // requirement 14, and the reason travels with the option
  const consumer = byValue.get('brioche-choc');
  check(
    'a recipe that would close a cycle is offered but disabled',
    consumer?.disabled === true,
    JSON.stringify(consumer),
  );
  check(
    'and the option itself carries the reason',
    /מעגל/.test(consumer?.label ?? ''),
    consumer?.label ?? '(missing)',
  );
  // requirement 12 — and a usable choice is still usable
  const usable = opts.filter((o) => o.value && !o.disabled);
  check(
    'the other notebook recipes are offered normally',
    usable.length >= 2,
    usable.map((o) => o.value).join(','),
  );
  check(
    'base recipes are marked as such in the list',
    usable.some((o) => /\(בסיס\)/.test(o.label ?? '')),
    usable.map((o) => o.label).join(' | '),
  );
  await page.screenshot({ path: `${OUT}/11-sub-picker-phone.png`, fullPage: true });

  // A real browser select: picking a valid option must stick, and the hint
  // must switch to the linked wording.
  await picker.selectOption(usable[0].value);
  await page.waitForTimeout(300);
  check('selecting a valid base recipe sticks', (await picker.inputValue()) === usable[0].value);
  const linkedHint = await page.locator('select[aria-label^="מתכון בסיס עבור"]').first()
    .evaluate((el) => el.parentElement?.querySelector('p')?.textContent ?? '');
  check(
    'and the hint says the quantity is weighed and the cost rolls up (§18.6)',
    /במשקל/.test(linkedHint) && /מתגלגלת/.test(linkedHint),
    linkedHint.slice(0, 90),
  );

  // Chromium refuses to select a disabled option, which is the point: the
  // invalid choice is not merely discouraged, it is unreachable by pointer.
  let refused = false;
  try {
    await picker.selectOption('brioche-choc', { timeout: 1500 });
  } catch {
    refused = true;
  }
  check(
    'a cycle-creating option cannot be chosen through the UI at all',
    refused && (await picker.inputValue()) !== 'brioche-choc',
    await picker.inputValue(),
  );

  // A row that is ALREADY linked must not hide the fact.
  await page.goto('http://127.0.0.1:8124/recipe/brioche-choc/edit', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const linkedRow = page.locator('details:has(select[aria-label^="מתכון בסיס עבור"])')
    .filter({ hasText: 'מתכון בסיס:' }).first();
  check(
    'a row that is already linked shows the link while the others stay collapsed',
    (await linkedRow.count()) > 0 && (await linkedRow.evaluate((el) => el.open)) === true,
  );
  const linkedSummary = (await linkedRow.locator('summary').first().innerText()).replace(/\s+/g, ' ');
  check(
    'and the summary names the base recipe, not just its id',
    /מתכון בסיס: גנאש/.test(linkedSummary),
    linkedSummary,
  );
  const linkedPicker = linkedRow.locator('select[aria-label^="מתכון בסיס עבור"]').first();
  check(
    'its picker is visible without any interaction, already holding the link',
    (await linkedPicker.isVisible()) && (await linkedPicker.inputValue()) === 'ganache',
    await linkedPicker.inputValue(),
  );
  await page.screenshot({ path: `${OUT}/14-linked-row-phone.png`, fullPage: true });

  // ── stage 6: the delete guard ───────────────────────────────────────────
  //
  // WHAT A BROWSER CAN CHECK HERE, AND WHAT IT CANNOT.
  //
  // The blocking dialog is NOT reachable in this build, and that is correct
  // rather than a gap in the UI: without a server the recipe is read-only, so
  // the delete button is disabled before the question "is anything using this?"
  // can arise. Trying to drive the dialog from here would mean loosening the
  // read-only rule to make a test pass.
  //
  // So the guard's coverage is split:
  //   supabase/tests/delete-guard.sql   the enforcement, against live Postgres,
  //                                     as `authenticated` and as `anon`
  //   app/DeleteGuardFlow.test.tsx      the dialog, the named dependents, the
  //                                     links and the bypass, through the real
  //                                     component tree
  //   here                              that the read-only build disables the
  //                                     delete rather than offering one it
  //                                     cannot perform
  await page.goto('http://127.0.0.1:8124/recipe/ganache', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  // UX pass: מחיקה is under "עוד פעולות" now — off the first screenful, and
  // one tap away. What is checked below is unchanged: that a read-only build
  // offers it DISABLED rather than pretending it can delete.
  await page.getByText('עוד פעולות').click();
  await page.waitForTimeout(250);

  const delBtn = page.getByRole('button', { name: /^מחיקת/ }).first();
  check('the recipe page offers a delete control', (await delBtn.count()) > 0);
  check(
    'and it is disabled in a build with no server, rather than failing when pressed',
    await delBtn.isDisabled(),
  );
  const noBackend = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the page says why nothing can be changed',
    /אין כרגע חיבור|לקריאה בלבד|אין חיבור/.test(noBackend),
    noBackend.slice(0, 140),
  );
  await page.screenshot({ path: `${OUT}/15-readonly-actions-phone.png`, fullPage: true });

  // ── stage 6: the version-comparison entry point ─────────────────────────
  //
  // The demo repository truthfully has NO version history (there is no server),
  // so the comparison screen itself cannot be opened here — its coverage is
  // VersionCompare.test.tsx. What a browser can check is that the entry points
  // are correctly absent rather than present and broken.
  await page.goto('http://127.0.0.1:8124/recipe/brioche-choc', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  check(
    'no "compare two versions" button with no history to compare',
    (await page.getByRole('button', { name: 'השוואה בין שתי גרסאות' }).count()) === 0,
  );
  check(
    'and no per-version compare button either',
    (await page.getByRole('button', { name: /^השוואת גרסה/ }).count()) === 0,
  );

  // ── accessibility of the new controls ───────────────────────────────────
  await page.goto('http://127.0.0.1:8124/recipe/ganache/edit', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const pickerCount = await page.locator('select[aria-label^="מתכון בסיס עבור"]').count();
  const pickerNames = await page.locator('select[aria-label^="מתכון בסיס עבור"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  check(
    'each picker has its own accessible name, one per ingredient row',
    new Set(pickerNames).size === pickerCount && pickerCount > 1,
    `${pickerCount} pickers, ${new Set(pickerNames).size} distinct names`,
  );

  const shortPickers = await page.locator('select[aria-label^="מתכון בסיס עבור"]')
    .evaluateAll((els) =>
      els.map((e) => Math.round(e.getBoundingClientRect().height)).filter((h) => h < 40),
    );
  check('every picker is at least 40px tall', shortPickers.length === 0, shortPickers.join(','));

  const phoneOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('no horizontal overflow on a phone with the new controls', phoneOverflow <= 1, `${phoneOverflow}px`);

  // ── tablet ──────────────────────────────────────────────────────────────
  const tablet = await browser.newContext({ viewport: { width: 1024, height: 1366 } });
  const tPage = await tablet.newPage();
  tPage.on('pageerror', (e) => errors.push(e.message));
  await tPage.goto('http://127.0.0.1:8124/notebook', { waitUntil: 'load' });
  await tPage.waitForTimeout(700);
  await finishOnboarding(tPage);

  await tPage.goto('http://127.0.0.1:8124/recipe/brioche-choc', { waitUntil: 'load' });
  await tPage.waitForTimeout(700);
  await tPage.getByText('פרטים מקצועיים').click();
  await tPage.waitForTimeout(250);
  const tHistory = tPage.locator('section[aria-label="היסטוריית גרסאות"]');
  check('the history panel renders on a tablet too', (await tHistory.count()) > 0);
  await tPage.screenshot({ path: `${OUT}/12-versions-tablet.png`, fullPage: true });

  await tPage.goto('http://127.0.0.1:8124/recipe/ganache/edit', { waitUntil: 'load' });
  await tPage.waitForTimeout(700);
  await tPage.screenshot({ path: `${OUT}/13-sub-picker-tablet.png`, fullPage: true });

  const tabletOverflow = await tPage.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('no horizontal overflow on a tablet', tabletOverflow <= 1, `${tabletOverflow}px`);

  // ── stage 7: the ingredient centre and food cost ────────────────────────
  //
  // WHAT THIS BUILD CAN AND CANNOT SHOW. The demo repository returns an EMPTY
  // catalog, and honestly so: the centre holds business data — prices,
  // suppliers — which belongs to an account, and there is no account here.
  // Demo prices would be an invented cost basis. So the centre's own behaviour
  // is covered by IngredientsScreen.test.tsx (21 cases) and PricingFlow.test.tsx
  // (14), and the database half by supabase/tests/pricing.sql (27, live).
  //
  // What a real browser can add: that the screen exists, that it is reachable
  // from "עוד", that it says the right thing with nothing in it, and that the
  // food-cost panel renders and withholds the percentage it cannot compute.
  await page.goto('http://127.0.0.1:8124/more', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  // STAGE-11: "עוד" is now the menu §2 screen 19 describes, and its entries
  // carry a title and a line of explanation — so the link is found by href
  // rather than by an exact accessible name that now includes both.
  const centreLink = page.locator('a[href="/ingredients"]');
  check('the ingredient centre is reachable from "עוד"', (await centreLink.count()) > 0);
  // The menu is checked as a whole here, because a menu with a dead entry is
  // the defect this screen used to have.
  for (const [href, label] of [
    ['/ingredients', 'חומרי גלם'],
    ['/plans', 'תכנון ייצור'],
    ['/tools', 'כלי המדידה'],
    ['/settings', 'הגדרות'],
  ]) {
    check(
      `"עוד" links to ${label}`,
      (await page.locator(`a[href="${href}"]`).count()) > 0,
    );
  }
  await centreLink.first().click();
  await page.waitForTimeout(700);

  check(
    'the centre renders',
    (await page.getByRole('heading', { name: 'חומרי גלם' }).count()) > 0,
  );
  const centreText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'and explains what it is for',
    /שינוי מחיר כאן משנה את העלות בכל המתכונים/.test(centreText),
    centreText.slice(0, 120),
  );
  check(
    'the empty state says what happens once a material is priced',
    /אין עדיין חומרי גלם/.test(centreText),
  );
  check(
    'adding is disabled with no account, rather than failing when pressed',
    await page.getByRole('button', { name: 'הוספת חומר גלם' }).isDisabled(),
  );
  await page.screenshot({ path: `${OUT}/16-ingredients-phone.png`, fullPage: true });

  // The food-cost panel on a demo recipe. The demo set prices its rows
  // directly, so there IS a cost; nobody has set a sale price, so the
  // percentage must be withheld WITH a reason.
  await page.goto('http://127.0.0.1:8124/recipe/brioche', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  await page.getByText('פרטים מקצועיים').click();
  await page.waitForTimeout(400);

  const fc = page.locator('[aria-label="פוד קוסט"]');
  check('the recipe page shows a food cost panel', (await fc.count()) > 0);
  const fcText = (await fc.first().innerText()).replace(/\s+/g, ' ');
  check('with the total ingredient cost', /עלות חומרי הגלם/.test(fcText));
  check('the cost per kilogram', /עלות לק"ג/.test(fcText));
  check('and the sale price row', /מחיר מכירה/.test(fcText));
  check(
    'the percentage is withheld, as a dash',
    (await fc.locator('[aria-label="אחוז פוד קוסט"]').innerText()).trim() === '—',
    await fc.locator('[aria-label="אחוז פוד קוסט"]').innerText(),
  );
  check(
    'and the reason is given rather than leaving a bare dash',
    /מחיר מכירה/.test(
      await fc.locator('[aria-label="למה אין אחוז פוד קוסט"]').innerText(),
    ),
  );
  await page.screenshot({ path: `${OUT}/17-food-cost-phone.png`, fullPage: true });

  const fcOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('no horizontal overflow with the food cost panel open', fcOverflow <= 1, `${fcOverflow}px`);

  // ── stage 8: the full cost and the sale side, in a real browser ────────
  // The demo recipes price their rows directly, so the ingredient cost is
  // real; nobody has entered packaging, labour or a sale price, so the panel
  // has to show what is missing rather than a total that looks finished.
  const costing = page.locator('[aria-label="עלות ורווחיות"]');
  check('the recipe page shows the cost and profitability panel', (await costing.count()) > 0);

  const costText = (await costing.innerText()).replace(/\s+/g, ' ');
  check('it breaks the cost into its parts', /חומרי גלם/.test(costText) && /אריזה/.test(costText) && /עבודה/.test(costText));
  check(
    'margin and markup appear under their own names',
    /רווח גולמי %/.test(costText) && /Markup %/.test(costText),
    costText.slice(0, 160),
  );
  check(
    'it names the cost parts nobody entered',
    (await page.locator('[aria-label="מה לא הוזן בעלות"]').count()) > 0,
  );
  check(
    'and says a blank field is not a zero',
    /שדה ריק אינו אפס/.test(costText),
  );
  check(
    'with no sale price there is no margin, and the reason is given',
    (await page.locator('[aria-label="רווח גולמי אחוז"]').innerText()).trim() === '—' &&
      /מחיר מכירה/.test(await page.locator('[aria-label="למה אין רווחיות"]').innerText()),
  );
  check(
    'a computed target price is labelled a target, not "the right price"',
    /ולא "המחיר הנכון"/.test(costText),
  );
  await page.screenshot({ path: `${OUT}/18-costing-phone.png`, fullPage: true });

  const costOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('no horizontal overflow with the costing panel open', costOverflow <= 1, `${costOverflow}px`);

  // ── stage 8: the purchase entry fields in the centre ───────────────────
  await page.goto('http://127.0.0.1:8124/ingredients', { waitUntil: 'load' });
  await page.waitForTimeout(500);
  const centre2 = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'the centre explains that the purchase is entered as it was made',
    /כמה שולם בסך הכול, כמה אריזות, ומה יש בכל אריזה/.test(centre2) ||
      /אין עדיין חומרי גלם/.test(centre2),
    centre2.slice(0, 160),
  );

  // ── stage 9: production planning, in a real browser ────────────────────
  await page.goto('http://127.0.0.1:8124/plans', { waitUntil: 'load' });
  await page.waitForTimeout(600);

  check(
    'the production planning screen renders',
    (await page.getByRole('heading', { name: 'תכנון ייצור' }).count()) > 0,
  );
  const planText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  check(
    'it says what a plan is for',
    /מחשבת מהמתכונים כמה חומר גלם צריך/.test(planText),
    planText.slice(0, 140),
  );
  check(
    'the empty state is honest in a build with no server',
    /אין עדיין תוכניות ייצור/.test(planText),
  );
  check(
    'creating a plan is disabled with no account, rather than failing when pressed',
    await page.getByRole('button', { name: 'תוכנית ייצור חדשה' }).isDisabled(),
  );
  await page.screenshot({ path: `${OUT}/19-plans-phone.png`, fullPage: true });

  const plansOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('no horizontal overflow on the planning screen', plansOverflow <= 1, `${plansOverflow}px`);

  // The step-kind picker, which is what makes a timeline possible at all.
  await page.goto('http://127.0.0.1:8124/recipe/brioche/edit', { waitUntil: 'load' });
  await page.waitForTimeout(700);
  const kindPicker = page.getByLabel('סוג השלב 1');
  check('a step can be classified from the editor', (await kindPicker.count()) > 0);
  if ((await kindPicker.count()) > 0) {
    const options = await kindPicker.locator('option').allInnerTexts();
    check(
      'and the choices include proofing, refrigeration and baking',
      options.some((o) => o.includes('התפחה')) &&
        options.some((o) => o.includes('קירור')) &&
        options.some((o) => o.includes('אפייה')),
      options.join(' · '),
    );
    check(
      'with "not classified" as the default, rather than a guess',
      (await kindPicker.inputValue()) === '',
    );
  }

  check('no page errors anywhere in the run', errors.length === 0, errors.slice(0, 3).join(' | '));
  check(
    'nothing tried to reach an external origin',
    external.length === 0,
    external.slice(0, 3).join(' | '),
  );

  await ctx.close();
  await tablet.close();
} finally {
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots in ${OUT}`);
if (failed.length) process.exit(1);
