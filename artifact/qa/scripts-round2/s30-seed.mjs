// Seed qa1 with a pasted brioche (exercises the parser) and a photo.
import { launch, BASE, text, sleep, shot } from './drv.mjs';
import fs from 'node:fs';
const TEXT = `בדיקה-QA בריוש חמאה קלאסי
רכיבים:
500 גרם קמח לחם
10 גרם מלח
60 גרם סוכר
15 גרם שמרים טריים
4 ביצים
100 מ"ל חלב
1 כפית תמצית וניל
250 גרם חמאה
משקל בצק לפני אפייה: 1200 גרם
משקל אחרי אפייה: 1050 גרם
תפוקה: 12 יחידות
משקל ליחידה 100 גרם
אופן ההכנה:
מערבבים את הקמח, המלח, הסוכר והשמרים במערבל.
מוסיפים 4 ביצים ו-100 מ"ל חלב ולשים 8 דקות.
מוסיפים 250 גרם חמאה בהדרגה ולשים עד שהבצק חלק.
מתפיחים שעה וחצי.
אופים 25 דקות ב-180 מעלות.`;
const { browser, page, net, errors } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + '/paste'); await sleep(2500);
await page.fill('textarea', TEXT);
await page.getByRole('button', { name: /פענוח|לפענח|נתח/ }).first().click(); await sleep(800);
let t = await text(page);
console.log('parsed:', t.slice(0, 600));
await shot(page, 'W01-paste-parsed');
// name should be pre-filled
const nameVal = await page.locator('input').first().inputValue().catch(() => '');
console.log('name field:', nameVal);
await page.getByRole('button', { name: /שמירה|שמור/ }).first().click(); await sleep(4000);
console.log('url after save:', page.url());
t = await text(page); console.log('recipe:', t.slice(0, 400));
const id = page.url().split('/recipe/')[1];
fs.writeFileSync('brioche-id.txt', id ?? '');
// photo
const input = page.locator('input[type=file]').first();
await input.setInputFiles('qa-photo-1.png'); await sleep(5000);
t = await text(page);
console.log('after photo:', /התמונה נשמרה למתכון/.test(t) ? 'NOTICE OK' : 'no notice', '|', (t.match(/התמונה[^.]{0,60}/g) || []).slice(0,3));
await shot(page, 'W02-recipe-with-photo');
console.log('errors:', errors.slice(0, 5));
console.log('net 4xx:', net.filter(n => n.s >= 400).map(n => `${n.m} ${n.u.slice(0,70)} ${n.s}`).slice(0, 8));
await browser.close();
