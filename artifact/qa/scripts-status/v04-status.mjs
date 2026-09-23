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
const deskCtx = await browser.newContext({ storageState: 'state-qa1.json', viewport: DESK, locale: 'he-IL' });
const desk = await deskCtx.newPage();
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
  await phone.locator('select[aria-label^="יחידה של"]').nth(1).selectOption({ label: "יח'" }).catch(async () => { await phone.locator('select').nth(1).selectOption({ label: "יח'" }); });
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

// ── B. sign out → sign in → data and photo still there (fresh context, phone) ──
await step('B-relogin', async () => {
  const ctx = await browser.newContext({ viewport: PHONE, locale: 'he-IL' }); const p = await ctx.newPage();
  await p.goto(BASE + '/'); await p.waitForSelector('#auth-email');
  await p.fill('#auth-email', creds('qa1').email); await p.fill('#auth-password', creds('qa1').password); await p.click('button[type=submit]');
  await p.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(800);
  await p.goto(BASE + `/recipe/${id}`); await waitMain(p); await p.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {}); await sleep(600);
  const photo = await p.evaluate(() => { const i = document.querySelector('img[aria-hidden="true"]'); return !!i && i.complete && i.naturalWidth > 0; });
  const b = await body(p);
  ok('B1 sign-in persistence', /בדיקה-QA בריוש חמאה קלאסי/.test(b) && photo, `brioche + photo after a fresh sign-in: recipe=${/בריוש חמאה/.test(b)} photo=${photo}`);
  await p.goto(BASE + '/settings'); await waitMain(p); await sleep(800);
  await p.getByRole('button', { name: 'התנתקות' }).click(); await sleep(2500);
  ok('B2 sign-out', /התחברו כדי לפתוח|כניסה למחברת/.test(await body(p)), 'sign-out lands on the sign-in screen');
  await p.fill('#auth-email', creds('qa1').email); await p.fill('#auth-password', 'wrong-password-1'); await p.click('button[type=submit]'); await sleep(3000);
  ok('B3 wrong password message', /האימייל או הסיסמה אינם נכונים/.test(await body(p)), (await body(p)).match(/האימייל או הסיסמה[^.]*\./)?.[0] ?? 'no message');
  await ctx.close();
});

// ── C. timers + refresh, fullscreen, print/PDF text, navigation ──
await step('C-cook', async () => {
  await go(phone, `/recipe/${id}/cook`, 'li label');
  await phone.getByRole('button', { name: /מעבר להכנה|מתחילים בהכנה/ }).click(); await sleep(500);
  await phone.getByRole('button', { name: /הפעלת טיימר/ }).first().click(); await sleep(1500);
  let b = await body(phone);
  const before = (b.match(/\d\d:\d\d/) || ['?'])[0];
  await phone.reload(); await waitMain(phone, 'main'); await sleep(2500);
  b = await body(phone);
  const after = (b.match(/\d\d:\d\d/) || ['?'])[0];
  ok('C1 timer survives refresh', /טיימר · שלב/.test(b) && after !== '?' && after !== '00:00', `before ${before} → after reload ${after}`);
  await phone.getByRole('button', { name: /^מסך מלא$/ }).click(); await sleep(600);
  const tops = await phone.evaluate(() => [...document.querySelectorAll('button, a')].filter((e) => /יציאה|חזרה לשקילה|הדפסה/.test(e.textContent + (e.getAttribute('aria-label') || ''))).map((e) => Math.round(e.getBoundingClientRect().top)));
  const big = await phone.evaluate(() => Math.max(...[...document.querySelectorAll('*')].filter((e) => /^\d\d:\d\d$/.test(e.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize))));
  ok('C2 fullscreen', Math.max(...tops) - Math.min(...tops) <= 6 && big >= 64, `head tops ${JSON.stringify(tops)}; timer digits ${big}px`);
  await shot(phone, 'C-fullscreen-timer');
  await phone.getByRole('button', { name: /יציאה ממסך מלא/ }).click(); await sleep(300);
  await phone.getByRole('button', { name: /^יציאה$/ }).click().catch(() => phone.getByRole('link', { name: /^יציאה$/ }).click()); await sleep(1200);
  ok('C3 exit cook → recipe', phone.url().includes(`/recipe/${id}`) && !phone.url().includes('/cook'), `url after exit: ${phone.url().replace(BASE, '')}`);
  await phone.getByRole('button', { name: 'המחברת' }).click().catch(() => phone.getByRole('link', { name: 'המחברת' }).click()); await sleep(1000);
  ok('C4 back to notebook', /\/notebook/.test(phone.url()), `url: ${phone.url().replace(BASE, '')}`);
  await go(phone, `/recipe/${id}/cook`, 'main'); await phone.getByRole('button', { name: 'סיום ההכנה' }).click().catch(() => {}); await sleep(500);
  await phone.locator('button:has-text("סיום"), button:has-text("כן")').last().click().catch(() => {}); await sleep(800);
});
await step('C-pdf', async () => {
  const pdfOf = async (u, name, sheet) => {
    await go(phone, u, 'body', 2500); await phone.waitForSelector('img[aria-hidden="true"]', { timeout: 8000 }).catch(() => {});
    await phone.emulateMedia({ media: 'print' });
    if (sheet) { await phone.evaluate(() => window.dispatchEvent(new Event('beforeprint'))); await sleep(700); }
    const pdf = await phone.pdf({ format: 'A4', printBackground: true, path: `${OUT}/${name}.pdf` });
    if (sheet) await phone.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await phone.emulateMedia({ media: 'screen' });
    const info = await parse(pdf); const t = info.text.replace(/\s+/g, ' ');
    return { pages: info.numpages, t };
  };
  const r = await pdfOf(`/recipe/${id}`, 'pdf-recipe', true);
  ok('C5 recipe PDF', r.pages >= 1 && /בריוש/.test(r.t) && /ביצים/.test(r.t) && !INTERNAL.test(r.t), `pages ${r.pages}; eggs line present ${/ביצים/.test(r.t)}; internal markers: ${(r.t.match(INTERNAL) || ['none'])[0]}`);
  const o = await pdfOf(`/recipe/${id}/order?mode=units&v=20`, 'pdf-order', false);
  ok('C6 order PDF', o.pages >= 1 && /114/.test(o.t) && !INTERNAL.test(o.t), `pages ${o.pages}; raw per-unit 114 present ${/114/.test(o.t)}; internal: ${(o.t.match(INTERNAL) || ['none'])[0]}`);
  const l = await pdfOf(`/recipe/${id}/label`, 'pdf-label', false);
  ok('C7 label PDF', l.pages >= 1 && /ביצים/.test(l.t) && /תמצית וניל/.test(l.t) && !INTERNAL.test(l.t), `pages ${l.pages}; eggs+vanilla declared; internal: ${(l.t.match(INTERNAL) || ['none'])[0]}`);
});

// ── D. isolation (qa2 cannot open qa1's recipe; sees only the shared item) ──
await step('D-isolation', async () => {
  const ctx = await browser.newContext({ storageState: 'state-qa2.json', viewport: PHONE, locale: 'he-IL' }); const p = await ctx.newPage();
  const codes = []; p.on('response', (r) => { if (/rest\/v1\/recipes\?/.test(r.url())) codes.push(r.status()); });
  await p.goto(BASE + `/recipe/${id}`); await waitMain(p); await sleep(3000);
  const b = await body(p);
  ok('D1 qa2 cannot open qa1 recipe by URL', !/בריוש חמאה קלאסי/.test(b) && /לא נמצא|אינו נטען|אין כזה/.test(b), `screen: ${b.slice(0, 100)}`);
  await p.goto(BASE + `/recipe/${id}/edit`); await waitMain(p); await sleep(2500);
  ok('D2 qa2 cannot edit it', !/בריוש חמאה קלאסי/.test(await body(p)), `editor for someone else's recipe shows: ${(await body(p)).slice(0, 80)}`);
  await p.goto(BASE + `/group/${G}/item/${ITEM}`); await waitMain(p); await sleep(4000);
  const s = await body(p);
  ok('D3 shared item visible with Hebrew units', /בריוש חמאה קלאסי/.test(s) && /ביצים 4 יח'/.test(s) && !/\b(g|unit|tsp)\b/.test(s), `student view ok`);
  await ctx.close();
});

// ── E. desktop 1440×900 pass: screens render, no tiny text, no internal markers ──
await step('E-desktop', async () => {
  const problems = [];
  for (const [u, sel, n] of [['/home', 'main', 'home'], ['/notebook', 'main', 'notebook'], [`/recipe/${id}`, 'main', 'recipe'], [`/recipe/${id}/edit`, 'main', 'edit'], [`/recipe/${id}/cook`, 'li label', 'cook'], [`/recipe/${id}/order?mode=units&v=20`, '#order-qty', 'order'], [`/recipe/${id}/label`, 'body', 'label'], ['/plans', 'main', 'plans'], ['/ingredients', 'main', 'ingredients'], ['/groups', 'main', 'groups'], [`/group/${G}`, 'main', 'group'], [`/group/${G}/perms`, 'main', 'perms'], ['/settings', 'main', 'settings'], ['/more', 'main', 'more']]) {
    await go(desk, u, sel, n === 'group' || n === 'perms' ? 4000 : 1500);
    if (n === 'recipe') { await desk.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).click().catch(() => {}); await sleep(500); }
    const s = await sweep(desk);
    const marker = s.text.match(INTERNAL);
    const overflow = await desk.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    if (s.tiny.length || marker || overflow) problems.push(`${n}: tiny=${JSON.stringify(s.tiny.slice(0, 3))} marker=${marker ? marker[0] : '-'} overflowX=${overflow}`);
    await shot(desk, `desk-${n}`, false);
  }
  ok('E1 desktop 1440×900', problems.length === 0, problems.length ? JSON.stringify(problems) : '14 screens: no text under 12px, no internal markers, no horizontal overflow');
});
await step('E-phone-sweep', async () => {
  const problems = [];
  for (const [u, sel, n] of [['/home', 'main', 'home'], ['/notebook', 'main', 'notebook'], [`/recipe/${id}`, 'main', 'recipe'], [`/recipe/${id}/cook`, 'li label', 'cook'], [`/recipe/${id}/order?mode=units&v=20`, '#order-qty', 'order'], [`/recipe/${id}/label`, 'body', 'label'], [`/group/${G}`, 'main', 'group'], ['/settings', 'main', 'settings']]) {
    await go(phone, u, sel, n === 'group' ? 4000 : 1500);
    if (n === 'recipe') { await phone.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).click().catch(() => {}); await sleep(500); }
    const s = await sweep(phone);
    const marker = s.text.match(INTERNAL);
    const overflow = await phone.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
    if (s.tiny.length || marker || overflow) problems.push(`${n}: tiny=${JSON.stringify(s.tiny.slice(0, 3))} marker=${marker ? marker[0] : '-'} overflowX=${overflow}`);
    await shot(phone, `phone-${n}`, false);
  }
  ok('E2 phone 402×874', problems.length === 0, problems.length ? JSON.stringify(problems) : '8 screens: no text under 12px, no internal markers, no horizontal overflow');
});

console.log('CONSOLE-ERRORS: ' + JSON.stringify(errors.filter((e) => !/ERR_FAILED|WebSocket|realtime/.test(e)).slice(0, 6)));
console.log('NET4xx: ' + JSON.stringify(net.filter((n) => n.s >= 400).map((n) => `${n.m} ${n.u.slice(0, 80)} ${n.s}`).slice(0, 10)));
fs.writeFileSync('v04-results.json', JSON.stringify(R, null, 1));
console.log(`SUMMARY: ${R.filter((r) => r.pass).length}/${R.length} passed`);
await browser.close();
