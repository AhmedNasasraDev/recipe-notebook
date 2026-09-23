import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s8';
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v ?? null).slice(0, 500)); };
const GANACHE = 'b343acb2-8fdc-4044-963d-593cacd49e52';
function contrast(hexA, hexB) {
  const lum = (hex) => {
    const [r,g,b] = [0,2,4].map((i) => parseInt(hex.slice(i+1,i+3),16)/255).map((c) => c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4);
    return 0.2126*r+0.7152*g+0.0722*b;
  };
  const [l1,l2] = [lum(hexA), lum(hexB)].sort((a,b)=>a-b);
  return (l2+0.05)/(l1+0.05);
}
const rgbToHex = (rgb) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb); return '#'+[m[1],m[2],m[3]].map((n)=>Number(n).toString(16).padStart(2,'0')).join(''); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + `/recipe/${GANACHE}`); await waitMain(page); await sleep(2500);
// find ANY element using the amber colour as its text
const amberEls = await page.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (cs.color === 'rgb(140, 90, 12)' && e.textContent.trim() && e.children.length === 0) {
      out.push({ text: e.textContent.trim().slice(0, 60), bg: cs.backgroundColor, color: cs.color });
    }
  }
  return out.slice(0, 10);
});
say('amberElsOnPage', amberEls);
if (amberEls.length) {
  const one = amberEls[0];
  say('amber.realContrast', contrast(rgbToHex(one.color), rgbToHex(one.bg === 'rgba(0, 0, 0, 0)' ? 'rgb(253,251,246)' : one.bg)).toFixed(2));
}
// open pro details to find the amber "system value" badges
await page.locator('summary').filter({ hasText: 'נתוני ייצור ועלויות' }).click(); await sleep(500);
const amberEls2 = await page.evaluate(() => {
  const out = [];
  for (const e of document.querySelectorAll('*')) {
    const cs = getComputedStyle(e);
    if (cs.color === 'rgb(140, 90, 12)' && e.textContent.trim() && e.children.length === 0) {
      out.push({ text: e.textContent.trim().slice(0, 60), bg: cs.backgroundColor });
    }
  }
  return out.slice(0, 10);
});
say('amberElsInPro', amberEls2);
await page.screenshot({ path: OUT + '/3-ganache-pro-open.png', fullPage: true });
fs.writeFileSync('s8-color-verify2.json', JSON.stringify(R, null, 1));
await browser.close();
