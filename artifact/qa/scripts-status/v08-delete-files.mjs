// Repro: after a recipe is deleted, are its photo files removed from storage? Captures the storage DELETE call and its response.
import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const go = async (u, sel = 'main', ms = 1800) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };
await go('/recipe/new'); await page.fill('#r-name', 'בדיקה-QA מחיקת קובץ'); await page.getByRole('button', { name: /המשך לחומרי גלם/ }).click(); await sleep(300);
await page.locator('input[aria-label^="שם הרכיב בשורה 1"]').first().fill('קמח'); await page.locator('input[aria-label^="כמות של"]').nth(0).fill('100');
await page.getByRole('button', { name: /המשך לאופן ההכנה/ }).click(); await sleep(300); await page.locator('textarea').first().fill('לערבב');
await page.getByRole('button', { name: /המשך לסיכום/ }).click(); await sleep(300); await page.getByRole('button', { name: 'שמירת המתכון' }).click(); await sleep(4000);
const rid = page.url().split('/recipe/')[1].split(/[/?]/)[0];
await page.locator('input[type=file]').last().setInputFiles('qa-photo-1.png'); await sleep(7000);
const calls = [];
page.on('response', async (r) => { if (/storage\/v1\/object/.test(r.url()) && r.request().method() === 'DELETE') { let b = ''; try { b = await r.text(); } catch {} calls.push({ url: r.url().replace(/^https:\/\/[^/]+/, ''), status: r.status(), body: b.slice(0, 300), sent: r.request().postData()?.slice(0, 200) }); } });
await page.reload(); await waitMain(page); await sleep(1500);
await page.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(300);
await page.getByRole('button', { name: /^מחיקת בדיקה-QA/ }).first().click(); await sleep(400);
await page.locator('button:has-text("כן, למחוק")').first().click(); await sleep(4000);
console.log(JSON.stringify({ recipe: rid, storageDeleteCalls: calls }, null, 1));
await browser.close();
