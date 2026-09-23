// Spec §3.3 / U-2 follow-up (stage 9, "תקטין גם שם"): the cook-screen print button is now quiet, matching "מסך מלא".
import { launch, BASE, sleep, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s10';
fs.mkdirSync(OUT, { recursive: true });
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v ?? null).slice(0, 500)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + `/recipe/${id}/cook`); await waitMain(page, 'li label'); await sleep(2000);
const hex = (c) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c); return m ? '#'+[m[1],m[2],m[3]].map((n)=>Number(n).toString(16).padStart(2,'0')).join('') : c; };
const printBtn = page.locator('button', { hasText: 'הדפסה / PDF' });
const fsBtn = page.locator('button', { hasText: 'מסך מלא' });
say('printBtn.style', await printBtn.evaluate((e) => { const cs = getComputedStyle(e); return { bg: cs.backgroundColor, border: cs.borderColor, color: cs.color, height: Math.round(e.getBoundingClientRect().height), width: Math.round(e.getBoundingClientRect().width) }; }));
say('fsBtn.style', await fsBtn.evaluate((e) => { const cs = getComputedStyle(e); return { bg: cs.backgroundColor, border: cs.borderColor, color: cs.color, height: Math.round(e.getBoundingClientRect().height) }; }));
await page.screenshot({ path: OUT + '/1-cook-top-bar-phone.png' });
// still prints
let printed = false; await page.exposeFunction('__printMark2', () => { printed = true; });
await page.evaluate(() => { window.print = () => window.__printMark2(); });
await printBtn.click();
say('printBtn.stillPrints', printed);
fs.writeFileSync('s10-cook-verify.json', JSON.stringify(R, null, 1));
await browser.close();
