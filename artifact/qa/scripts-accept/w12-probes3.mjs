import { launch, BASE, sleep } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const say = (l) => console.log(l);
const step = async (name, fn) => { try { await fn(); } catch (e) { say(`${name}: ERROR ${String(e).split('\n')[0].slice(0, 160)}`); } };
const { browser, page, errors, net } = await launch({ storageState: 'state-qa1.json' });
const body = async () => (await page.locator('body').innerText()).replace(/\s+/g, ' ').trim();
const go = async (u, sel = 'main', ms = 1800) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };
await step('P4 versions compare', async () => {
  await go(`/recipe/${id}`);
  await page.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).click(); await sleep(600);
  await page.getByRole('button', { name: /השוואת גרסה/ }).first().click(); await sleep(900);
  const b = await body(); const i = b.indexOf('השוואה'); say(`P4 compare: ${b.slice(i < 0 ? b.indexOf('גרסאות') : i, (i < 0 ? b.indexOf('גרסאות') : i) + 700)}`);
  await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-versions-compare.png', fullPage: true });
  await audit(page, 'versions-compare');
  await page.getByRole('button', { name: /צפייה בגרסה V1/ }).first().click().catch(() => {}); await sleep(900);
  const b2 = await body(); say(`P4 view V1: ${b2.slice(0, 400)}`); await audit(page, 'versions-view');
});
await step('P5 course/lesson', async () => {
  await go(`/group/${G}`, 'main', 4500);
  await page.getByRole('button', { name: 'הוספת קורס' }).click(); await sleep(800);
  let b = await body(); say(`P5 course empty submit → ${(b.match(/[^.]*(שם|חובה|ריק)[^.]*\./) || ['no message'])[0]}`);
  say('P5 inputs: ' + JSON.stringify(await page.locator('input, textarea').evaluateAll((els) => els.map((e) => `${e.type}|${e.placeholder}|${e.getAttribute('aria-label')}|${e.id}`))));
  await page.locator('input[type=text]').last().fill('בדיקה-QA קורס'); await page.getByRole('button', { name: 'הוספת קורס' }).click(); await sleep(3000);
  b = await body(); const ci = b.indexOf('בדיקה-QA קורס'); say(`P5 after course: ${ci < 0 ? 'NOT SHOWN: ' + b.slice(0, 300) : b.slice(ci, ci + 300)}`);
  await audit(page, 'group-with-course');
  say('P5 buttons now: ' + JSON.stringify(await page.locator('button, a, summary').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 40)).filter(Boolean))));
  const addLesson = page.getByRole('button', { name: /הוספת שיעור|שיעור חדש/ }).first();
  if (await addLesson.count()) {
    await addLesson.click(); await sleep(800); b = await body(); say(`P5 lesson empty submit → ${(b.match(/[^.]*(שם|חובה|ריק)[^.]*\./) || ['no message'])[0]}`);
    await page.locator('input[type=text]').last().fill('בדיקה-QA שיעור 1'); await addLesson.click(); await sleep(3000);
    b = await body(); const li = b.indexOf('בדיקה-QA שיעור'); say(`P5 after lesson: ${li < 0 ? 'NOT SHOWN' : b.slice(li, li + 400)}`);
    await audit(page, 'group-with-lesson');
    say('P5 buttons after lesson: ' + JSON.stringify(await page.locator('button, a, summary').evaluateAll((els) => els.map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 40)).filter(Boolean))));
  } else say('P5 no add-lesson button');
});
await step('P6 password validation', async () => {
  await go('/settings');
  await page.getByRole('button', { name: 'שינוי סיסמה' }).click(); await sleep(600);
  say('P6 form: ' + JSON.stringify(await page.locator('input, button').evaluateAll((els) => els.map((e) => `${e.tagName}:${e.type}|${e.placeholder || ''}|${e.getAttribute('aria-label') || ''}|${e.textContent.trim().slice(0, 30)}`).slice(-12))));
  await page.getByRole('button', { name: /עדכון הסיסמה|שמירת הסיסמה|עדכון/ }).first().click(); await sleep(1000); let b = await body(); say(`P6 empty submit: ${(b.match(/[^.]*(למלא|חובה|ריק|נדרש|קצר|תווים)[^.]*\./g) || ['no message']).join(' | ')}`);
  const pw = page.locator('input[type=password]'); const n = await pw.count(); say(`P6 password inputs: ${n}`);
  if (n >= 3) { await pw.nth(0).fill('wrong-current'); await pw.nth(1).fill('newpass123'); await pw.nth(2).fill('newpass124'); }
  else if (n === 2) { await pw.nth(0).fill('newpass123'); await pw.nth(1).fill('newpass124'); }
  await page.getByRole('button', { name: /עדכון הסיסמה|שמירת הסיסמה|עדכון/ }).first().click(); await sleep(1000); b = await body(); say(`P6 mismatch: ${(b.match(/[^.]*(תואמ|זהות|שונות)[^.]*\./g) || ['no message']).join(' | ')}`);
  await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-pw-mismatch.png' });
  if (n >= 3) { await pw.nth(2).fill('newpass123'); await page.getByRole('button', { name: /עדכון הסיסמה|שמירת הסיסמה|עדכון/ }).first().click(); await sleep(4000); b = await body(); say(`P6 wrong current: ${(b.match(/[^.]*(סיסמה[^.]*(נכונ|שגוי|נכשל)|נכשל)[^.]*\./g) || ['no message']).join(' | ')}`); await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-pw-wrong.png' }); }
});
await step('P11 student sees lessons', async () => {
  const ctx2 = await browser.newContext({ storageState: 'state-qa2.json', viewport: { width: 402, height: 874 }, locale: 'he-IL' }); const p2 = await ctx2.newPage();
  await p2.goto(BASE + `/group/${G}`); await p2.waitForSelector('main'); await sleep(5000);
  const b = (await p2.locator('body').innerText()).replace(/\s+/g, ' ');
  say(`P11 student group: ${b.slice(0, 500)}`);
  await p2.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-student-group.png', fullPage: true });
  await p2.getByRole('tab', { name: 'שיעורים' }).click().catch(() => {}); await sleep(800);
  say(`P11 student lessons tab: ${(await p2.locator('body').innerText()).replace(/\s+/g, ' ').slice(0, 400)}`);
  await ctx2.close();
});
say('ERRORS: ' + JSON.stringify(errors.filter((e) => !/ERR_FAILED|40[04]/.test(e)).slice(0, 6)));
say('NET: ' + JSON.stringify(net.filter((n) => n.s >= 400).map((n) => `${n.m} ${n.u.slice(0, 90)} ${n.s}`).slice(0, 8)));
await browser.close();
