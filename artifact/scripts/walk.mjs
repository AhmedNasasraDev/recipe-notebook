// DEAD-BUTTON WALK — clicks every clickable thing on every reachable screen.
//
// The question it answers is the one that matters for a simulation: is there a
// control that looks operable and does nothing? For each screen it enumerates
// every enabled button, link, tab, select and checkbox, then — one at a time,
// from a FRESH page load each time, so the run is deterministic — clicks it and
// records what happened:
//
//   route changed      → navigation works
//   DOM changed        → the control did something on screen
//   an alert appeared  → recorded as a FINDING with the message
//   nothing at all     → recorded as a FINDING (candidate dead control)
//
// A fresh load per click matters twice: the fixture repository is created at
// module load, so every click starts from the same data, and a click that
// deletes something cannot poison the next one.
//
//   node artifact/scripts/walk.mjs            # everything
//   node artifact/scripts/walk.mjs /groups    # one screen

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PW = process.env['PW'] ?? '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = (await import(PW)).default ?? (await import(PW));

const HERE = path.dirname(fileURLToPath(import.meta.url));
/* Both default to the local build, and both can be pointed at the files the
   artifact service actually serves, so the walk can be run over the LIVE page:
     PAGE=<dir>/index.html DIST=<dir> node artifact/scripts/walk.mjs */
const DIST = process.env['DIST'] ?? path.join(HERE, '..', 'dist');
const OUT = path.join(HERE, '..', '..', '.e2e-shots', 'audit');
fs.mkdirSync(OUT, { recursive: true });

const CHROME = process.env['CHROME'] ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

/* The platform wraps the published file in its own document. Mirrored here so
   the walk runs against the same shape that gets published. */
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
    res.end(WRAPPED);
    return;
  }
  const file = path.join(DIST, url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    res.end('no');
    return;
  }
  res.writeHead(200, {
    'Content-Type': file.endsWith('.js')
      ? 'text/javascript; charset=utf-8'
      : file.endsWith('.css')
        ? 'text/css; charset=utf-8'
        : 'application/octet-stream',
  });
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(8135, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:8135/index.html';

/* Every screen a person can reach by using the app, with the fixture's own
   ids. `/join/:token` is not here: in the product it is an email link, and in
   the artifact it is reached by the page's hash — it gets its own pass below. */
/*
  A screen may sit BEHIND something, and the walk has to get there the way a
  person does. §14's steps are behind Mise en place: the ingredient list has to
  be ticked and the gate pressed before a step exists on the page, so the steps
  screen is listed with a `prepare` that does exactly that. Without it the walk
  simply stopped covering the step controls when the stage was added, and a
  suite that quietly covers less is worse than one that fails.
*/
const PREPARE = {
  /*
    The recipe page again, with both panels open.

    The UX pass moved the print sheets, שכפול and מחיקה under "עוד פעולות" and
    the production data, the allergens and the version history under
    "פרטים מקצועיים", and neither renders its contents while it is closed. A
    walk that only saw the closed page would quietly stop covering a dozen
    controls — exactly the silent loss of coverage the note below is about.
  */
  '/recipe/brioche#panels': async (page) => {
    for (const label of ['עוד פעולות', 'פרטים מקצועיים']) {
      const summary = page.getByText(label);
      if (await summary.count()) {
        await summary.first().click();
        await page.waitForTimeout(250);
      }
    }
  },
  '/recipe/brioche/cook#steps': async (page) => {
    const gate = page.getByRole('button', { name: 'הכול מוכן — מתחילים בהכנה' });
    // Idempotent: a preparation that is already under way has no gate on
    // screen, and the steps are already there.
    if (!(await gate.count())) return;
    const boxes = page.locator('section[aria-label="הכנת חומרי גלם"] input[type="checkbox"]');
    const n = await boxes.count();
    for (let i = 0; i < n; i += 1) {
      if (!(await boxes.nth(i).isChecked())) await boxes.nth(i).click();
    }
    await gate.click();
    await page.waitForTimeout(400);
  },
};

/*
  Routes whose stored progress is wiped before every load.

  The walk's whole method is "one click, from the same start, every time", and
  §14 deliberately REMEMBERS where a preparation got to — on the device, in
  IndexedDB, which survives a reload by design. Without wiping it, clicking the
  gate once would put every later load of the cook route on the steps screen,
  and the ticks measured after that would be measured on a different screen.
  Clearing the store is test isolation, not a change to the product: the
  product's own "סיום ההכנה" does the same thing at the end of a bake.
*/
/*
  Wiped before EVERY load, not only before Cook Mode's.

  The walk's method is "one click, from a known start, every time", and more of
  the product writes to the device than Cook Mode does: choosing a measurement
  profile in הגדרות writes `prefs` through `offlineMirror`, and IndexedDB
  survives a reload by design. So a click early in a screen could change what
  the screen renders for every click after it — which is how this walk came to
  report the settings screen's "← עוד" link as dead: the link works (measured
  directly), but the control list had shifted under the index the walk had
  recorded. Clearing the store removes the drift at its source; clicking by
  identity rather than by index (below) removes the rest.
*/
const RESET_EVERY_LOAD = true;

const SCREENS = [
  '/notebook',
  '/home',
  '/paste',
  '/recipe/brioche',
  // the same route, walked again with both disclosure panels open
  '/recipe/brioche#panels',
  '/recipe/brioche/edit',
  '/recipe/new',
  '/recipe/brioche/cook',
  // the same route, walked again after the weighing stage has been cleared
  '/recipe/brioche/cook#steps',
  '/recipe/brioche/label',
  '/recipe/brioche/order',
  '/groups',
  '/group/group-course',
  '/group/group-team',
  '/group/group-team/perms',
  '/group/group-course/item/item-brioche',
  '/group/group-course/item/item-croissant',
  '/ingredients',
  '/plans',
  '/plan/fixture-plan-1',
  '/more',
  '/settings',
  '/tools',
  '/onboarding',
  '/join/fixture-token-open',
];

const only = process.argv[2];
const screens = only ? SCREENS.filter((s) => s === only) : SCREENS;

/*
  `select` is deliberately NOT here. Clicking a closed select changes nothing
  by design — you choose an option — so it produced eight false "dead"
  readings in the first run. Selects are checked separately below, where the
  real defect would be a picker with nothing to pick.
*/
const CLICKABLE =
  'button:not([disabled]), a[href], [role="tab"], input[type="checkbox"], input[type="radio"]';

const findings = [];
const rows = [];

const browser = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] });

try {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  /*
    The one cross-origin request on the page is the Google Fonts stylesheet,
    and this sandbox's egress terminates TLS with its own CA, so it fails here
    with ERR_CERT_AUTHORITY_INVALID — measured by logging `requestfailed`
    URLs: that URL, nothing else, and no uncaught error. Its console line
    carries no URL, so failures are classified by URL below and the bare
    "Failed to load resource" line is not counted. Anything else still is.
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
    r.request().url().startsWith('http://127.0.0.1:8135') ? r.continue() : r.abort(),
  );
  await page.addInitScript(() => {
    window.__route = null;
    window.addEventListener('message', (e) => {
      if (e.data?.source === 'recipe-notebook-viewer' && e.data.type === 'route') {
        window.__route = e.data.path;
      }
    });
  });

  const load = async (route) => {
    // `#steps` and friends are labels for a STATE of a route, not part of it.
    const url = route.split('#')[0];
    /*
      Only once the page is ON the served origin: `about:blank` has no origin
      and the IndexedDB API is denied there, which took down the first run of
      this — the wipe has to happen between two loads, not before the first.
    */
    if (RESET_EVERY_LOAD && page.url().startsWith('http://127.0.0.1')) {
      await page.evaluate(
        () =>
          new Promise((done) => {
            try {
              const req = indexedDB.deleteDatabase('keyval-store');
              req.onsuccess = () => done(null);
              req.onerror = () => done(null);
              req.onblocked = () => done(null);
            } catch {
              // A frame may refuse the API altogether; the product tolerates
              // that (offlineMirror's accessors all swallow it) and so does this.
              done(null);
            }
          }),
      );
    }
    /*
      A UNIQUE query string, so this is always a real document load.

      `goto` to the same page with a different hash is a SAME-DOCUMENT
      navigation: the app handles it, and if the screen it lands on redirects
      (resetting the opening questions sends you to /onboarding) the hash is
      rewritten before the reload — so the reload then boots at the redirected
      route, not the one asked for. That is how this walk came to enumerate
      /settings and click on /onboarding, and report a working back link as
      unclickable. A changing query makes every load a fresh document and the
      question "which screen is this" unambiguous.
    */
    await page.goto(`${BASE}?w=${Date.now()}#${url}`, { waitUntil: 'load' });
    await page.waitForTimeout(650);
    const prepare = PREPARE[route];
    if (prepare) await prepare(page);
  };

  /*
    The first run called 81 controls dead and almost all of them were mine, not
    the app's: a profile picker, a unit chip, a cup size — they select, and
    selecting changes `aria-pressed`, `aria-selected` or a class, not the text
    on screen. So the snapshot carries the interactive STATE of the document
    as well as its text.
  */
  const snapshot = () =>
    page.evaluate(() => {
      const state = [];
      document.querySelectorAll('*').forEach((el) => {
        const bits = [
          el.getAttribute('aria-pressed'),
          el.getAttribute('aria-selected'),
          el.getAttribute('aria-current'),
          el.getAttribute('aria-expanded'),
          el.getAttribute('class'),
          el instanceof HTMLInputElement ? String(el.checked) : null,
          el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : null,
          el instanceof HTMLSelectElement ? el.value : null,
          el instanceof HTMLButtonElement ? String(el.disabled) : null,
        ].filter((b) => b !== null && b !== '');
        if (bits.length) state.push(bits.join('|'));
      });
      return {
        route: window.__route,
        text: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
        state: state.join('#'),
        alerts: [...document.querySelectorAll('[role="alert"]')].map((n) => (n.textContent || '').trim()),
      };
    });

  for (const route of screens) {
    await load(route);
    const controls = await page.evaluate((sel) => {
      const out = [];
      document.querySelectorAll(sel).forEach((el, i) => {
        if (el.closest('.simBadge')) return;
        const r = el.getBoundingClientRect();
        out.push({
          i,
          tag: el.tagName,
          label:
            (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '')
              .replace(/\s+/g, ' ')
              .trim()
              .slice(0, 40) || `<${el.tagName.toLowerCase()}>`,
          visible: r.width > 0 && r.height > 0,
          href: el.getAttribute('href') || '',
        });
      });
      return out;
    }, CLICKABLE);

    const visible = controls.filter((c) => c.visible);

    /* The real defect for a picker: nothing to pick. */
    const emptySelects = await page.evaluate(() =>
      [...document.querySelectorAll('select')]
        .filter((s) => s.options.length <= 1)
        .map((s) => (s.getAttribute('aria-label') || s.id || '<select>').slice(0, 40)),
    );
    emptySelects.forEach((label) => {
      findings.push({ route, label, verdict: 'EMPTY-SELECT', alert: '' });
      rows.push({ route, label, tag: 'SELECT', href: '', verdict: 'EMPTY-SELECT', alert: '' });
      console.log(`   EMPTY-SELECT   ${label}`);
    });

    console.log(`\n── ${route} — ${visible.length} controls`);

    for (const c of visible.slice(0, 40)) {
      await load(route);
      const before = await snapshot();
      let clicked = true;
      try {
        /*
          Found again by WHAT IT IS — tag, label, href — and only then by its
          position as a tie-breaker. The index alone was a bug: it is taken
          from one render and used against another, and a screen that renders
          a different number of controls (a profile that hides the pro rows, a
          list that finished loading) silently moves every control after the
          change. The verdict then describes whatever element inherited the
          number.
        */
        clicked = await page.evaluate(
          ({ sel, want }) => {
            const list = [...document.querySelectorAll(sel)];
            // The same normalisation as the enumeration above, including the
            // 40-character truncation and the `<tag>` fallback for a control
            // with no text — a matcher that normalises differently finds
            // nothing and reports a working control as unclickable.
            const nameOf = (el) =>
              (el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 40) || `<${el.tagName.toLowerCase()}>`;
            const same = (el) =>
              Boolean(el) &&
              el.tagName === want.tag &&
              (el.getAttribute('href') ?? '') === want.href &&
              nameOf(el) === want.label;
            const el = list.find(same) ?? (same(list[want.i]) ? list[want.i] : null);
            if (!el) return false;
            (el instanceof HTMLElement ? el : null)?.click();
            return true;
          },
          { sel: CLICKABLE, want: { tag: c.tag, href: c.href ?? '', label: c.label, i: c.i } },
        );
      } catch (e) {
        clicked = false;
        if (process.env['WALK_DEBUG']) console.log('   threw:', String(e).slice(0, 120));
      }
      if (process.env['WALK_DEBUG'] && !clicked) {
        // What the screen looked like when the control could not be found —
        // this is what showed that the walk was on the wrong screen.
        const now = await page.evaluate(() => location.hash);
        console.log(
          '   not found:',
          JSON.stringify({ tag: c.tag, href: c.href, label: c.label, i: c.i }),
          'page at',
          now,
        );
      }
      await page.waitForTimeout(520);
      const after = await snapshot();

      const navigated = before.route !== after.route;
      const changed = before.text !== after.text || before.state !== after.state;
      const newAlert = after.alerts.find((a) => !before.alerts.includes(a));

      let verdict = 'ok';
      if (!clicked) verdict = 'not-clickable';
      else if (newAlert) verdict = 'alert';
      else if (navigated) verdict = 'nav';
      else if (changed) verdict = 'state';
      /* A link or tab that points at the screen you are already on is
         SUPPOSED to do nothing — the "מחברת" tab while standing in the
         notebook is not a dead button. */
      else if (c.href && (c.href === route.split('#')[0] || c.href === before.route))
        verdict = 'same-route';
      else verdict = 'DEAD';

      rows.push({ route, label: c.label, tag: c.tag, href: c.href, verdict, alert: newAlert ?? '' });
      if (verdict === 'DEAD' || verdict === 'alert' || verdict === 'not-clickable') {
        findings.push({ route, label: c.label, verdict, alert: newAlert ?? '' });
        console.log(`   ${verdict.padEnd(14)} ${c.label}${newAlert ? ` — ${newAlert.slice(0, 70)}` : ''}`);
      }
    }
  }

  fs.writeFileSync(path.join(OUT, 'walk.json'), JSON.stringify(rows, null, 2));
  console.log(
    `\nblocked font requests (this sandbox's TLS, not the page): ${fontsBlocked.length}`,
  );
  console.log(`page errors during the walk: ${errors.length}`);
  errors.slice(0, 5).forEach((e) => console.log(`  ${e}`));
  await ctx.close();
} finally {
  await browser.close();
  server.close();
}

const counts = rows.reduce((a, r) => ({ ...a, [r.verdict]: (a[r.verdict] ?? 0) + 1 }), {});
console.log('\n' + JSON.stringify(counts));
console.log(`${findings.length} findings across ${rows.length} controls · walk.json in ${OUT}`);
