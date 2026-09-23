// Phase B verification, part 2: #1 (loading / failure screens), #16 (email check), #6 (student view), #31 (verified banner), #39 (empty notebook).
import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
import path from 'node:path';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const ITEM = 'e3fca922-9c35-4a77-adf5-52f75749d5ec';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-after';
const R = [];
const ok = (n, pass, detail) => { R.push({ n, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} #${n} ${detail}`); };
const body = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();

// ── #1 loading and failure screens ──
const settle = async (p, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const b = await body(p); if (!/טוען את המחברת/.test(b) && b !== '') return { b, ms: Date.now() - t0 }; await sleep(250); } return { b: await body(p), ms }; };
{
  // A: slow network — the loading screen, never a blank page.
  const { browser, page } = await launch({ storageState: 'state-qa1.json' });
  await page.route('**/rest/v1/recipes?*', async (route) => { await sleep(4000); await route.continue(); });
  await page.goto(BASE + '/notebook'); await sleep(1500);
  let b = await body(page);
  ok('1a', /טוען את המחברת/.test(b), `while recipes load slowly (1.5 s): "${b.slice(0, 80)}"`);
  await page.screenshot({ path: path.join(OUT, '01a-loading.png') });
  await browser.close();
}
{
  // B: the recipes request fails on a device with nothing cached — the failure screen, then retry.
  const { browser, page } = await launch({ storageState: 'state-qa1.json' });
  await page.route('**/rest/v1/recipes?*', (route) => route.abort('failed'));
  await page.goto(BASE + '/notebook');
  let r = await settle(page);
  ok('1b', /המחברת לא נטענה/.test(r.b) && /ניסיון חוזר/.test(r.b) && !/איך נוח לכם לעבוד/.test(r.b), `recipes request fails (settled after ${r.ms} ms): "${r.b.slice(0, 140)}"`);
  await page.screenshot({ path: path.join(OUT, '01b-load-failed.png') });
  await page.unroute('**/rest/v1/recipes?*');
  await page.getByRole('button', { name: 'ניסיון חוזר' }).click({ timeout: 5000 }).catch(() => {});
  r = await settle(page);
  ok('1c', /בדיקה-QA בריוש/.test(r.b) && !/המחברת לא נטענה/.test(r.b), `after "ניסיון חוזר" (${r.ms} ms): notebook loaded = ${/בדיקה-QA בריוש/.test(r.b)}`);
  await page.screenshot({ path: path.join(OUT, '01c-retry-loaded.png') });
  await browser.close();
}
{
  // C: Supabase unreachable from the first request.
  const { browser, page } = await launch({ storageState: 'state-qa1.json' });
  await page.route('**/qxdpsomelzpvphkhkqrw.supabase.co/**', (route) => route.abort('failed'));
  await page.goto(BASE + '/notebook');
  const r = await settle(page, 25000);
  ok('1d', r.b !== '' && /המחברת לא נטענה|התחברו|רגע…/.test(r.b), `Supabase unreachable at start (settled after ${r.ms} ms): "${r.b.slice(0, 120)}"`);
  await page.screenshot({ path: path.join(OUT, '01d-unreachable.png') });
  await browser.close();
}

// ── #16 sign-in with a bad address: no request leaves the page ──
{
  const { browser, page } = await launch({});
  await page.goto(BASE + '/'); await page.waitForSelector('#auth-email'); await sleep(500);
  const auth = []; page.on('request', (r) => { if (/auth\/v1\/token/.test(r.url())) auth.push(r.url()); });
  await page.fill('#auth-email', 'not-an-email'); await page.fill('#auth-password', '123456'); await page.click('button[type=submit]'); await sleep(1500);
  const b = await body(page);
  ok('16', /כתובת האימייל אינה תקינה/.test(b) && auth.length === 0, `message: "${(b.match(/כתובת האימייל אינה תקינה[^.]*\./) || ['none'])[0]}"; token requests sent: ${auth.length}`);
  await page.screenshot({ path: path.join(OUT, '16-bad-email.png') });
  await browser.close();
}

// ── #6 student view (qa2) ──
{
  const { browser, page } = await launch({ storageState: 'state-qa2.json' });
  await page.goto(BASE + `/group/${G}/item/${ITEM}`); await waitMain(page); await sleep(4500);
  const b = await body(page);
  const rows = (b.match(/רכיבים (.*?) אלרגנים/) || ['', ''])[1];
  ok('6', /קמח לחם 500 גר'/.test(rows) && /ביצים 4 יח'/.test(rows) && !/\b(g|ml|tsp|unit)\b/.test(rows) && !/גר׳/.test(rows), `student rows: "${rows.slice(0, 200)}"`);
  await page.screenshot({ path: path.join(OUT, '06-student-recipe.png'), fullPage: true });
  await browser.close();
}

// ── #31 verified-link banner, #39 empty notebook (qa3) ──
{
  const { browser, page } = await launch({ storageState: 'state-qa3.json' });
  await page.goto(BASE + '/onboarding#type=signup'); await waitMain(page); await sleep(1500);
  let b = await body(page);
  ok('31', /כתובת האימייל אומתה/.test(b), `onboarding after a confirmation link: "${(b.match(/כתובת האימייל אומתה[^!]*!/) || ['no banner'])[0]}"`);
  await page.screenshot({ path: path.join(OUT, '31-verified-banner.png') });
  await page.goto(BASE + '/notebook'); await waitMain(page); await sleep(2000);
  b = await body(page);
  ok('39', /יצירת המתכון הראשון או הדבקת מתכון מטקסט/.test(b), `empty notebook: "${(b.match(/יצירת המתכון הראשון.{0,30}/) || ['?'])[0]}"`);
  await page.screenshot({ path: path.join(OUT, '39-empty-notebook.png') });
  await browser.close();
}

fs.writeFileSync('v02-results.json', JSON.stringify(R, null, 1));
console.log(`SUMMARY: ${R.filter((r) => r.pass).length}/${R.length} passed`);
