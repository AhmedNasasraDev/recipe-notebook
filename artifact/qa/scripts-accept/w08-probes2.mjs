import { launch, BASE, sleep, text, creds } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const say = (l) => console.log(l);
const step = async (name, fn) => { try { await fn(); } catch (e) { say(`${name}: ERROR ${String(e).split('\n')[0].slice(0, 140)}`); } };
const { browser, page, errors, net } = await launch({ storageState: 'state-qa1.json' });
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
const go = async (u, sel = 'main') => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(1800); };
await step('P2 delete failure', async () => {
  await go(`/recipe/${id}`);
  await page.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(400);
  await page.getByRole('button', { name: /^מחיקת בדיקה-QA/ }).click(); await sleep(500);
  await page.route('**/rest/v1/rpc/delete_recipe*', (route) => route.abort('failed'));
  await page.locator('button:has-text("כן, למחוק")').first().click(); await sleep(3000);
  const b = await body(); say(`P2 delete failed → ${/נכשל|אין חיבור/.test(b) ? 'message: ' + (b.match(/[^.]*(נכשל|אין חיבור)[^.]*\./) || [''])[0] : 'NO MESSAGE'} | dialog still open: ${/כן, למחוק/.test(b)} | url has recipe: ${page.url().includes(id)}`);
  await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-delete-failed.png' });
  await page.unroute('**/rest/v1/rpc/delete_recipe*');
});
await step('P3 convert + calibrate', async () => {
  await go(`/recipe/${id}`);
  await page.getByRole('button', { name: /קמח לחם/ }).first().click(); await sleep(700);
  const sheet = page.locator('[role=dialog]').first();
  say(`P3 convert sheet text: ${((await sheet.innerText().catch(() => 'NO DIALOG ROLE')) + '').replace(/\s+/g, ' ').slice(0, 500)}`);
  await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-convert-sheet.png' });
  const cal = page.getByRole('button', { name: /כיול|לכייל/ }).first();
  if (await cal.count()) { await cal.click(); await sleep(600); const calT = await page.locator('[role=dialog]').last().innerText().catch(async () => await body()); say(`P3 calibrate text: ${(calT + '').replace(/\s+/g, ' ').slice(0, 500)}`); await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-calibrate.png' }); }
  else say('P3 no calibrate button in the sheet');
});
await step('P4 versions', async () => {
  await go(`/recipe/${id}`);
  await page.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).click(); await sleep(600);
  await page.getByRole('button', { name: /השוואה/ }).first().click(); await sleep(700);
  let b = await body(); say(`P4 compare: ${b.slice(b.indexOf('גרסאות'), b.indexOf('גרסאות') + 600)}`);
  await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-versions-compare.png', fullPage: true });
});
await step('P5 course/lesson/publish + student view', async () => {
  await go(`/group/${G}`);
  await page.getByRole('button', { name: 'הוספת קורס' }).click(); await sleep(600);
  let b = await body(); say(`P5 course empty submit → ${(b.match(/[^.]*(שם|חובה|ריק)[^.]*\./) || ['no message'])[0]}`);
  await page.locator('input').first().fill('בדיקה-QA קורס'); await page.getByRole('button', { name: 'הוספת קורס' }).click(); await sleep(2500);
  b = await body(); say(`P5 after course: ${b.slice(b.indexOf('בדיקה-QA קורס'), b.indexOf('בדיקה-QA קורס') + 250)}`);
  await audit(page, 'group-with-course');
  const addLesson = page.getByRole('button', { name: /שיעור/ }).first();
  if (await addLesson.count()) { const li = page.locator('input').last(); await li.fill('בדיקה-QA שיעור 1').catch(() => {}); await addLesson.click(); await sleep(2500); b = await body(); say(`P5 after lesson: ${b.slice(b.indexOf('בדיקה-QA שיעור'), b.indexOf('בדיקה-QA שיעור') + 300)}`); }
  await audit(page, 'group-with-lesson');
  say('P5 buttons now: ' + JSON.stringify(await page.locator('button, a').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent).trim()).filter(Boolean).slice(0, 30))));
});
await step('P6 password validation', async () => {
  await go('/settings');
  await page.getByRole('button', { name: 'שינוי סיסמה' }).click(); await sleep(400);
  await page.getByRole('button', { name: 'עדכון הסיסמה' }).click(); await sleep(800); let b = await body(); say(`P6 empty submit: ${(b.match(/[^.]*(למלא|חובה|ריק|נדרש)[^.]*\./g) || ['no message']).join(' | ')}`);
  const pw = page.locator('input[type=password]'); await pw.nth(0).fill('wrong-current'); await pw.nth(1).fill('newpass123'); await pw.nth(2).fill('newpass124');
  await page.getByRole('button', { name: 'עדכון הסיסמה' }).click(); await sleep(800); b = await body(); say(`P6 mismatch: ${(b.match(/[^.]*(תואמ|זהות|שונות)[^.]*\./g) || ['no message']).join(' | ')}`);
  await pw.nth(2).fill('newpass123'); await page.getByRole('button', { name: 'עדכון הסיסמה' }).click(); await sleep(4000); b = await body(); say(`P6 wrong current: ${(b.match(/[^.]*(סיסמה[^.]*(נכונ|שגוי|נכשל)|נכשל)[^.]*\./g) || ['no message']).join(' | ')}`);
  await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-pw-wrong.png' });
});
await step('P9 unsaved guard on tab bar', async () => {
  await go(`/recipe/${id}/edit`); await page.locator('#r-name').fill('בדיקה-QA שינוי לא שמור');
  page.once('dialog', async (d) => { say(`P9 dialog: "${d.message()}"`); await d.dismiss(); });
  await page.click('nav[aria-label="ניווט ראשי"] a[href="/home"]'); await sleep(800);
  say(`P9 after dismiss still in editor: ${page.url().includes('/edit')}`);
});
await step('P10 finished timer', async () => {
  await go(`/recipe/${id}/cook`, 'li label'); await page.getByRole('button', { name: /מעבר להכנה|מתחילים בהכנה/ }).click(); await sleep(500);
  await page.getByRole('button', { name: 'טיימר אישי' }).click(); await page.fill('#own-timer', '1'); await page.getByRole('button', { name: 'הפעלה' }).click(); await sleep(62000);
  const b = await body(); say(`P10 finished: ${(b.match(/טיימר · שלב 1[^☐]{0,120}/) || [''])[0]}`);
  await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-timer-finished.png' });
  await page.getByRole('button', { name: /^מסך מלא$/ }).click(); await sleep(500); await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-timer-finished-fullscreen.png' });
});
// student view of a published recipe (if publish succeeded) + copy
await step('P11 student sees lessons', async () => {
  const ctx2 = await browser.newContext({ storageState: 'state-qa2.json', viewport: { width: 402, height: 874 }, locale: 'he-IL' }); const p2 = await ctx2.newPage();
  await p2.goto(BASE + `/group/${G}`); await p2.waitForSelector('main'); await sleep(2000);
  const b = (await p2.locator('body').innerText()).replace(/\s+/g, ' ');
  say(`P11 student group: ${b.slice(0, 300)}`);
  await p2.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-student-group.png', fullPage: true });
  await ctx2.close();
});
say('ERRORS: ' + JSON.stringify(errors.filter((e) => !/ERR_FAILED|40[04]/.test(e)).slice(0, 6)));
say('NET: ' + JSON.stringify(net.filter((n) => n.s >= 400).map((n) => `${n.m} ${n.u.slice(0, 70)} ${n.s}`).slice(0, 8)));
await browser.close();
