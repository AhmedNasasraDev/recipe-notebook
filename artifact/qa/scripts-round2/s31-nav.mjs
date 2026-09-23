import { launch, BASE, text, sleep, shot, check, results, PHONE } from './drv.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const { browser, page, net, errors } = await launch({ storageState: 'state-qa1.json' });
const main = () => page.evaluate(() => { const m = document.querySelector('main'); return m ? { top: m.scrollTop, h: m.clientHeight, sh: m.scrollHeight } : null; });
const bar = () => page.evaluate(() => { const n = document.querySelector('nav[aria-label="ניווט ראשי"]'); if (!n) return null; const r = n.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight, fixed: getComputedStyle(n).position }; });
const topbar = () => page.evaluate(() => { const b = document.querySelector('button[aria-label="הדפסה או שמירה כ-PDF של המתכון"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; });

await page.goto(BASE + '/notebook'); await page.waitForSelector('main', { timeout: 20000 }); await sleep(1500); console.log('landed:', page.url(), (await text(page)).slice(0, 80));
const nbScrollable = await page.evaluate(() => { const m = document.querySelector('main'); m.scrollTop = 300; return m.scrollHeight > m.clientHeight + 300; });
await page.click(`a[href="/recipe/${id}"]`); await sleep(2500);
let m = await main(); let b = await bar(); let tb = await topbar();
check('N01', 'recipe opens at the top (no inherited scroll)', m.top === 0, JSON.stringify(m));
check('N02', 'tab bar sits at the bottom edge of the viewport', b && b.bottom === b.vh, JSON.stringify(b));
check('N03', 'print button visible at top, ≥44px tall', tb && tb.top >= 0 && tb.h >= 44, JSON.stringify(tb));
await shot(page, 'W03-recipe-top-phone');

await page.evaluate(() => { document.querySelector('main').scrollTop = 900; }); await sleep(400);
m = await main(); b = await bar(); tb = await topbar();
check('N04', 'after scrolling 900px the print button is still on screen (sticky)', tb && tb.top >= 0 && tb.bottom <= 120, JSON.stringify(tb));
check('N05', 'tab bar unchanged after scroll', b && b.bottom === b.vh, JSON.stringify(b));
await shot(page, 'W04-recipe-scrolled-phone');
const scrolledTop = m.top;

// open "more" → order sheet
await page.click('button[aria-label="עוד פעולות על המתכון"]'); await sleep(600);
await page.click(`a[href^="/recipe/${id}/order"]`); await sleep(2000);
check('N06', 'order screen has no tab bar (depth screen)', (await bar()) === null, page.url());
const docTop = await page.evaluate(() => document.scrollingElement.scrollTop);
check('N07', 'order sheet opens at the top', docTop === 0, String(docTop));
await shot(page, 'W05-order-phone');
await page.goBack(); await sleep(1500);
m = await main(); b = await bar();
// The actions panel scrolled itself into view before we left (scrollIntoView), so the
// remembered offset is where the panel was — deep in the page — not the 900 set earlier.
check('N08', 'back to the recipe restores the scroll position (deep in the page, not the top)', m && m.top > 800, `now ${m?.top} (before leaving: ${scrolledTop}, then the actions panel opened)`);
check('N09', 'tab bar back at the bottom edge after back', b && b.bottom === b.vh, JSON.stringify(b));

// cook mode + fullscreen
await page.evaluate(() => { document.querySelector('main').scrollTop = 0; });
await page.click(`a[href^="/recipe/${id}/cook"]`); await sleep(2000);
check('N10', 'cook mode has no tab bar', (await bar()) === null, page.url());
await page.getByRole('button', { name: /^מסך מלא$/ }).click(); await sleep(800);
let t = await text(page);
check('N11', 'fullscreen toggle responds (real or fallback)', /יציאה ממסך מלא/.test(t), t.slice(0, 80));
await shot(page, 'W06-cook-fullscreen-phone');
await page.getByRole('button', { name: /יציאה ממסך מלא/ }).click(); await sleep(500);
await page.getByRole('button', { name: /^יציאה$/ }).first().click(); await sleep(1500);
m = await main(); b = await bar();
check('N12', 'leaving cook mode: recipe at top, tab bar at bottom edge', m && m.top === 0 && b && b.bottom === b.vh, JSON.stringify({ m, b }));

// reload
await page.reload(); await sleep(3000);
m = await main(); b = await bar(); tb = await topbar();
check('N13', 'after reload: top of recipe, tab bar at bottom, print button on screen', m && m.top === 0 && b && b.bottom === b.vh && tb && tb.top >= 0, JSON.stringify({ m, b, tb }));

// tabs
await page.click('nav[aria-label="ניווט ראשי"] a[href="/home"]'); await sleep(1200);
b = await bar(); check('N14', 'home tab: bar at bottom edge', b && b.bottom === b.vh, JSON.stringify(b));
await page.click('nav[aria-label="ניווט ראשי"] a[href="/notebook"]'); await sleep(1200);
b = await bar(); m = await main();
check('N15', 'back on the notebook: scroll position remembered (~300)', nbScrollable ? (m && m.top > 100) : null, nbScrollable ? JSON.stringify(m) : 'notebook with one recipe does not scroll; covered by N08 on the recipe page');

// landscape
await page.setViewportSize({ width: 874, height: 402 }); await sleep(800);
b = await bar(); check('N16', 'landscape: tab bar at the bottom edge', b && b.bottom === b.vh, JSON.stringify(b));
await page.goto(BASE + `/recipe/${id}`); await sleep(2500);
tb = await topbar(); b = await bar();
check('N17', 'landscape recipe: print button on screen, bar at bottom', tb && tb.top >= 0 && b && b.bottom === b.vh, JSON.stringify({ tb, b }));
await shot(page, 'W07-recipe-landscape');
await page.setViewportSize(PHONE);

// keyboard: focus the scale input and shrink the visual viewport is not possible headless — note it
check('N18', 'software keyboard: cannot be simulated in headless Chromium', null, 'the useSoftKeyboard hook hides the bar while a text field has focus and the visual viewport shrinks ≥140px');

console.log('errors:', errors.slice(0, 5));
console.log(JSON.stringify(results.filter(r => r.pass === false)));
await browser.close();
