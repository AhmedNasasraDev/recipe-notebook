// Images end to end on the real project: duplicate copies, replace, delete, editor photo for a NEW recipe.
import { launch, BASE, text, sleep, shot, check, results } from './drv.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const { browser, page, net, errors } = await launch({ storageState: 'state-qa1.json' });
const heroSrc = () => page.evaluate(() => document.querySelector('img[aria-hidden="true"]')?.getAttribute('src') ?? null);

// duplicate
await page.goto(BASE + `/recipe/${id}`); await page.waitForSelector('main'); await page.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }); await sleep(500);
const origSrc = await heroSrc();
await page.click('button[aria-label="עוד פעולות על המתכון"]'); await sleep(500);
await page.getByRole('button', { name: /^שכפול/ }).click(); await sleep(5000);
const copyId = page.url().split('/recipe/')[1];
fs.writeFileSync('copy-id.txt', copyId);
await page.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {});
let t = await text(page);
const copySrc = await heroSrc();
const noticeSeen = await page.getByRole('status').filter({ hasText: /המתכון נשמר/ }).count().then((n) => n > 0);
check('D01', 'duplicate opens with its own hero photo', copySrc !== null && copyId !== id, `copy ${copyId}`);
check('D02', 'the copy\'s photo is a different storage object', copySrc && origSrc && copySrc.split('?')[0] !== origSrc.split('?')[0], `${copySrc?.split('/').slice(-2).join('/').split('?')[0]} vs ${origSrc?.split('/').slice(-2).join('/').split('?')[0]}`);
check('D03', 'copy saved notice, no error', noticeSeen && !/נכשל/.test(t), noticeSeen ? 'notice shown' : t.slice(0, 100));
await shot(page, 'W11-copy-with-photo');

// delete the photo on the COPY
await page.getByRole('button', { name: 'מחיקת התמונה' }).first().click(); await sleep(300);
await page.getByRole('button', { name: /^למחוק$/ }).click(); await sleep(3000);
t = await text(page);
check('D04', 'photo deleted on the copy: notice shown', /התמונה נמחקה/.test(t), (t.match(/התמונה נמחקה[^.]*/) || [''])[0]);
// original still has its photo
await page.goto(BASE + `/recipe/${id}`); await page.waitForSelector('main'); await page.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {}); await sleep(500);
check('D05', 'original keeps its photo after the copy\'s was deleted', (await heroSrc()) !== null, '');

// replace on the original
const before = await heroSrc();
await page.locator('input[aria-label="החלפת התמונה בקובץ אחר"]').first().setInputFiles('qa-photo-2.png'); await sleep(6000);
t = await text(page);
const after = await heroSrc();
check('D06', 'replace: notice "התמונה הוחלפה" and a new object', /התמונה הוחלפה/.test(t) && after && before && after.split('?')[0] !== before.split('?')[0], (t.match(/התמונה הוחלפה|נכשל[^.]*/) || [''])[0]);
await shot(page, 'W12-replaced-photo');
await page.reload(); await page.waitForSelector('main'); await page.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {}); await sleep(500);
const afterReload = await heroSrc();
check('D07', 'after reload the replaced photo is the one shown', afterReload && afterReload.split('?')[0] === after.split('?')[0], '');

// NEW recipe with a photo picked before the first save
await page.goto(BASE + '/recipe/new'); await page.waitForSelector('main'); await sleep(1500);
await page.fill('input[id*="name"], input[placeholder*="שם"]', 'בדיקה-QA מתכון עם תמונה מהעורך').catch(async () => { await page.locator('input').first().fill('בדיקה-QA מתכון עם תמונה מהעורך'); });
await page.locator('input[type=file]').first().setInputFiles('qa-photo-1.png'); await sleep(500);
t = await text(page);
check('E01', 'new recipe: the picked photo waits, and the screen says it uploads on first save', /תועלה ברגע שהמתכון יישמר/.test(t) && /נבחר:/.test(t), '');
const listCalls = net.filter(n => n.u.includes('recipe_images') && n.m === 'GET' && /recipe_id=eq\.$|recipe_id=eq\.new-/.test(n.u));
check('E02', 'no image request for a recipe with no id', listCalls.length === 0, JSON.stringify(listCalls.map(n => n.u)));
console.log('editor text head:', t.slice(0, 300));
await shot(page, 'W13-editor-new-photo');
console.log('errors:', errors.slice(0, 5));
console.log('net 4xx:', net.filter(n => n.s >= 400).map(n => `${n.m} ${n.u.slice(0,80)} ${n.s}`).slice(0, 8));
console.log(JSON.stringify(results.filter(r => r.pass === false)));
await browser.close();
