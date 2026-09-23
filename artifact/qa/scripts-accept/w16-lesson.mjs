import { launch, BASE, sleep } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
import fs from 'node:fs';
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const say = (l) => console.log(l);
const { browser, page, errors, net } = await launch({ storageState: 'state-qa1.json' });
const step = async (name, fn) => { try { await fn(); } catch (e) { say(`${name}: ERROR ${String(e).replace(/\s+/g, ' ').slice(0, 400)}`); await page.screenshot({ path: `/home/user/recipe-notebook/artifact/qa/shots-accept/probe-fail-${name.slice(0, 3)}.png` }).catch(() => {}); } };
const body = async (p = page) => (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();
const go = async (u, sel = 'main', ms = 1800) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };
const ctl = async (p = page) => JSON.stringify(await p.locator('button, a, summary, input, select, textarea, [role=tab]').evaluateAll((els) => els.map((e) => `${e.tagName.toLowerCase()}${e.type ? ':' + e.type : ''}=${(e.getAttribute('aria-label') || e.textContent || e.placeholder || '').trim().slice(0, 40)}${e.disabled ? '[disabled]' : ''}`)));
await step('P5 lesson', async () => {
  await go(`/group/${G}`, 'main', 5000);
  await page.getByRole('button', { name: 'שיעור חדש' }).first().click(); await sleep(600);
  await page.locator('input').first().fill('בדיקה-QA שיעור 1'); await page.getByRole('button', { name: 'הוספת השיעור' }).click(); await sleep(3500);
  const b = await body(); const li = b.indexOf('בדיקה-QA שיעור'); say(`P5 after lesson: ${li < 0 ? 'NOT SHOWN: ' + b.slice(0, 400) : b.slice(li, li + 400)}`);
  await audit(page, 'group-with-lesson'); say('P5 controls: ' + await ctl());
});
await step('P5 lesson screen + publish', async () => {
  const lessonLink = page.locator('a[href*="/lesson/"], a[href*="/course/"], button:has-text("בדיקה-QA שיעור"), a:has-text("בדיקה-QA שיעור")').first();
  say(`P5 lesson link count ${await lessonLink.count()}`);
  await lessonLink.click(); await sleep(3000); say(`P5 lesson screen ${page.url().replace(BASE, '')}: ${(await body()).slice(0, 700)}`); await audit(page, 'lesson-screen'); say('P5 lesson controls: ' + await ctl());
  const pub = page.getByRole('button', { name: /פרסום|שיתוף מתכון|הוספת מתכון|צירוף מתכון/ }).first();
  if (await pub.count()) { await pub.click(); await sleep(1200); say(`P5 publish dialog: ${(await body()).slice(0, 600)}`); await audit(page, 'lesson-publish'); say('P5 publish controls: ' + await ctl());
    const pick = page.locator('button:has-text("בריוש חמאה"), label:has-text("בריוש חמאה"), [role=option]:has-text("בריוש חמאה"), li:has-text("בריוש חמאה") button').first();
    if (await pick.count()) { await pick.click(); await sleep(600); const confirm = page.getByRole('button', { name: /^פרסום|^אישור|^שיתוף|^הוספה|^צירוף/ }).last(); if (await confirm.count()) await confirm.click().catch(() => {}); await sleep(3500); say(`P5 after publish: ${(await body()).slice(0, 600)}`); await audit(page, 'lesson-published'); say('P5 published controls: ' + await ctl()); }
    else say('P5 recipe picker not found');
  } else say('P5 no publish button');
});
await step('P11 student view', async () => {
  const ctx2 = await browser.newContext({ storageState: 'state-qa2.json', viewport: { width: 402, height: 874 }, locale: 'he-IL' }); const p2 = await ctx2.newPage();
  await p2.goto(BASE + `/group/${G}`); await p2.waitForSelector('main'); await sleep(5000);
  say(`P11 student group: ${(await body(p2)).slice(0, 500)}`); await audit(p2, 'student-group');
  const link = p2.locator('a[href*="/lesson/"], a[href*="/course/"], a[href*="/group-recipe/"], button:has-text("בדיקה-QA"), a:has-text("בדיקה-QA")').first();
  if (await link.count()) { await link.click(); await sleep(3000); say(`P11 student lesson ${p2.url().replace(BASE, '')}: ${(await body(p2)).slice(0, 500)}`); await audit(p2, 'student-lesson'); say('P11 controls: ' + await ctl(p2));
    const rl = p2.locator('a[href*="/group-recipe/"], a[href*="/shared/"], a:has-text("בריוש"), button:has-text("בריוש")').first();
    if (await rl.count()) { await rl.click(); await sleep(3500); say(`P11 student recipe ${p2.url().replace(BASE, '')}: ${(await body(p2)).slice(0, 900)}`); await audit(p2, 'student-recipe', { full: true }); say('P11 recipe controls: ' + await ctl(p2)); }
  } else say('P11 no lesson link for student');
  await ctx2.close();
});
say('ERRORS: ' + JSON.stringify(errors.filter((e) => !/ERR_FAILED|40[04]/.test(e)).slice(0, 6)));
say('NET: ' + JSON.stringify(net.filter((n) => n.s >= 400).map((n) => `${n.m} ${n.u.slice(0, 90)} ${n.s}`).slice(0, 8)));
await browser.close();
