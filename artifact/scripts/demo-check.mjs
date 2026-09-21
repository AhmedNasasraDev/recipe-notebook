/*
  Tests THE EXPORTED FILE, opened the way a person opens it: `file://…`, from
  disk, with every outward request blocked.

    node artifact/scripts/standalone.mjs && node artifact/scripts/demo-check.mjs

  Why not the dev server: a local file is a different environment from
  `http://localhost` — it is an opaque origin, it has no server to fetch a
  sibling asset from, and `localStorage`, IndexedDB and fullscreen are all
  allowed or refused per browser. A demo that works in the dev server and
  breaks when someone double-clicks it is not a demo. So this drives the packed
  file, in one Chromium, and reports what the page actually did.

  What a run cannot tell you: how Safari or Firefox treat the same file (they
  are stricter about local storage), and how a phone's browser opens a
  downloaded HTML file at all. Those are stated as limits, not measured here.
*/

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));
const CHROME = process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const FILE =
  process.env['DEMO'] ??
  fileURLToPath(new URL('../dist-demo/recipe-notebook-demo.html', import.meta.url));
const URL_ = `file://${FILE}`;
const SHOTS = process.env['SHOTS'] ?? '/home/user/ahh/.e2e-shots/demo';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (label, pass, detail = '') => {
  results.push({ label, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${label}${detail ? ` -- ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const outward = [];
  const errors = [];
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('file://') || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    outward.push(url);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 140)}`);
  });

  const open = async (hash = '') => {
    await page.goto(`${URL_}${hash}`, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
  };

  // ── 1. it opens from disk, and says what it is ──────────────────────────
  await open();
  check('the file opens from disk and the app mounts', (await page.locator('.boot').count()) === 0);

  const dialog = page.getByRole('dialog', { name: 'על גרסת הניסוי' });
  check('the demo notice opens on the first visit', (await dialog.count()) === 1);
  const saysLocal = await dialog.innerText();
  check(
    'it says the data is sample data, local, and unsynced',
    /נתוני\s*דוגמה/.test(saysLocal) && /במכשיר הזה/.test(saysLocal) && /סנכרון/.test(saysLocal),
  );
  check(
    'and it reports the saving it actually measured',
    /נשמרים בדפדפן הזה/.test(saysLocal) || /חוסם שמירה מקומית/.test(saysLocal),
    /נשמרים בדפדפן הזה/.test(saysLocal) ? 'local saving available here' : 'saving blocked here',
  );
  await page.screenshot({ path: path.join(SHOTS, 'demo-notice.png') });

  await page.getByRole('button', { name: 'התחלה' }).click();
  await page.waitForTimeout(400);
  check('closing it lands on the notebook', (await page.getByRole('heading', { name: 'מחברת מתכונים' }).count()) === 1);
  check(
    'the notice stays one press away',
    (await page.getByRole('button', { name: 'גרסת ניסוי — סימולציה מקומית. מה זה?' }).count()) === 1,
  );
  const cards = await page.locator('a[href^="/recipe/"]').count();
  check('the sample notebook is there', cards >= 5, `${cards} recipe links`);

  /*
    THE PILL IS THE ONE THING ON THE PAGE THAT IS NOT A PRODUCT SCREEN, so it
    is measured rather than trusted: on every screen, at three sizes and on its
    side, it must not sit on top of a control.
  */
  const overlaps = [];
  for (const [w, h, size] of [
    [402, 874, 'phone'],
    [874, 402, 'phone sideways'],
    [768, 1024, 'tablet'],
    [1440, 900, 'desktop'],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    for (const route of [
      '/notebook',
      '/home',
      '/groups',
      '/more',
      '/settings',
      '/ingredients',
      '/plans',
      '/tools',
      '/recipe/brioche',
      '/recipe/new',
      '/recipe/brioche/cook',
    ]) {
      await open(`#${route}`);
      const hits = await page.evaluate(() => {
        const pill = document.querySelector('button[class*="pill"]');
        if (!pill) return ['no pill'];
        const b = pill.getBoundingClientRect();
        const out = [];
        document.querySelectorAll('a[href], button, input, select, textarea').forEach((el) => {
          if (el === pill || el.closest('[class*="backdrop"]')) return;
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return;
          if (!(r.right < b.left || r.left > b.right || r.bottom < b.top || r.top > b.bottom)) {
            out.push(`${el.tagName}«${(el.textContent || '').trim().slice(0, 14)}»`);
          }
        });
        return out;
      });
      if (hits.length) overlaps.push(`${size} ${route}: ${hits.join(', ')}`);
    }
  }
  await page.setViewportSize({ width: 402, height: 874 });
  check(
    'the "סימולציה מקומית" strip covers no control, on any screen at any size',
    overlaps.length === 0,
    overlaps.slice(0, 3).join(' | ') || '11 screens × 4 sizes',
  );

  // ── 2. nobody's real name, and no account ──────────────────────────────
  await open('#/settings');
  const settings = await page.evaluate(() => ({
    text: document.body.innerText,
    values: [...document.querySelectorAll('input')].map((i) => i.value),
  }));
  check(
    'the demo account is a sample one, not the owner of the project',
    !/אחמד/.test(settings.text) && !settings.values.some((v) => /אחמד/.test(v)),
  );
  check(
    'and the demo name is the one shown',
    settings.values.some((v) => v === 'שף לדוגמה'),
    settings.values.filter(Boolean).join(' · '),
  );

  // ── 3. navigation ──────────────────────────────────────────────────────
  await open();
  for (const [label, href] of [
    ['בית', '/home'],
    ['קבוצות', '/groups'],
    ['עוד', '/more'],
    ['מחברת', '/notebook'],
  ]) {
    await page.locator(`a[href="${href}"]`).first().click();
    await page.waitForTimeout(500);
    const hash = await page.evaluate(() => window.location.hash);
    check(`the ${label} tab navigates`, hash.startsWith(`#${href}`), hash);
  }

  // ── 4. creating a recipe, and finding it again ──────────────────────────
  /*
    THE EDITOR IS A WIZARD (§6), SO THE DEMO WALKS IT LIKE A PERSON.

    One stage at a time — פרטים, חומרי גלם, אופן ההכנה, סיכום — so the name is
    on stage 1, the ingredient rows on stage 2, and the final save only on the
    summary. `toStage` is the stepper, found by the accessible name it carries.
    Filling a field that is not on the current stage is how this file stopped
    at 14 of its 42 checks.
  */
  const toStage = async (n) => {
    await page.getByRole('button', { name: new RegExp(`^שלב ${n} `) }).click();
    await page.waitForTimeout(400);
  };

  await open('#/recipe/new');
  const NAME = `עוגת ניסוי ${Date.now() % 10_000}`;
  await page.getByLabel('שם המתכון', { exact: false }).first().fill(NAME);
  await toStage(2);
  await page.getByLabel('שם הרכיב בשורה 1').fill('קמח לחם');
  await page.getByLabel('כמות').first().fill('500');
  await page.waitForTimeout(200);
  await toStage(4);
  const save = page.getByRole('button', { name: /שמירת ה(מתכון|שינויים)/ });
  check('the editor offers a save', (await save.count()) >= 1);
  await save.first().click();
  await page.waitForTimeout(1200);
  const afterSave = await page.evaluate(() => window.location.hash);
  check('saving leaves the editor', !afterSave.includes('/new'), afterSave);

  await open('#/notebook');
  check(
    'the new recipe is in the notebook',
    (await page.getByText(NAME, { exact: false }).count()) >= 1,
    NAME,
  );

  // ── 5. the same file, reopened ─────────────────────────────────────────
  await open('#/notebook');
  const stillThere = (await page.getByText(NAME, { exact: false }).count()) >= 1;
  check('and it survives a reload, saved locally', stillThere);

  // ── 6. editing it ──────────────────────────────────────────────────────
  /* The recipe screen keeps "עריכה" inside "עוד פעולות", and a closed
     disclosure is not built (the UX pass), so the demo opens it the way a
     person does rather than jumping to the route. */
  await page.getByText(NAME, { exact: false }).first().click();
  await page.waitForTimeout(900);
  const more = page.getByText('עוד פעולות', { exact: true }).first();
  if (await more.count()) {
    await more.click();
    await page.waitForTimeout(400);
  }
  const editLink = page.locator('a[href$="/edit"]').first();
  check('the recipe offers an edit', (await editLink.count()) === 1);
  await editLink.click();
  await page.waitForTimeout(1000);
  await page.getByLabel('שם המתכון').fill(`${NAME} — נערך`);
  await page.waitForTimeout(200);
  /* The name is stage 1's field and the save is on the summary, so the edit
     is finished the way the wizard finishes one. */
  await toStage(4);
  await page.getByRole('button', { name: /שמירת ה(מתכון|שינויים)/ }).first().click();
  await page.waitForTimeout(1200);
  await open('#/notebook');
  check(
    'an edit is saved too, and is still there after a reload',
    (await page.getByText(`${NAME} — נערך`, { exact: false }).count()) >= 1,
  );

  // ── 7. the calculation ─────────────────────────────────────────────────
  await open('#/recipe/brioche');
  const before = await page.locator('[class*="qty"]').first().innerText();
  await page.getByRole('button', { name: 'יחידות', exact: true }).first().click();
  await page.waitForTimeout(300);
  const unitsInput = page.locator('input[inputmode="decimal"], input[type="number"]').first();
  await unitsInput.fill('24');
  await page.waitForTimeout(600);
  const after = await page.locator('[class*="qty"]').first().innerText();
  check('the quantities recompute for a different batch', before !== after, `${before} → ${after}`);

  // ── 8. mise en place and the steps ─────────────────────────────────────
  await open('#/recipe/brioche/cook');
  const boxes = page.locator('section[aria-label="הכנת חומרי גלם"] input[type="checkbox"]');
  const n = await boxes.count();
  check('the weighing list is the recipe\'s own', n >= 5, `${n} rows`);
  /* §7: a checklist, not a lock — the way through is open from the start and
     the screen says how many lines are still unticked. */
  const gate = page.getByRole('button', { name: 'מעבר להכנה' });
  check('the way through is open from the start', await gate.isEnabled());
  check(
    'and it says how many lines are left',
    (await page.getByText(/נותרו/).count()) >= 1,
  );
  for (let i = 0; i < n; i += 1) await boxes.nth(i).check();
  await page.waitForTimeout(300);
  check(
    'ticking everything changes what it says',
    (await page.getByRole('button', { name: 'הכול מוכן' }).count()) === 1 &&
      (await page.getByText(/נותרו/).count()) === 0,
  );
  await page.screenshot({ path: path.join(SHOTS, 'demo-mise.png') });
  /* `gate` matched the label while lines were unticked; with the list
     complete the same control reads "הכול מוכן — מתחילים בהכנה". */
  await page.getByRole('button', { name: 'הכול מוכן' }).click();
  await page.waitForTimeout(700);
  check('the steps open', (await page.locator('[class*="stepText"]').count()) === 1);

  const fs_ = page.getByRole('button', { name: 'מסך מלא' });
  check('the kitchen screen offers a fullscreen', (await fs_.count()) === 1);
  await fs_.click();
  await page.waitForTimeout(600);
  const state = await page.evaluate(() => ({
    real: Boolean(document.fullscreenElement),
    note: document.body.innerText.includes('מסך מלא אינו זמין בתצוגה הזאת'),
    pressed: document
      .querySelector('button[aria-pressed="true"]')
      ?.textContent?.includes('יציאה ממסך מלא'),
    stillCooking: document.querySelectorAll('[class*="stepText"]').length === 1,
  }));
  check(
    'and it either goes fullscreen or says it could not',
    (state.real || state.note) && state.pressed === true,
    state.real ? 'real fullscreen granted from file://' : 'refused — the focused mode said so',
  );
  check('leaving fullscreen is not leaving the preparation', state.stillCooking);
  await page.screenshot({ path: path.join(SHOTS, 'demo-cook.png') });
  await page.getByRole('button', { name: 'יציאה ממסך מלא' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button', { name: 'הבא' }).click();
  await page.waitForTimeout(400);
  check(
    'the steps advance',
    (await page.locator('[class*="stepNum"]').first().innerText()) === '2',
  );

  // ── 9. sideways, and on bigger screens ─────────────────────────────────
  await page.setViewportSize({ width: 874, height: 402 });
  await page.waitForTimeout(600);
  const land = await page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="ניווט בין שלבים"]');
    const r = nav?.getBoundingClientRect();
    const de = document.documentElement;
    return {
      steps: document.querySelectorAll('[class*="stepText"]').length,
      navInView: r ? r.top >= 0 && r.bottom <= de.clientHeight + 1 : false,
      overflowX: de.scrollWidth - de.clientWidth,
      step: document.querySelector('[class*="stepNum"]')?.textContent?.trim(),
    };
  });
  check('sideways: one step, buttons on screen, no sideways scroll',
    land.steps === 1 && land.navInView && land.overflowX <= 1,
    `steps ${land.steps}, nav in view ${land.navInView}, overflow ${land.overflowX}px`);
  check('and the rotation kept the step', land.step === '2', `step ${land.step}`);
  await page.screenshot({ path: path.join(SHOTS, 'demo-landscape.png') });

  for (const [w, h, name] of [[768, 1024, 'tablet'], [1440, 900, 'desktop']]) {
    await page.setViewportSize({ width: w, height: h });
    await open('#/notebook');
    const m = await page.evaluate(() => ({
      dir: getComputedStyle(document.documentElement).direction,
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      font: getComputedStyle(document.querySelector('h1') ?? document.body).fontFamily,
    }));
    check(`${name}: right-to-left, no sideways scroll, Heebo`,
      m.dir === 'rtl' && m.overflowX <= 1 && m.font.includes('Heebo'),
      `${m.dir} · ${m.overflowX}px · ${m.font.split(',')[0]}`);
    await page.screenshot({ path: path.join(SHOTS, `demo-${name}.png`) });
  }

  // ── 10. the fonts really are inside the file ───────────────────────────
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      faces: [...document.fonts].map((f) => `${f.family} ${f.status}`),
      heebo400: document.fonts.check('400 16px Heebo'),
      heebo600: document.fonts.check('600 16px Heebo'),
    };
  });
  check('Heebo is loaded from inside the file, at both weights',
    fonts.heebo400 && fonts.heebo600 && fonts.faces.length >= 2,
    fonts.faces.join(' · '));

  /*
    ── 11. THE BROWSER THAT REFUSES TO STORE ANYTHING ─────────────────────
    Safari does this for a local file, a private window does it everywhere, and
    an embedded webview can do it at any time. The demo must then still run and
    must SAY that nothing will be kept — not claim a save it did not make. The
    refusal is simulated here by making the accessors throw, which is what
    those browsers do.
  */
  const blockedCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  await blockedCtx.route('**/*', (route) =>
    route.request().url().startsWith('file://') ||
    route.request().url().startsWith('data:') ||
    route.request().url().startsWith('blob:')
      ? route.continue()
      : route.abort(),
  );
  await blockedCtx.addInitScript(() => {
    const boom = () => {
      throw new DOMException('refused', 'SecurityError');
    };
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get: () => ({ getItem: boom, setItem: boom, removeItem: boom, clear: boom, key: boom, length: 0 }),
    });
  });
  const blocked = await blockedCtx.newPage();
  const blockedErrors = [];
  blocked.on('pageerror', (e) => blockedErrors.push(e.message));
  await blocked.goto(URL_, { waitUntil: 'load' });
  await blocked.waitForTimeout(1400);
  const blockedText = await blocked.locator('body').innerText();
  check(
    'with storage refused the demo still opens',
    (await blocked.locator('.boot').count()) === 0 && blockedErrors.length === 0,
    blockedErrors.slice(0, 1).join(''),
  );
  check(
    'and it says the changes will not survive the reload, instead of claiming a save',
    /חוסם שמירה מקומית/.test(blockedText) && !/נשמרים בדפדפן הזה/.test(blockedText),
  );
  await blocked.getByRole('button', { name: 'התחלה' }).click();
  await blocked.waitForTimeout(500);
  check(
    'and the notebook is usable anyway',
    (await blocked.locator('a[href^="/recipe/"]').count()) >= 5,
  );
  await blockedCtx.close();

  /*
    ── 12. THE SAME FILE, SERVED FROM A URL ───────────────────────────────
    Which is how it has to be opened on most phones: a browser that downloads
    an .html file often cannot open it from local storage at all. Nothing about
    the file changes, so this checks that it does not depend on `file://`
    either — it is one document with no request to make.
  */
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(FILE));
  });
  await new Promise((r) => server.listen(8171, '127.0.0.1', r));
  const httpCtx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const httpOutward = [];
  await httpCtx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('http://127.0.0.1:8171') || url.startsWith('data:') || url.startsWith('blob:')) {
      return route.continue();
    }
    httpOutward.push(url);
    return route.abort();
  });
  const served = await httpCtx.newPage();
  const servedErrors = [];
  served.on('pageerror', (e) => servedErrors.push(e.message));
  await served.goto('http://127.0.0.1:8171/', { waitUntil: 'load' });
  await served.waitForTimeout(1400);
  await served.getByRole('button', { name: 'התחלה' }).click();
  await served.waitForTimeout(500);
  check(
    'served from a URL it opens the same way, and fetches nothing',
    (await served.locator('a[href^="/recipe/"]').count()) >= 5 &&
      httpOutward.length === 0 &&
      servedErrors.length === 0,
    `${httpOutward.length} outward requests, ${servedErrors.length} errors`,
  );
  await served.goto('http://127.0.0.1:8171/#/recipe/brioche/cook', { waitUntil: 'load' });
  await served.waitForTimeout(1200);
  check(
    'and a shared deep link lands on the screen it names',
    (await served.locator('section[aria-label="הכנת חומרי גלם"]').count()) === 1,
  );
  await httpCtx.close();
  server.close();

  check('nothing was fetched from outside the file', outward.length === 0, outward.slice(0, 3).join(' '));
  check('no page error anywhere in the run', errors.length === 0, errors.slice(0, 2).join(' | '));

  await ctx.close();
} finally {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} demo checks passed`);
  for (const f of failed) console.log(`  FAILED  ${f.label} -- ${f.detail}`);
  console.log(`screenshots in ${SHOTS}`);
  await browser.close();
  process.exitCode = failed.length === 0 ? 0 : 1;
}
