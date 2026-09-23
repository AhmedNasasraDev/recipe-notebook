// Spec stage 7 (§9.3): "הגדלה לפי רכיב מגביל — חישוב נכון" — scaling by a limiting ingredient (stock mode) still
// computes correctly. Smoke test on an existing recipe (read-only, no data changed).
import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s7';
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v ?? null).slice(0, 500)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + `/recipe/${id}`); await waitMain(page); await sleep(2500);

await page.getByRole('button', { name: 'לפי מלאי' }).click(); await sleep(300);
const ingSelect = page.locator('select[aria-label="לפי איזה רכיב"]');
const opts = await ingSelect.locator('option').allInnerTexts();
say('stock.ingredientOptions', opts);
// pick the flour row (usually first) and set a stock amount smaller than the recipe's own quantity
await ingSelect.selectOption({ index: 1 });
const chosen = await ingSelect.locator('option:checked').innerText();
say('stock.chosenIngredient', chosen);
await page.locator('#scale-value').fill('250');
await sleep(500);
const summary = (await page.locator('main').innerText()).match(/מקדם[\s\S]{0,60}/)?.[0];
say('stock.factorSummary', summary?.replace(/\s+/g, ' '));
await page.screenshot({ path: OUT + '/2-scale-by-stock.png' });
// switch back to recipe mode, confirm it returns to factor 1 (no persistent mutation)
await page.getByRole('button', { name: 'כמו במתכון' }).click(); await sleep(300);
say('stock.backToNormal', (await page.locator('main').innerText()).match(/מקדם[\s\S]{0,30}|כמו במתכון/)?.[0]);
fs.writeFileSync('s7b-scale-stock.json', JSON.stringify(R, null, 1));
await browser.close();
