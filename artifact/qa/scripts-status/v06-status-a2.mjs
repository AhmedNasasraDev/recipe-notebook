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

const newId = '31c214d8-8b13-43f4-9eaf-5d2d7aa26c38'; const copyId = '3d6ed870-efbf-4fad-8434-595bef8848fe';
const heroLoaded = async () => { for (let i = 0; i < 40; i++) { const r = await phone.evaluate(() => { const i = document.querySelector('img[aria-hidden="true"]'); return i ? (i.complete && i.naturalWidth > 0 ? 'loaded' : 'pending') : 'none'; }); if (r === 'loaded') return true; if (r === 'none' && i > 8) return false; await sleep(250); } return false; };
await step('A7-again', async () => {
  await go(phone, `/recipe/${newId}`);
  const had = await heroLoaded();
  if (!had) { await phone.locator('input[type=file]').last().setInputFiles('qa-photo-1.png'); await sleep(7000); }
  await phone.reload(); await waitMain(phone); const l1 = await heroLoaded();
  ok('A7 upload + reload (polled up to 10 s)', l1, `hero loaded after reload: ${l1}`);
  await shot(phone, 'A-image-uploaded');
  // fresh sign-in context, same recipe: the photo is really stored, not cached
  const ctx = await browser.newContext({ viewport: PHONE, locale: 'he-IL' }); const p = await ctx.newPage();
  await p.goto(BASE + '/'); await p.waitForSelector('#auth-email'); await p.fill('#auth-email', creds('qa1').email); await p.fill('#auth-password', creds('qa1').password); await p.click('button[type=submit]'); await p.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 });
  await p.goto(BASE + `/recipe/${newId}`); await waitMain(p); let l2 = false; for (let i = 0; i < 40 && !l2; i++) { l2 = await p.evaluate(() => { const i = document.querySelector('img[aria-hidden="true"]'); return !!i && i.complete && i.naturalWidth > 0; }); await sleep(250); }
  ok('A7b photo after fresh sign-in', l2, `hero loaded in a new signed-in session: ${l2}`);
  await ctx.close();
});
await step('A10-refused-delete', async () => {
  await go(phone, `/recipe/${newId}`); await heroLoaded();
  await phone.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(300);
  await phone.getByRole('button', { name: /^מחיקת בדיקה-QA/ }).first().click(); await sleep(400);
  const removed = []; phone.on('request', (r) => { if (/storage\/v1\/object/.test(r.url()) && r.method() === 'DELETE') removed.push(1); });
  await phone.route('**/rest/v1/rpc/delete_recipe*', (route) => route.abort('failed'));
  await phone.locator('button:has-text("כן, למחוק")').first().click(); await sleep(3000);
  const b = await body(phone); await phone.unroute('**/rest/v1/rpc/delete_recipe*');
  await phone.reload(); await waitMain(phone); const still = await heroLoaded();
  ok('A10 refused delete keeps photo', /מחיקת המתכון נכשלה/.test(b) && removed.length === 0 && still, `message=${/מחיקת המתכון נכשלה/.test(b)} storageDeletes=${removed.length} photoAfterReload=${still}`);
  await shot(phone, 'A-refused-delete');
});
await step('A11-real-delete', async () => {
  // Deletes ONLY the two recipes this status run created (בדיקה-QA סטטוס …). Nothing else.
  for (const rid of [newId, copyId]) {
    await go(phone, `/recipe/${rid}`);
    await phone.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(300);
    await phone.getByRole('button', { name: /^מחיקת בדיקה-QA/ }).first().click(); await sleep(400);
    await phone.locator('button:has-text("כן, למחוק")').first().click(); await sleep(3500);
  }
  await go(phone, `/recipe/${newId}`);
  const b = await body(phone);
  ok('A11 real delete', /לא נמצא/.test(b), `after delete: ${b.slice(0, 80)}`);
  await go(phone, '/notebook?q=' + encodeURIComponent('בדיקה-QA סטטוס'));
  ok('A12 gone from notebook', (await phone.locator('a[href^="/recipe/"]').filter({ hasText: 'בדיקה-QA סטטוס' }).count()) === 0, 'no בדיקה-QA סטטוס entries left');
});

console.log('NET4xx: ' + JSON.stringify(net.filter((n) => n.s >= 400).map((n) => `${n.m} ${n.u.slice(0, 80)} ${n.s}`).slice(0, 10)));
fs.writeFileSync('v05-results.json', JSON.stringify(R, null, 1));
console.log(`SUMMARY: ${R.filter((r) => r.pass).length}/${R.length} passed`);
await browser.close();
