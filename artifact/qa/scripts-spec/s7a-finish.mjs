import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s7';
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v ?? null).slice(0, 700)); };
const baseId = '650cfed5-4de2-4476-92d0-717874ba0fb9';
const parentId = 'd44e6ade-8658-4963-bc04-4781da0c5776';
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const go = async (u, sel = 'main', ms = 1800) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };

await go(`/recipe/${parentId}`);
const rowText = (await page.locator('main').innerText()).replace(/\s+/g, ' ');
say('parent.linkedRowNear', rowText.match(/[\s\S]{0,25}רוטב שוקולד[\s\S]{0,10}/)?.[0]);
await page.locator('summary').filter({ hasText: 'נתוני ייצור ועלויות' }).click(); await sleep(500);
const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
say('parent.fcSection', body.match(/פוד קוסט[\s\S]{0,200}/)?.[0]);
say('parent.yieldSection', body.match(/תשואה ופחת[\s\S]{0,200}/)?.[0]);
await page.screenshot({ path: OUT + '/1-subrecipe-parent-prodata.png', fullPage: true });

for (const [label, id] of [['parent', parentId], ['base', baseId]]) {
  await go(`/recipe/${id}`);
  await page.locator('button[aria-label="פעולות למתכון"]').click(); await sleep(300);
  await page.getByRole('menuitem', { name: 'מחיקה' }).click(); await sleep(400);
  await page.getByRole('button', { name: /^אישור מחיקת/ }).click(); await sleep(2500);
  say(`cleanup.${label}`, page.url());
}
fs.writeFileSync('s7a-finish.json', JSON.stringify(R, null, 1));
await browser.close();
