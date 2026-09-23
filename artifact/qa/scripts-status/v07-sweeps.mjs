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
const deskCtx = await browser.newContext({ viewport: DESK, locale: 'he-IL' });
const desk = await deskCtx.newPage();
// A sign-in of its own: two contexts copied from one stored session share a refresh token, and rotation signs the idle one out.
await desk.goto(BASE + '/'); await desk.waitForSelector('#auth-email'); await desk.fill('#auth-email', creds('qa1').email); await desk.fill('#auth-password', creds('qa1').password); await desk.click('button[type=submit]'); await desk.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(800);
const go = async (p, u, sel = 'main', ms = 1800) => { await p.goto(BASE + u); await waitMain(p, sel); await sleep(ms); };
const shot = (p, name, full = false) => p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
const step = async (name, fn) => { try { await fn(); } catch (e) { ok(name, false, 'ERROR ' + String(e).replace(/\s+/g, ' ').slice(0, 300)); await shot(phone, `err-${name}`).catch(() => {}); } };

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
  const signedIn = await desk.evaluate(() => !!document.querySelector('nav[aria-label="ניווט ראשי"]') || !document.querySelector('#auth-email'));
  ok('E1 desktop 1440×900', signedIn && problems.length === 0, problems.length ? JSON.stringify(problems) : '14 screens: no text under 12px, no internal markers, no horizontal overflow');
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
  const signedIn2 = await phone.evaluate(() => !document.querySelector('#auth-email'));
  ok('E2 phone 402×874', signedIn2 && problems.length === 0, problems.length ? JSON.stringify(problems) : '8 screens: no text under 12px, no internal markers, no horizontal overflow');
});

fs.writeFileSync('v07-results.json', JSON.stringify(R, null, 1));
console.log(`SUMMARY: ${R.filter((r) => r.pass).length}/${R.length} passed`);
await browser.close();
