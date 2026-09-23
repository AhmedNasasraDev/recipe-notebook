// Spec stage 7 (§9.2): tall-narrow and wide-short photos still crop correctly into the fixed-height hero band.
// Uses a fresh test recipe (בדיקה-QA), deleted at the end.
import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s7';
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v ?? null).slice(0, 500)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const go = async (u, sel = 'main', ms = 1800) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };

await go('/recipe/new');
await page.fill('#r-name', 'בדיקה-QA תמונות יחס גובה-רוחב');
await page.getByRole('button', { name: /המשך לחומרי גלם/ }).click(); await sleep(300);
await page.locator('input[aria-label^="שם הרכיב בשורה 1"]').fill('קמח');
await page.locator('input[aria-label^="כמות של"]').nth(0).fill('100');
await page.getByRole('button', { name: /המשך לאופן ההכנה/ }).click(); await sleep(300);
await page.locator('textarea').first().fill('לערבב');
await page.getByRole('button', { name: /המשך לסיכום/ }).click(); await sleep(300);
await page.getByRole('button', { name: 'שמירת המתכון' }).click(); await sleep(3500);
const rid = page.url().split('/recipe/')[1]?.split(/[/?]/)[0];
say('recipe.created', rid);

// tall & narrow (200×800)
await page.locator('input[type=file]').last().setInputFiles('qa-photo-tall.png'); await sleep(6000);
say('hero.tall', await page.evaluate(() => { const img = document.querySelector('[class*="heroPhoto"]'); const r = img?.getBoundingClientRect(); return img ? { height: Math.round(r.height), width: Math.round(r.width), objectFit: getComputedStyle(img).objectFit, loaded: img.complete && img.naturalWidth > 0 } : null; }));
await page.screenshot({ path: OUT + '/3-hero-tall-photo.png' });

// replace with wide & short (1600×300)
await page.locator('button', { hasText: 'החלפת התמונה' }).click(); await sleep(400);
const fileInputs = page.locator('input[type=file]');
await fileInputs.last().setInputFiles('qa-photo-wide.png'); await sleep(6000);
say('hero.wide', await page.evaluate(() => { const img = document.querySelector('[class*="heroPhoto"]'); const r = img?.getBoundingClientRect(); return img ? { height: Math.round(r.height), width: Math.round(r.width), objectFit: getComputedStyle(img).objectFit, loaded: img.complete && img.naturalWidth > 0 } : null; }));
await page.screenshot({ path: OUT + '/4-hero-wide-photo.png' });

// cleanup
await page.locator('button[aria-label="פעולות למתכון"]').click(); await sleep(300);
await page.getByRole('menuitem', { name: 'מחיקה' }).click(); await sleep(400);
await page.getByRole('button', { name: /^אישור מחיקת/ }).click(); await sleep(2500);
say('cleanup', page.url());

fs.writeFileSync('s7c-photo-aspect.json', JSON.stringify(R, null, 1));
await browser.close();
