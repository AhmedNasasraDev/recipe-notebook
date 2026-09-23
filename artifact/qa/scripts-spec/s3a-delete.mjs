// Spec stage 3א, A-11: after migration 0040, does deleting a recipe remove its photo file from storage?
// Creates a test recipe (בדיקה-QA), uploads a photo, deletes the recipe, captures the storage DELETE response,
// and records the uploaded path + console warnings. Test data only; deleted at the end of the test by the test itself.
import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s3a'; fs.mkdirSync(OUT, { recursive: true });
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const warns = []; page.on('console', (m) => { if (m.type() === 'warning' || m.type() === 'warn') warns.push(m.text()); });
const go = async (u, sel = 'main', ms = 1800) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };
await go('/recipe/new'); await page.fill('#r-name', 'בדיקה-QA מחיקת קובץ 3א'); await page.getByRole('button', { name: /המשך לחומרי גלם/ }).click(); await sleep(300);
await page.locator('input[aria-label^="שם הרכיב בשורה 1"]').first().fill('קמח'); await page.locator('input[aria-label^="כמות של"]').nth(0).fill('100');
await page.getByRole('button', { name: /המשך לאופן ההכנה/ }).click(); await sleep(300); await page.locator('textarea').first().fill('לערבב');
await page.getByRole('button', { name: /המשך לסיכום/ }).click(); await sleep(300); await page.getByRole('button', { name: 'שמירת המתכון' }).click(); await sleep(4000);
const rid = page.url().split('/recipe/')[1].split(/[/?]/)[0];
const uploads = []; page.on('response', (r) => { if (/storage\/v1\/object\/recipe-images/.test(r.url()) && r.request().method() === 'POST') uploads.push({ url: r.url().replace(/^https:\/\/[^/]+/, ''), status: r.status() }); });
await page.locator('input[type=file]').last().setInputFiles('qa-photo-1.png'); await sleep(7000);
await page.screenshot({ path: OUT + '/A11-1-recipe-with-photo.png' });
const calls = [];
page.on('response', async (r) => { if (/storage\/v1\/object/.test(r.url()) && r.request().method() === 'DELETE') { let b = ''; try { b = await r.text(); } catch {} calls.push({ url: r.url().replace(/^https:\/\/[^/]+/, ''), status: r.status(), body: b.slice(0, 300), sent: r.request().postData()?.slice(0, 200) }); } });
await page.reload(); await waitMain(page); await sleep(1500);
await page.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(300);
await page.getByRole('button', { name: /^מחיקת בדיקה-QA/ }).first().click(); await sleep(400);
await page.screenshot({ path: OUT + '/A11-2-confirm-delete.png' });
await page.locator('button:has-text("כן, למחוק")').first().click(); await sleep(4000);
await page.screenshot({ path: OUT + '/A11-3-after-delete.png' });
console.log(JSON.stringify({ recipe: rid, uploads, storageDeleteCalls: calls, consoleWarnings: warns, urlAfter: page.url() }, null, 1));
await browser.close();
