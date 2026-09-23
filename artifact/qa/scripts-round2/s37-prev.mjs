// Previous findings, re-verified on the real project: network failure + retry, double click,
// empty plan not created, isolation between the two accounts (UI and API).
import { launch, BASE, text, sleep, shot, check, results, creds } from './drv.mjs';
import { alerts } from './helpers.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const KEY = fs.readFileSync('/home/user/recipe-notebook/apps/web/.env.local', 'utf8').match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();
const SB = 'https://qxdpsomelzpvphkhkqrw.supabase.co';
const { browser, ctx, page, net, errors } = await launch({ storageState: 'state-qa1.json' });
page.on('dialog', async (d) => { await d.accept(); });

// ── network failure on save, then retry ──
await page.goto(`${BASE}/recipe/new`); await page.waitForSelector('#r-name', { timeout: 20000 });
await page.fill('#r-name', 'בדיקה-QA כשל רשת סבב 2');
await page.getByRole('button', { name: /המשך ל/ }).click(); await sleep(200);
await page.locator('input[aria-label^="שם הרכיב"]').nth(0).fill('סוכר'); await page.locator('input[aria-label^="כמות של"]').nth(0).fill('100');
await page.getByRole('button', { name: /המשך ל/ }).click(); await sleep(200);
await page.locator('[aria-label^="תיאור שלב"]').nth(0).fill('לערבב');
await page.getByRole('button', { name: /המשך ל/ }).click(); await sleep(200);
await page.route('**/rest/v1/rpc/save_recipe*', (route) => route.abort('failed'));
await page.getByRole('button', { name: 'שמירת המתכון' }).click(); await sleep(3000);
let al = await alerts(page);
check('R01', 'network failure: Hebrew message, stays in the editor, no English', page.url().endsWith('/recipe/new') && al.some((a) => /אין חיבור לשרת/.test(a)) && !al.some((a) => /Failed to fetch|TypeError/.test(a)), JSON.stringify(al));
await page.unroute('**/rest/v1/rpc/save_recipe*');
// double click on save
const saveBtn = page.getByRole('button', { name: 'שמירת המתכון' });
await saveBtn.dblclick(); await sleep(5000);
check('R02', 'retry saves and lands on the recipe', /\/recipe\/[0-9a-f-]{36}$/.test(page.url()), page.url());
const saves = net.filter((n) => n.u.includes('rpc/save_recipe') && n.s === 200).length;
await page.goto(`${BASE}/notebook`); await page.waitForSelector('main'); await sleep(2000);
let b = await text(page);
const count = (b.match(/בדיקה-QA כשל רשת סבב 2/g) || []).length;
check('R03', 'double click on save: exactly one recipe created', count === 1 && saves === 1, `rows=${count} successful save rpcs=${saves}`);

// ── plans: "+" creates no row ──
await page.goto(`${BASE}/plans`); await page.waitForSelector('main'); await sleep(2000);
const before = (await text(page)).match(/תוכנית/g)?.length ?? 0;
await page.getByRole('button', { name: 'תוכנית ייצור חדשה' }).click(); await sleep(1500);
check('R04', 'new plan opens at /plan/new without a server row', page.url().endsWith('/plan/new') && !net.some((n) => n.u.includes('save_production_plan')), page.url());
await page.goto(`${BASE}/plans`); await page.waitForSelector('main'); await sleep(2000);
b = await text(page);
check('R05', 'plans list unchanged after pressing "+" and leaving', /אין עדיין תוכניות ייצור/.test(b) || (b.match(/תוכנית/g)?.length ?? 0) === before, b.slice(0, 120));

// ── isolation: qa2 cannot see qa1's recipe (UI) ──
const ctx2 = await browser.newContext({ storageState: 'state-qa2.json', viewport: { width: 402, height: 874 }, locale: 'he-IL' });
const p2 = await ctx2.newPage();
await p2.goto(`${BASE}/recipe/${id}`); await p2.waitForSelector('main'); await sleep(2500);
const t2 = (await p2.locator('body').innerText()).replace(/\s+/g, ' ');
check('R06', "qa2 opening qa1's recipe URL sees 'not in your notebook'", /לא נמצא במחברת/.test(t2) && !/בריוש/.test(t2), t2.slice(0, 100));
// isolation: API with qa2's token
const tok2 = await p2.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('sb-') && k.endsWith('-auth-token')) return JSON.parse(localStorage.getItem(k)).access_token; return null; });
const r = await p2.evaluate(async ({ SB, KEY, tok, id }) => {
  const h = { apikey: KEY, Authorization: `Bearer ${tok}` };
  const a = await fetch(`${SB}/rest/v1/recipes?id=eq.${id}&select=id,name`, { headers: h }); const rows = await a.json();
  const b = await fetch(`${SB}/rest/v1/recipe_images?recipe_id=eq.${id}&select=id,storage_path`, { headers: h }); const imgs = await b.json();
  const c = await fetch(`${SB}/rest/v1/recipes?id=eq.${id}`, { method: 'PATCH', headers: { ...h, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify({ name: 'פריצה' }) }); const patched = await c.json();
  return { rows, imgs, patchStatus: c.status, patched };
}, { SB, KEY, tok: tok2, id });
check('R07', "API with qa2's token: 0 recipe rows, 0 image rows for qa1's recipe", Array.isArray(r.rows) && r.rows.length === 0 && Array.isArray(r.imgs) && r.imgs.length === 0, JSON.stringify(r).slice(0, 200));
check('R08', "API with qa2's token: PATCH on qa1's recipe changes nothing", r.patchStatus < 300 ? (Array.isArray(r.patched) && r.patched.length === 0) : true, `status ${r.patchStatus} rows ${JSON.stringify(r.patched).slice(0, 80)}`);
// signed url for qa1's image with qa2's token
const path = await page.evaluate(async ({ SB, KEY, id }) => { const k = Object.keys(localStorage).find((k) => k.startsWith('sb-') && k.endsWith('-auth-token')); const tok = JSON.parse(localStorage.getItem(k)).access_token; const a = await fetch(`${SB}/rest/v1/recipe_images?recipe_id=eq.${id}&select=storage_path`, { headers: { apikey: KEY, Authorization: `Bearer ${tok}` } }); return (await a.json())[0]?.storage_path; }, { SB, KEY, id });
const sign = await p2.evaluate(async ({ SB, KEY, tok, path }) => { const a = await fetch(`${SB}/storage/v1/object/sign/recipe-images/${path}`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) }); return { status: a.status, body: (await a.text()).slice(0, 80) }; }, { SB, KEY, tok: tok2, path });
check('R09', "storage: qa2 cannot sign qa1's image object", sign.status >= 400, JSON.stringify(sign));
await ctx2.close();
console.log('errors:', errors.filter((e) => !/40[034]/.test(e)).slice(0, 5));
console.log(JSON.stringify(results.filter(r => r.pass === false)));
await browser.close();
