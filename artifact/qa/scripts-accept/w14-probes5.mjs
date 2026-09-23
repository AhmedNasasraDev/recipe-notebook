import { launch, BASE, sleep } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
import fs from 'node:fs';
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const VERIFY = fs.readFileSync('verify-link.txt', 'utf8').trim();
const say = (l) => console.log(l);
const { browser, page, errors, net } = await launch({ storageState: 'state-qa1.json' });
const step = async (name, fn) => { try { await fn(); } catch (e) { say(`${name}: ERROR ${String(e).replace(/\s+/g, ' ').slice(0, 500)}`); await page.screenshot({ path: `/home/user/recipe-notebook/artifact/qa/shots-accept/probe-fail-${name.slice(0, 3)}.png` }).catch(() => {}); } };
const body = async (p = page) => (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();
const go = async (u, sel = 'main', ms = 1800) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };
const ctl = async (p = page) => JSON.stringify(await p.locator('button, a, summary, input, [role=tab]').evaluateAll((els) => els.map((e) => `${e.tagName.toLowerCase()}${e.type ? ':' + e.type : ''}=${(e.getAttribute('aria-label') || e.textContent || e.placeholder || '').trim().slice(0, 40)}${e.disabled ? '[disabled]' : ''}`)));
await step('P5 course+lesson', async () => {
  await go(`/group/${G}`, 'main', 5000);
  await page.locator('input[type=text]').last().fill('בדיקה-QA קורס'); await page.getByRole('button', { name: 'הוספת קורס' }).click(); await sleep(3500);
  let b = await body(); const ci = b.indexOf('בדיקה-QA קורס'); say(`P5 after course: ${ci < 0 ? 'NOT SHOWN: ' + b.slice(0, 300) : b.slice(ci, ci + 300)}`);
  await audit(page, 'group-with-course'); say('P5 controls: ' + await ctl());
  const addLesson = page.getByRole('button', { name: /הוספת שיעור|שיעור חדש/ }).first();
  if (await addLesson.count()) {
    const inputs = page.locator('input[type=text]'); await inputs.last().fill('בדיקה-QA שיעור 1'); await addLesson.click(); await sleep(3500);
    b = await body(); const li = b.indexOf('בדיקה-QA שיעור'); say(`P5 after lesson: ${li < 0 ? 'NOT SHOWN: ' + b.slice(0, 400) : b.slice(li, li + 400)}`);
    await audit(page, 'group-with-lesson'); say('P5 controls after lesson: ' + await ctl());
    const lessonLink = page.locator('a[href*="/lesson/"], a[href*="/course/"]').first();
    if (await lessonLink.count()) { await lessonLink.click(); await sleep(3000); say(`P5 lesson screen ${page.url().replace(BASE, '')}: ${(await body()).slice(0, 500)}`); await audit(page, 'lesson-screen'); say('P5 lesson controls: ' + await ctl()); }
  } else say('P5 no add-lesson button');
});
await step('P6 password', async () => {
  await go('/settings');
  await page.getByRole('button', { name: 'שינוי סיסמה', exact: true }).click(); await sleep(600);
  const upd = page.getByRole('button', { name: 'עדכון הסיסמה', exact: true });
  const pw = page.locator('input[type=password]');
  say('P6 labels: ' + JSON.stringify(await page.locator('label').evaluateAll((els) => els.map((e) => e.textContent.trim().slice(0, 40)).filter((t) => /סיסמה/.test(t)))));
  await pw.nth(0).fill('wrong-current'); await pw.nth(1).fill('newpass123'); await pw.nth(2).fill('newpass124'); await sleep(200);
  say(`P6 update disabled with mismatch: ${await upd.isDisabled()}`);
  if (!(await upd.isDisabled())) { await upd.click(); await sleep(1200); const b = await body(); say(`P6 mismatch msg: ${(b.match(/[^.]*(תואמ|זהות|שונות|שוות)[^.]*\./g) || ['no message']).join(' | ')}`); }
  await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-pw-mismatch.png' });
  await pw.nth(2).fill('newpass123'); await sleep(200); say(`P6 update disabled with wrong current: ${await upd.isDisabled()}`);
  await upd.click(); await sleep(4500); const b = await body(); say(`P6 wrong current msg: ${(b.match(/[^.]*(סיסמה[^.]*(נכונ|שגוי|נכשל)|נכשל|שגוי)[^.]*\./g) || ['no message']).join(' | ')}`);
  await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-pw-wrong.png' });
  await pw.nth(1).fill('ab'); await pw.nth(2).fill('ab'); await sleep(200); say(`P6 short pw: disabled=${await upd.isDisabled()}`);
  if (!(await upd.isDisabled())) { await upd.click(); await sleep(1500); const b2 = await body(); say(`P6 short msg: ${(b2.match(/[^.]*(תווים|קצר)[^.]*\./g) || ['no message']).join(' | ')}`); }
});
await step('P12 qa3 verify link', async () => {
  const ctx3 = await browser.newContext({ viewport: { width: 402, height: 874 }, locale: 'he-IL' }); const p3 = await ctx3.newPage();
  const urls = []; p3.on('framenavigated', (f) => { if (f === p3.mainFrame()) urls.push(f.url().replace(/access_token=[^&]+/, 'access_token=…').replace(/refresh_token=[^&]+/, 'refresh_token=…').slice(0, 160)); });
  await p3.goto(VERIFY, { waitUntil: 'load' }).catch((e) => say('P12 goto err ' + String(e).slice(0, 120)));
  await sleep(4000);
  say('P12 nav chain: ' + JSON.stringify(urls));
  say(`P12 final url: ${p3.url().replace(/access_token=[^&]+/, 'access_token=…').replace(/refresh_token=[^&]+/, 'refresh_token=…').slice(0, 160)}`);
  say(`P12 screen: ${(await body(p3)).slice(0, 500)}`);
  await p3.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-qa3-after-verify.png' });
  await audit(p3, 'qa3-after-verify');
  // walk onboarding if shown
  for (let i = 0; i < 4; i++) { const nxt = p3.getByRole('button', { name: /המשך|הבא|התחלה|סיום|מתחילים/ }).first(); if (!(await nxt.count())) break; const b = await body(p3); say(`P12 onboarding ${i}: ${b.slice(0, 200)}`); const opt = p3.getByRole('button', { name: /ביתי|מקצועי|לימוד/ }).first(); if (await opt.count() && i === 0) await opt.click().catch(() => {}); await nxt.click(); await sleep(800); }
  say(`P12 after onboarding ${p3.url().replace(BASE, '')}: ${(await body(p3)).slice(0, 400)}`);
  await p3.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-qa3-home.png' });
  await p3.goto(BASE + '/recipes'); await p3.waitForSelector('main'); await sleep(2000); say(`P12 qa3 notebook: ${(await body(p3)).slice(0, 300)}`);
  await ctx3.storageState({ path: 'state-qa3.json' });
  await ctx3.close();
});
say('ERRORS: ' + JSON.stringify(errors.filter((e) => !/ERR_FAILED|40[04]/.test(e)).slice(0, 6)));
say('NET: ' + JSON.stringify(net.filter((n) => n.s >= 400).map((n) => `${n.m} ${n.u.slice(0, 90)} ${n.s}`).slice(0, 8)));
await browser.close();
