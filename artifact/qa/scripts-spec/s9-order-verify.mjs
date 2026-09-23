// Spec §8.1 follow-up: the order sheet's duplicate top print button is gone; the bottom one still works and prints.
import { launch, BASE, sleep, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s9';
fs.mkdirSync(OUT, { recursive: true });
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v ?? null).slice(0, 500)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + `/recipe/${id}/order?mode=units&v=20`); await waitMain(page, '#order-qty'); await sleep(2500);
say('topBar.printButtons', await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /הדפסה/.test(b.textContent)).map((b) => ({ text: b.textContent.trim(), top: Math.round(b.getBoundingClientRect().top) }))));
say('topBar.controls', await page.evaluate(() => [...document.querySelectorAll('[class*="topBar"] *')].filter((e) => e.children.length === 0 && e.textContent.trim()).map((e) => e.textContent.trim())));
await page.screenshot({ path: OUT + '/1-order-top-phone.png' });
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await sleep(300);
await page.screenshot({ path: OUT + '/2-order-bottom-phone.png' });
// print event still fires from the remaining button
let printed = false; page.on('console', () => {});
await page.exposeFunction('__printMark', () => { printed = true; });
await page.evaluate(() => { window.print = () => window.__printMark(); });
await page.locator('button', { hasText: 'הדפסה / שמירה כ-PDF' }).click();
say('bottomButton.stillPrints', printed);
fs.writeFileSync('s9-order-verify.json', JSON.stringify(R, null, 1));
await browser.close();
