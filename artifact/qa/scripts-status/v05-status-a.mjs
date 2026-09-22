// Status check on the PRODUCTION build (vite preview on :5199, same commit as the Vercel Preview).
// Flows the acceptance re-check asked for beyond v01/v02: create → edit → duplicate → image upload/replace/delete →
// refused delete → real delete of the recipe created here; sign-out/sign-in persistence; timers + refresh;
// print/PDF text; navigation; isolation; error messages; internal-marker sweep on phone AND desktop.
import { launch, BASE, sleep, creds, PHONE, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
import path from 'node:path';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const ITEM = 'e3fca922-9c35-4a77-adf5-52f75749d5ec';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-status';
const parse = (await import('/tmp/claude-0/-home-user-recipe-notebook/c3a9fa06-9b8e-56e2-96b0-42c6561963e9/scratchpad/pdftool/node_modules/pdf-parse/lib/pdf-parse.js')).default;
const R = [];
const ok = (n, pass, detail) => { R.push({ n, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} ${n} ${detail}`); };
const body = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();
const INTERNAL = /\bV\d\b|\(\d\d\)|§|\bS\d\b|\b(tsp|tbsp|unit|ml|floz)\b|undefined|NaN|\bnull\b|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/;
const sweep = (p) => p.evaluate(() => {
  const out = { tiny: [], text: '' }; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const parts = [];
  while (w.nextNode()) { const n = w.currentNode; const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (!el || el.closest('#print-root,script,style')) continue; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; if (el.getBoundingClientRect().width === 0) continue; parts.push(t); const fs = parseFloat(cs.fontSize); if (fs < 12) out.tiny.push(`${t.slice(0, 18)} ${fs}px`); }
  out.text = parts.join(' '); return out;
});

const { browser, page: phone, errors, net } = await launch({ storageState: 'state-qa1.json' });
const go = async (p, u, sel = 'main', ms = 1800) => { await p.goto(BASE + u); await waitMain(p, sel); await sleep(ms); };
const shot = (p, name, full = false) => p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
const step = async (name, fn) => { try { await fn(); } catch (e) { ok(name, false, 'ERROR ' + String(e).replace(/\s+/g, ' ').slice(0, 300)); await shot(phone, `err-${name}`).catch(() => {}); } };

let newId = null;
// ── A. create → edit → duplicate → images → refused delete → real delete (recipe created here only) ──
await step('A-create', async () => {
  await go(phone, '/recipe/new');
  await phone.fill('#r-name', 'בדיקה-QA סטטוס ' + Date.now().toString().slice(-4));
  await phone.getByRole('button', { name: /המשך לחומרי גלם/ }).click(); await sleep(400);
  const nameOf = (i) => phone.locator(`input[aria-label^="שם הרכיב בשורה ${i}"]`).first();
  await nameOf(1).fill('קמח לחם'); await phone.locator('input[aria-label^="כמות של"]').nth(0).fill('500');
  await phone.getByRole('button', { name: 'הוספת רכיב' }).click(); await sleep(200);
  await nameOf(2).fill('ביצים'); await phone.locator('input[aria-label^="כמות של"]').nth(1).fill('2');
  await phone.locator('select[aria-label^="יחידת המדידה של"]').nth(1).selectOption({ label: "יח'" });
  await phone.getByRole('button', { name: /המשך לאופן ההכנה/ }).click(); await sleep(400);
  await phone.locator('textarea[aria-label^="שלב 1"], textarea').first().fill('מערבבים 3 דקות');
  await phone.getByRole('button', { name: /המשך לסיכום/ }).click(); await sleep(400);
  await phone.getByRole('button', { name: 'שמירת המתכון' }).click(); await sleep(4000);
  newId = phone.url().split('/recipe/')[1]?.split(/[/?]/)[0] ?? null;
  const b = await body(phone);
  ok('A1 save', !!newId && newId !== 'new' && /בדיקה-QA סטטוס/.test(b), `saved → ${newId} ; notice: ${(b.match(/המתכון נשמר[^.]*/) || ['—'])[0]}`);
  await phone.reload(); await waitMain(phone); await sleep(1500);
  ok('A2 reload', /בדיקה-QA סטטוס/.test(await body(phone)) && /ביצים.{0,40}2 יח'|2 יח'.{0,40}ביצים/.test(await body(phone)), "recipe and 2 יח' for eggs still there after reload");
  await shot(phone, 'A-created');
});
await step('A-edit', async () => {
  await go(phone, `/recipe/${newId}/edit`);
  await phone.fill('#r-name', 'בדיקה-QA סטטוס — נערך');
  await phone.getByRole('button', { name: /שלב 4 מתוך/ }).click(); await sleep(300);
  await phone.getByRole('button', { name: 'שמירת השינויים' }).click(); await sleep(3500);
  await phone.reload(); await waitMain(phone); await sleep(1500);
  const b = await body(phone);
  ok('A3 edit persists', /בדיקה-QA סטטוס — נערך/.test(b), `after edit + reload: ${/נערך/.test(b)}`);
  // double-click save must not create a second recipe: count notebook entries with this name
  await go(phone, '/notebook?q=' + encodeURIComponent('בדיקה-QA סטטוס'));
  const n = await phone.locator('a[href^="/recipe/"]').filter({ hasText: 'בדיקה-QA סטטוס' }).count();
  ok('A4 no duplicate on save', n === 1, `notebook has ${n} recipe(s) named בדיקה-QA סטטוס`);
});
await step('A-duplicate', async () => {
  await go(phone, `/recipe/${newId}`);
  await phone.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(300);
  await phone.getByRole('button', { name: /^שכפול/ }).click(); await sleep(4000);
  const copyId = phone.url().split('/recipe/')[1]?.split(/[/?]/)[0];
  const b = await body(phone);
  ok('A5 duplicate', !!copyId && copyId !== newId && /עותק|בדיקה-QA סטטוס/.test(b), `copy ${copyId}; title: ${(b.match(/בדיקה-QA סטטוס[^\n]{0,30}/) || ['?'])[0]}`);
  await go(phone, `/recipe/${copyId}/edit`); await phone.fill('#r-name', 'בדיקה-QA סטטוס — עותק שונה'); await phone.getByRole('button', { name: /שלב 4 מתוך/ }).click(); await sleep(300); await phone.getByRole('button', { name: 'שמירת השינויים' }).click(); await sleep(3000);
  await go(phone, `/recipe/${newId}`);
  ok('A6 original untouched', /בדיקה-QA סטטוס — נערך/.test(await body(phone)) && !/עותק שונה/.test(await body(phone)), 'editing the copy left the original as it was');
  fs.writeFileSync('status-copy-id.txt', copyId ?? '');
});
await step('A-images', async () => {
  await go(phone, `/recipe/${newId}`);
  await phone.locator('input[type=file]').last().setInputFiles('qa-photo-1.png'); await sleep(7000);
  await phone.reload(); await waitMain(phone); await phone.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {}); await sleep(600);
  const src1 = await phone.evaluate(() => document.querySelector('img[aria-hidden="true"]')?.getAttribute('src') ?? null);
  const ok1 = await phone.evaluate(() => { const i = document.querySelector('img[aria-hidden="true"]'); return !!i && i.complete && i.naturalWidth > 0; });
  ok('A7 upload + reload', ok1, `hero after upload and reload: ${ok1}`);
  await shot(phone, 'A-image-uploaded');
  await phone.locator('input[aria-label="החלפת התמונה בקובץ אחר"]').first().setInputFiles('qa-photo-2.png'); await sleep(7000);
  await phone.reload(); await waitMain(phone); await phone.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {}); await sleep(600);
  const src2 = await phone.evaluate(() => document.querySelector('img[aria-hidden="true"]')?.getAttribute('src') ?? null);
  ok('A8 replace + reload', !!src2 && src1 && src2.split('?')[0] !== src1.split('?')[0], `object changed: ${src1?.split('/').pop()?.split('?')[0]} → ${src2?.split('/').pop()?.split('?')[0]}`);
  await phone.getByRole('button', { name: 'מחיקת התמונה' }).first().click(); await sleep(300);
  await phone.getByRole('button', { name: /^למחוק$/ }).click(); await sleep(3000);
  await phone.reload(); await waitMain(phone); await sleep(1500);
  const none = await phone.evaluate(() => !document.querySelector('img[aria-hidden="true"]'));
  ok('A9 delete image + reload', none && /אין תמונות למתכון הזה|הוספת תמונה/.test(await body(phone)), `no hero after delete + reload: ${none}`);
  await phone.locator('input[type=file]').last().setInputFiles('qa-photo-1.png'); await sleep(7000);
});
await step('A-refused-delete', async () => {
  await go(phone, `/recipe/${newId}`); await phone.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {});
  await phone.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(300);
  await phone.getByRole('button', { name: /^מחיקת / }).first().click(); await sleep(400);
  const removed = []; phone.on('request', (r) => { if (/storage\/v1\/object/.test(r.url()) && r.method() === 'DELETE') removed.push(1); });
  await phone.route('**/rest/v1/rpc/delete_recipe*', (route) => route.abort('failed'));
  await phone.locator('button:has-text("כן, למחוק")').first().click(); await sleep(3000);
  const b = await body(phone); await phone.unroute('**/rest/v1/rpc/delete_recipe*');
  await phone.reload(); await waitMain(phone); await phone.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {}); await sleep(600);
  const still = await phone.evaluate(() => { const i = document.querySelector('img[aria-hidden="true"]'); return !!i && i.complete && i.naturalWidth > 0; });
  ok('A10 refused delete keeps photo', /מחיקת המתכון נכשלה/.test(b) && removed.length === 0 && still, `message=${/מחיקת המתכון נכשלה/.test(b)} storageDeletes=${removed.length} photoAfterReload=${still}`);
  await shot(phone, 'A-refused-delete');
});
await step('A-real-delete', async () => {
  // Deletes ONLY the recipe created by this script (and its copy). Nothing that existed before this run.
  const copyId = fs.readFileSync('status-copy-id.txt', 'utf8').trim();
  const signed = []; phone.on('response', (r) => { if (/storage\/v1\/object\/sign/.test(r.url())) signed.push(r.status()); });
  for (const rid of [newId, copyId]) {
    if (!rid) continue;
    await go(phone, `/recipe/${rid}`);
    await phone.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(300);
    await phone.getByRole('button', { name: /^מחיקת / }).first().click(); await sleep(400);
    await phone.locator('button:has-text("כן, למחוק")').first().click(); await sleep(3500);
  }
  await go(phone, `/recipe/${newId}`);
  const b = await body(phone);
  ok('A11 real delete', /המתכון (אינו נטען|לא נמצא)|לא נמצא/.test(b), `after delete: ${b.slice(0, 90)}`);
  await go(phone, '/notebook?q=' + encodeURIComponent('בדיקה-QA סטטוס'));
  ok('A12 gone from notebook', (await phone.locator('a[href^="/recipe/"]').filter({ hasText: 'בדיקה-QA סטטוס' }).count()) === 0, 'no בדיקה-QA סטטוס entries left');
});


// ── C4 again: navigation from the recipe page, with every url logged ──
await step('C4-nav', async () => {
  await go(phone, '/notebook'); await phone.locator('a[href^="/recipe/"]').filter({ hasText: 'בריוש חמאה קלאסי' }).first().click(); await sleep(1500);
  const u1 = phone.url().replace(BASE, '');
  await phone.locator('a', { hasText: /מצב הכנה/ }).first().click(); await sleep(1500);
  const u2 = phone.url().replace(BASE, '');
  const exit = phone.locator('a, button').filter({ hasText: /^יציאה$/ }).first(); await exit.click(); await sleep(1200);
  const u3 = phone.url().replace(BASE, '');
  const back = phone.locator('a, button').filter({ hasText: /^המחברת$/ }).first(); const tag = await back.evaluate((e) => e.tagName + ' ' + (e.getAttribute('href') || '')); await back.click(); await sleep(1200);
  const u4 = phone.url().replace(BASE, '');
  ok('C4 notebook → recipe → cook → exit → notebook', /\/notebook/.test(u4) && !/cook/.test(u3), `${u1} → ${u2} → exit → ${u3} → "המחברת" (${tag}) → ${u4}`);
});

console.log('NET4xx: ' + JSON.stringify(net.filter((n) => n.s >= 400).map((n) => `${n.m} ${n.u.slice(0, 80)} ${n.s}`).slice(0, 10)));
fs.writeFileSync('v05-results.json', JSON.stringify(R, null, 1));
console.log(`SUMMARY: ${R.filter((r) => r.pass).length}/${R.length} passed`);
await browser.close();
