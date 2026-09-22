import { launch, BASE, sleep } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
import fs from 'node:fs';
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const ITEM = 'e3fca922-9c35-4a77-adf5-52f75749d5ec';
const say = (l) => console.log(l);
const { browser, page, errors, net } = await launch({ storageState: 'state-qa1.json' });
const step = async (name, fn) => { try { await fn(); } catch (e) { say(`${name}: ERROR ${String(e).replace(/\s+/g, ' ').slice(0, 400)}`); await page.screenshot({ path: `/home/user/recipe-notebook/artifact/qa/shots-accept/probe-fail-${name.slice(0, 3)}.png` }).catch(() => {}); } };
const body = async (p = page) => (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();
const go = async (u, sel = 'main', ms = 1800) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };
const ctl = async (p = page) => JSON.stringify(await p.locator('button, a, summary, input, select, [role=tab], [role=switch]').evaluateAll((els) => els.map((e) => `${e.tagName.toLowerCase()}${e.type ? ':' + e.type : ''}=${(e.getAttribute('aria-label') || e.textContent || e.placeholder || '').trim().slice(0, 50)}${e.disabled ? '[disabled]' : ''}${e.getAttribute('aria-checked') ? '[' + e.getAttribute('aria-checked') + ']' : ''}${e.checked ? '[checked]' : ''}`)));
await step('P13 perms allow save', async () => {
  await go(`/group/${G}/perms`, 'main', 4000);
  say(`P13 perms: ${(await body()).slice(0, 900)}`); say('P13 controls: ' + await ctl()); await audit(page, 'perms-full', { full: true });
  const save = page.locator('input[type=checkbox], [role=switch], button').filter({ hasText: /שמירה/ }).first();
  const cb = page.locator('label:has-text("שמירה") input, label:has-text("שמירה למחברת") input').first();
  say(`P13 save toggle: label-input=${await cb.count()} generic=${await save.count()}`);
  if (await cb.count()) await cb.click(); else if (await save.count()) await save.click();
  await sleep(3000); say(`P13 after toggle: ${(await body()).slice(0, 600)}`); await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-accept/probe-perms-save-on.png', fullPage: true });
});
await step('P13 student saves copy', async () => {
  const ctx2 = await browser.newContext({ storageState: 'state-qa2.json', viewport: { width: 402, height: 874 }, locale: 'he-IL' }); const p2 = await ctx2.newPage();
  await p2.goto(BASE + `/group/${G}/item/${ITEM}`); await p2.waitForSelector('main'); await sleep(4500);
  const b = await body(p2); say(`P13 student recipe perms text: ${b.slice(b.indexOf('מה מותר'), b.indexOf('מה מותר') + 500)}`); say('P13 student controls: ' + await ctl(p2));
  const save = p2.getByRole('button', { name: /שמירה|העתק|למחברת/ }).first();
  if (await save.count()) { await save.click(); await sleep(4500); say(`P13 after save ${p2.url().replace(BASE, '')}: ${(await body(p2)).slice(0, 500)}`); await audit(p2, 'student-saved-copy'); await save.click().catch(() => {}); await sleep(3000); say(`P13 second save click: ${(await body(p2)).slice(0, 300)}`); }
  else say('P13 no save button for student');
  await p2.goto(BASE + '/notebook'); await p2.waitForSelector('main'); await sleep(2500); say(`P13 qa2 notebook: ${(await body(p2)).slice(0, 400)}`); await audit(p2, 'student-notebook-after-copy');
  const link = p2.locator('a[href*="/recipe/"]').first(); if (await link.count()) { await link.click(); await sleep(3000); say(`P13 qa2 copy screen: ${(await body(p2)).slice(0, 600)}`); await audit(p2, 'student-copy-recipe', { full: true }); }
  await ctx2.close();
});
say('ERRORS: ' + JSON.stringify(errors.filter((e) => !/ERR_FAILED|40[04]/.test(e)).slice(0, 6)));
say('NET: ' + JSON.stringify(net.filter((n) => n.s >= 400).map((n) => `${n.m} ${n.u.slice(0, 90)} ${n.s}`).slice(0, 8)));
await browser.close();
