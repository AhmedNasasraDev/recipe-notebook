// Spec stage 7 (§9.3): a sub-recipe's cost and quantity roll up correctly into a parent recipe. Test data only
// (בדיקה-QA prefix), created and deleted by this script.
import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s7'; fs.mkdirSync(OUT, { recursive: true });
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v).slice(0, 500)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const go = async (u, sel = 'main', ms = 1800) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };

// ── base recipe: 200 g flour @ 4 ₪/kg + 200 g water (free) = 800 g, cost 0.8 ₪ ──
await go('/recipe/new');
await page.fill('#r-name', 'בדיקה-QA רוטב שוקולד בסיס');
await page.getByRole('button', { name: /המשך לחומרי גלם/ }).click(); await sleep(300);
await page.locator('input[aria-label^="שם הרכיב בשורה 1"]').fill('שוקולד מריר');
await page.locator('input[aria-label^="כמות של"]').nth(0).fill('200');
await page.getByRole('button', { name: 'הוספת רכיב' }).click(); await sleep(200);
await page.locator('input[aria-label^="שם הרכיב בשורה 2"]').fill('שמנת');
await page.locator('input[aria-label^="כמות של"]').nth(1).fill('200');
// price the first row: open its details, set price 40/kg
await page.locator('summary').filter({ hasText: 'פרטים נוספים לשוקולד מריר' }).click(); await sleep(200);
await page.locator('input[aria-label="מחיר של שוקולד מריר"]').fill('40');
await page.locator('select[aria-label="יחידת המחיר של שוקולד מריר"]').selectOption('ק"ג');
await page.getByRole('button', { name: /המשך לאופן ההכנה/ }).click(); await sleep(300);
await page.locator('textarea').first().fill('להמיס יחד');
await page.getByRole('button', { name: /המשך לסיכום/ }).click(); await sleep(300);
await page.getByRole('button', { name: 'שמירת המתכון' }).click(); await sleep(3500);
const baseId = page.url().split('/recipe/')[1]?.split(/[/?]/)[0];
say('base.created', { id: baseId, url: page.url() });
await page.locator('summary').filter({ hasText: 'נתוני ייצור ועלויות' }).click(); await sleep(400);
const baseCostText = (await page.locator('body').innerText()).match(/עלות חומרי הגלם[\s\S]{0,40}/)?.[0] ?? '';
say('base.foodCostLine', baseCostText.replace(/\s+/g, ' '));

// ── parent recipe: 100 g of the base, weighed, plus 300 g flour ──
await go('/recipe/new');
await page.fill('#r-name', 'בדיקה-QA עוגה עם רוטב');
await page.getByRole('button', { name: /המשך לחומרי גלם/ }).click(); await sleep(300);
await page.locator('input[aria-label^="שם הרכיב בשורה 1"]').fill('קמח');
await page.locator('input[aria-label^="כמות של"]').nth(0).fill('300');
await page.getByRole('button', { name: 'הוספת רכיב' }).click(); await sleep(200);
await page.locator('input[aria-label^="שם הרכיב בשורה 2"]').fill('רוטב שוקולד');
await page.locator('input[aria-label^="כמות של"]').nth(1).fill('100');
await page.locator('summary').filter({ hasText: 'פרטים נוספים לרוטב שוקולד' }).click(); await sleep(200);
const subSelect = page.locator('select[aria-label="מתכון בסיס עבור רוטב שוקולד"]');
say('sub.optionsInclude', await subSelect.locator('option').allInnerTexts());
const subOpt = (await subSelect.locator('option').allInnerTexts()).find((t) => t.includes('בדיקה-QA רוטב שוקולד בסיס'));
await subSelect.selectOption({ label: subOpt });
await sleep(300);
say('sub.hintAfterLink', (await page.locator('main').innerText()).match(/הכמות נמדדת במשקל[^.]*\./)?.[0]);
await page.getByRole('button', { name: /המשך לאופן ההכנה/ }).click(); await sleep(300);
await page.locator('textarea').first().fill('לערבב הכול');
await page.getByRole('button', { name: /המשך לסיכום/ }).click(); await sleep(300);
await page.getByRole('button', { name: 'שמירת המתכון' }).click(); await sleep(3500);
const parentId = page.url().split('/recipe/')[1]?.split(/[/?]/)[0];
say('parent.created', { id: parentId, url: page.url() });

// weight shown on the parent's ingredient row for the linked line: should be 100 g (weighed, not volume-converted)
const rowText = await page.locator('main').innerText();
say('parent.linkedRowShowsWeight', /רוטב שוקולד[\s\S]{0,60}/.exec(rowText)?.[0]?.replace(/\s+/g, ' '));

// open production data: cost should roll up from the base pro rata (100/400 of the base's cost = 100 g share)
await page.locator('summary').filter({ hasText: 'נתוני ייצור ועלויות' }).click(); await sleep(400);
const parentBody = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
const fcMatch = parentBody.match(/עלות חומרי הגלם[^₪]*[\d.]+\s*₪/)?.[0];
say('parent.foodCostLine', fcMatch);
await page.screenshot({ path: OUT + '/1-subrecipe-parent-prodata.png', fullPage: true });

// cleanup: delete both test recipes via the ⋮ menu
for (const [label, url] of [['parent', `/recipe/${parentId}`], ['base', `/recipe/${baseId}`]]) {
  await go(url);
  await page.locator('button[aria-label="פעולות למתכון"]').click(); await sleep(300);
  await page.getByRole('menuitem', { name: 'מחיקה' }).click(); await sleep(400);
  await page.getByRole('button', { name: /^אישור מחיקת/ }).click(); await sleep(2500);
  say(`cleanup.${label}`, page.url());
}

fs.writeFileSync('s7a-subrecipe.json', JSON.stringify(R, null, 1));
await browser.close();
