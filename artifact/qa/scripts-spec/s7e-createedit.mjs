// Spec stage 7 (§9.3): create → save → refresh → exists; edit → save → refresh → change persisted. Test data only.
import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v ?? null).slice(0, 500)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const go = async (u, sel = 'main', ms = 1800) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };

await go('/recipe/new');
await page.fill('#r-name', 'בדיקה-QA יצירה ורענון');
await page.getByRole('button', { name: /המשך לחומרי גלם/ }).click(); await sleep(300);
await page.locator('input[aria-label^="שם הרכיב בשורה 1"]').fill('קמח');
await page.locator('input[aria-label^="כמות של"]').nth(0).fill('100');
await page.getByRole('button', { name: /המשך לאופן ההכנה/ }).click(); await sleep(300);
await page.locator('textarea').first().fill('לערבב');
await page.getByRole('button', { name: /המשך לסיכום/ }).click(); await sleep(300);
await page.getByRole('button', { name: 'שמירת המתכון' }).click(); await sleep(3500);
const rid = page.url().split('/recipe/')[1]?.split(/[/?]/)[0];
say('created.id', rid);
await page.reload(); await waitMain(page); await sleep(1500);
say('created.afterReload', await page.locator('h1').first().innerText());

// edit: rename an ingredient, save, refresh
await go(`/recipe/${rid}/edit`);
await page.getByRole('button', { name: /^שלב 2 / }).click(); await sleep(300);
await page.locator('input[aria-label^="שם הרכיב בשורה 1"]').fill('קמח לחם מלא');
await page.getByRole('button', { name: /^שלב 4 / }).click(); await sleep(300);
await page.getByRole('button', { name: 'שמירת השינויים' }).click(); await sleep(3000);
await page.reload(); await waitMain(page); await sleep(1500);
say('edited.afterReload', (await page.locator('main').innerText()).includes('קמח לחם מלא'));

// cleanup
await page.locator('button[aria-label="פעולות למתכון"]').click(); await sleep(300);
await page.getByRole('menuitem', { name: 'מחיקה' }).click(); await sleep(400);
await page.getByRole('button', { name: /^אישור מחיקת/ }).click(); await sleep(2500);
say('cleanup', page.url());
fs.writeFileSync('s7e-createedit.json', JSON.stringify(R, null, 1));
await browser.close();
