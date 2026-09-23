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
await step('P5 publish recipe to lesson', async () => {
  await go(`/group/${G}`, 'main', 5000);
  await page.getByRole('button', { name: 'הוספת מתכון מהמחברת' }).first().click(); await sleep(1500);
  say(`P5 picker: ${(await body()).slice(0, 700)}`); await audit(page, 'lesson-publish'); say('P5 picker controls: ' + await ctl());
  await page.locator('select').first().selectOption({ label: 'בדיקה-QA בריוש חמאה קלאסי' }); await sleep(500);
  say('P5 after pick controls: ' + await ctl());
  const confirm = page.getByRole('button', { name: 'הוספה לשיעור' }).first();
  if (await confirm.count()) { await confirm.click().catch(() => {}); await sleep(3500); }
  say(`P5 after publish: ${(await body()).slice(0, 700)}`); await audit(page, 'lesson-published'); say('P5 published controls: ' + await ctl());
  await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-lesson-published.png', fullPage: true });
});
await step('P11 student view', async () => {
  const ctx2 = await browser.newContext({ storageState: 'state-qa2.json', viewport: { width: 402, height: 874 }, locale: 'he-IL' }); const p2 = await ctx2.newPage();
  await p2.goto(BASE + `/group/${G}`); await p2.waitForSelector('main'); await sleep(5000);
  say(`P11 student group: ${(await body(p2)).slice(0, 600)}`); await audit(p2, 'student-group');
  const rl = p2.locator('a[href*="/group"], a:has-text("בריוש"), button:has-text("בריוש")').filter({ hasText: 'בריוש' }).first();
  say(`P11 recipe link count ${await rl.count()} href=${await rl.getAttribute('href').catch(() => '')}`);
  if (await rl.count()) { await rl.click(); await sleep(4000); say(`P11 student recipe ${p2.url().replace(BASE, '')}: ${(await body(p2)).slice(0, 1200)}`); await audit(p2, 'student-recipe', { full: true }); say('P11 recipe controls: ' + await ctl(p2));
    const save = p2.getByRole('button', { name: /שמירה למחברת|העתק|שמירת עותק|למחברת שלי/ }).first();
    if (await save.count()) { await save.click(); await sleep(4000); say(`P11 after save ${p2.url().replace(BASE, '')}: ${(await body(p2)).slice(0, 500)}`); await audit(p2, 'student-saved-copy'); }
    else say('P11 no save-copy button');
    await p2.goto(BASE + '/notebook'); await p2.waitForSelector('main'); await sleep(2500); say(`P11 qa2 notebook: ${(await body(p2)).slice(0, 400)}`);
  }
  await ctx2.close();
});
say('ERRORS: ' + JSON.stringify(errors.filter((e) => !/ERR_FAILED|40[04]/.test(e)).slice(0, 6)));
say('NET: ' + JSON.stringify(net.filter((n) => n.s >= 400).map((n) => `${n.m} ${n.u.slice(0, 90)} ${n.s}`).slice(0, 8)));
await browser.close();
