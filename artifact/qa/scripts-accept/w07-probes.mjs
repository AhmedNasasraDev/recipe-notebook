// Focused probes for suspected findings.
import { launch, BASE, sleep, text, creds } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const out = []; const say = (l) => { out.push(l); console.log(l); };
const { browser, page, errors, net } = await launch({ storageState: 'state-qa1.json' });
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
// P1: what does the user see while recipes load slowly, and when the load fails, and when Supabase is unreachable at start?
await page.route('**/rest/v1/recipes?*', async (route) => { await sleep(4000); await route.continue(); });
await page.goto(BASE + '/notebook');
for (const ms of [500, 1500, 3000]) { await sleep(ms === 500 ? 500 : 1000); say(`P1 loading @${ms}ms: "${(await body()).slice(0, 120)}"`); }
await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-loading-1.5s.png' }).catch(() => {});
await sleep(4000); await page.unroute('**/rest/v1/recipes?*');
await page.route('**/rest/v1/recipes?*', (route) => route.abort('failed'));
await page.goto(BASE + '/notebook'); await sleep(4000); say(`P1 recipes failed: "${(await body()).slice(0, 200)}"`);
await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-load-failed.png' }).catch(() => {});
await page.unroute('**/rest/v1/recipes?*');
await page.route('**/qxdpsomelzpvphkhkqrw.supabase.co/**', (route) => route.abort('failed'));
await page.goto(BASE + '/notebook'); await sleep(5000); say(`P1 supabase unreachable at start: "${(await body()).slice(0, 200)}"`);
await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-unreachable.png' }).catch(() => {});
await page.unroute('**/qxdpsomelzpvphkhkqrw.supabase.co/**');
// P2: delete failure message
await page.goto(BASE + `/recipe/${id}`); await waitMain(page); await sleep(2000);
await page.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(400);
await page.getByRole('button', { name: /^מחיקת בדיקה-QA/ }).click(); await sleep(400);
await page.route('**/rest/v1/rpc/delete_recipe*', (route) => route.abort('failed'));
await page.waitForSelector('[role=alertdialog], [role=dialog]', { timeout: 8000 }).catch(() => {});
const yes = page.getByRole('button', { name: /כן, למחוק|^למחוק$|מחיקה סופית/ }).first();
say(`P2 dialog buttons: ${JSON.stringify(await page.locator('[role=alertdialog] button, [role=dialog] button').allInnerTexts().catch(() => []))}`);
if (await yes.count()) { await yes.click(); await sleep(3000); } else { say('P2 confirm button not found'); }
let b = await body(); say(`P2 delete failed → ${/נכשל|אין חיבור/.test(b) ? 'message: ' + (b.match(/[^.]*(נכשל|אין חיבור)[^.]*\./) || [''])[0] : 'NO MESSAGE'} | still on recipe: ${page.url().includes(id)}`);
await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-delete-failed.png' }).catch(() => {});
await page.unroute('**/rest/v1/rpc/delete_recipe*');
// P3: convert sheet + calibrate full text
await page.reload(); await waitMain(page); await sleep(2000);
await page.getByRole('button', { name: /קמח לחם/ }).first().click(); await sleep(700);
b = await body(); const ci = b.indexOf('המרה'); say(`P3 convert sheet: ${b.slice(Math.max(0, b.indexOf('מ"ל כוס') - 400), b.indexOf('מ"ל כוס') + 300)}`);
await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-convert-sheet.png' }).catch(() => {});
const cal = page.getByRole('button', { name: /כיול|לכייל/ }).first(); if (await cal.count()) { await cal.click(); await sleep(600); b = await body(); say(`P3 calibrate: ${b.slice(b.indexOf('כיול') - 50, b.indexOf('כיול') + 500)}`); await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-calibrate.png' }).catch(() => {}); }
// P4: versions compare text
await page.reload(); await waitMain(page); await sleep(2000);
await page.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).click(); await sleep(600);
await page.getByRole('button', { name: /השוואה/ }).first().click().catch(() => {}); await sleep(600);
b = await body(); say(`P4 compare: ${b.slice(b.indexOf('גרסאות'), b.indexOf('גרסאות') + 700)}`);
await page.getByRole('button', { name: /^צפייה$/ }).first().click().catch(() => {}); await sleep(600); b = await body(); say(`P4 view version: ${b.slice(b.indexOf('גרסאות'), b.indexOf('גרסאות') + 500)}`);
// P5: course form without a name
await page.goto(BASE + `/group/${G}`); await waitMain(page); await sleep(1500);
await page.getByRole('button', { name: 'הוספת קורס' }).click(); await sleep(600); b = await body(); say(`P5 course empty submit: ${b.slice(b.indexOf('קורס חדש') - 100, b.indexOf('קורס חדש') + 200)}`);
// P6: change-password validation (qa1)
await page.goto(BASE + '/settings'); await waitMain(page); await sleep(1500);
await page.getByRole('button', { name: 'שינוי סיסמה' }).click(); await sleep(400);
await page.getByRole('button', { name: 'עדכון הסיסמה' }).click(); await sleep(800); b = await body(); say(`P6 pw empty submit: ${b.slice(b.indexOf('הסיסמה הנוכחית'), b.indexOf('הסיסמה הנוכחית') + 300)}`);
const pw = page.locator('input[type=password]'); await pw.nth(0).fill('wrong-current'); await pw.nth(1).fill('newpass123'); await pw.nth(2).fill('newpass124');
await page.getByRole('button', { name: 'עדכון הסיסמה' }).click(); await sleep(800); b = await body(); say(`P6 pw mismatch: ${b.slice(b.indexOf('הסיסמה הנוכחית'), b.indexOf('הסיסמה הנוכחית') + 300)}`);
await pw.nth(2).fill('newpass123'); await page.getByRole('button', { name: 'עדכון הסיסמה' }).click(); await sleep(3500); b = await body(); say(`P6 pw wrong current: ${b.slice(b.indexOf('הסיסמה הנוכחית'), b.indexOf('הסיסמה הנוכחית') + 300)}`);
await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-pw-wrong.png' }).catch(() => {});
// P7: deep link while signed out → sign in → where do we land?
const ctx2 = await browser.newContext({ viewport: { width: 402, height: 874 }, locale: 'he-IL' }); const p2 = await ctx2.newPage();
await p2.goto(BASE + `/recipe/${id}`); await sleep(2000);
await p2.fill('#auth-email', creds('qa1').email); await p2.fill('#auth-password', creds('qa1').password); await p2.click('button[type=submit]'); await sleep(4000);
say(`P7 deep link after sign-in lands on: ${p2.url().replace(BASE, '')}`);
await ctx2.close();
// P8: sign-in with a bad email format → what message
const ctx3 = await browser.newContext({ viewport: { width: 402, height: 874 }, locale: 'he-IL' }); const p3 = await ctx3.newPage();
await p3.goto(BASE + '/'); await sleep(1500); await p3.fill('#auth-email', 'not-an-email'); await p3.fill('#auth-password', '123456'); await p3.click('button[type=submit]'); await sleep(3500);
say(`P8 bad email format → "${((await p3.locator('body').innerText()).match(/[^\n]*(אימייל|כתובת)[^\n]*/g) || []).slice(0, 3).join(' | ')}"`);
await ctx3.close();

console.log('ERRORS:', errors.filter((e) => !/ERR_FAILED|40[04]/.test(e)).slice(0, 6));
await browser.close();
