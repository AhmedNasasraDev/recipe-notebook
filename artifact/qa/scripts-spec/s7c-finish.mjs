import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s7';
const rid = '6fd663f1-6d7a-4c4d-a7f1-6c81c484bdc6';
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v ?? null).slice(0, 500)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + `/recipe/${rid}`); await waitMain(page); await sleep(2500);

// find the file input inside the "החלפת התמונה" label by its aria-label
const replaceInput = page.locator('input[aria-label="החלפת התמונה בקובץ אחר"]');
await replaceInput.setInputFiles('qa-photo-wide.png'); await sleep(6000);
say('hero.wide', await page.evaluate(() => { const img = document.querySelector('[class*="heroPhoto"]'); const r = img?.getBoundingClientRect(); return img ? { height: Math.round(r.height), width: Math.round(r.width), objectFit: getComputedStyle(img).objectFit, loaded: img.complete && img.naturalWidth > 0 } : null; }));
await page.screenshot({ path: OUT + '/4-hero-wide-photo.png' });

await page.locator('button[aria-label="פעולות למתכון"]').click(); await sleep(300);
await page.getByRole('menuitem', { name: 'מחיקה' }).click(); await sleep(400);
await page.getByRole('button', { name: /^אישור מחיקת/ }).click(); await sleep(2500);
say('cleanup', page.url());
fs.writeFileSync('s7c-finish.json', JSON.stringify(R, null, 1));
await browser.close();
