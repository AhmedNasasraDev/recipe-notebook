// Focal-point save on the real project (finding 1), the hero, and the printed PDF.
import { launch, BASE, text, sleep, shot, check, results, DESK } from './drv.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const { browser, page, net, errors } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + `/recipe/${id}`); await page.waitForSelector('main'); await sleep(3000);
const hero = () => page.evaluate(() => { const i = document.querySelector('img[aria-hidden="true"]'); return i ? { pos: i.style.objectPosition, w: i.naturalWidth, top: Math.round(i.getBoundingClientRect().top) } : null; });
await page.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {});
let h = await hero();
check('F01', 'hero photo at the top of the recipe screen', h && h.w > 0 && h.top < 120, JSON.stringify(h));
await page.getByRole('button', { name: 'התאמת מיקום התמונה' }).click(); await sleep(400);
const box = await page.locator('button[aria-label^="בחירת מיקום התמונה"]').boundingBox();
await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.8); await sleep(300);
h = await hero();
check('F02', 'tapping the picture previews the focal point (~20% ~80%)', h && /^(19|2\d)(\.\d+)?% (79|8\d)(\.\d+)?%$/.test(h.pos), h?.pos);
await page.getByRole('button', { name: 'שמירת המיקום' }).click(); await sleep(2500);
let t = await text(page);
const patch = net.filter(n => n.m === 'PATCH' && n.u.includes('recipe_images'));
check('F03', 'focal point saved: PATCH recipe_images → 200 and "המיקום נשמר"', patch.some(p => p.s === 200) && /המיקום נשמר/.test(t), JSON.stringify(patch.map(p => p.s)));
check('F04', 'no PGRST204 / no error text on screen', !/PGRST|נכשלה/.test(t), (t.match(/[^.]*נכשלה[^.]*/) || [''])[0]);
await shot(page, 'W08-focal-saved');
await page.reload(); await page.waitForSelector('main'); await page.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {}); await sleep(500);
h = await hero();
check('F05', 'after reload the stored focal point is applied', h !== null && /^(19|2\d)(\.\d+)?% (79|8\d)(\.\d+)?%$/.test(h.pos), JSON.stringify(h));
// the real flow: does window.print() reach the sheet's beforeprint listener in this Chromium?
const ev = await page.evaluate(() => new Promise((r) => { const seen = []; window.addEventListener('beforeprint', () => seen.push('before'), { once: true }); window.addEventListener('afterprint', () => { seen.push('after'); r(seen.join(',')); }, { once: true }); setTimeout(() => r(seen.join(',') || 'none'), 4000); window.print(); }));
check('P00', 'window.print() fires beforeprint/afterprint (the sheet mounts on the real print path)', /before/.test(ev), ev);

// ── PDF of the recipe ──
await page.emulateMedia({ media: 'print' });
// Does printToPDF fire beforeprint? Try without dispatching first.
let pdf = await page.pdf({ format: 'A4', printBackground: true, path: '/home/user/recipe-notebook/artifact/qa/shots-real/W09-recipe.pdf' });
const parse = (await import('pdf-parse/lib/pdf-parse.js')).default;
let info = await parse(pdf);
let fired = /בגרמים/.test(info.text);
console.log('printToPDF fired beforeprint:', fired, 'pages', info.numpages);
if (!fired) {
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint'))); await sleep(600);
  pdf = await page.pdf({ format: 'A4', printBackground: true, path: '/home/user/recipe-notebook/artifact/qa/shots-real/W09-recipe.pdf' });
  info = await parse(pdf);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
}
const pt = info.text.replace(/\s+/g, ' ');
console.log('PDF pages:', info.numpages, '| text:', pt.slice(0, 700));
// pdf text extraction reverses the word order of Hebrew runs; the check is per word.
const has = (...words) => words.every((w) => pt.includes(w));
check('P01', 'PDF has the recipe name and category', has('בריוש', 'חמאה', 'קלאסי', 'בצקים'), '');
check('P02', 'PDF has ingredients with quantities', has('קמח', 'לחם', '500 גר', 'חמאה', '250 גר', 'סוכר', '60 גר'), '');
check('P03', 'PDF has the steps with times and temperature', /מערבבים/.test(pt) && /180°C/.test(pt) && /25 דק/.test(pt) && /90 דק|שע/.test(pt), '');
check('P04', 'PDF has yield, weights, total time', has('יחידות 12', 'אפייה לפני משקל', '1.2 ', '1.05 ', 'כולל זמן'), '');
await page.screenshot({ path: '/home/user/recipe-notebook/artifact/qa/shots-real/W09-print-preview.png', fullPage: true });
check('P05', 'PDF carries no internal markers or "לא מצוין"', !/§|\(88\)|S1\b|לא מצוין|noprint|undefined|NaN/.test(pt), (pt.match(/§|\(88\)|לא מצוין|undefined|NaN/g) || []).join(','));
check('P06', 'PDF is 1–2 pages, no empty trailing page', info.numpages >= 1 && info.numpages <= 2, String(info.numpages));
check('P07', 'PDF does not include the app chrome (tabs, scale controls)', !/בית מחברת קבוצות עוד|כמה להכין|לפי מלאי/.test(pt), '');
await page.emulateMedia({ media: 'screen' });

// desktop print button
await page.setViewportSize(DESK); await page.reload(); await page.waitForSelector('main'); await sleep(3000);
const tb = await page.locator('button[aria-label="הדפסה או שמירה כ-PDF של המתכון"]').boundingBox();
check('P08', 'desktop: print button visible at top', tb && tb.y >= 0 && tb.height >= 44, JSON.stringify(tb));
await shot(page, 'W10-recipe-desktop');
console.log('errors:', errors.slice(0, 5));
console.log(JSON.stringify(results.filter(r => r.pass === false)));
await browser.close();
