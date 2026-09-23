// "תאשר" follow-up: verify the darkened grey/amber render correctly and actually measure ≥4.5:1 in the real browser
// (not just the CSS source), on a screen using secondary text and one using the amber warning banner.
import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s8';
fs.mkdirSync(OUT, { recursive: true });
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v ?? null).slice(0, 500)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const go = async (u, sel = 'main', ms = 2000) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };

function contrast(hexA, hexB) {
  const lum = (hex) => {
    const [r,g,b] = [0,2,4].map((i) => parseInt(hex.slice(i+1,i+3),16)/255).map((c) => c<=0.03928 ? c/12.92 : ((c+0.055)/1.055)**2.4);
    return 0.2126*r+0.7152*g+0.0722*b;
  };
  const [l1,l2] = [lum(hexA), lum(hexB)].sort((a,b)=>a-b);
  return (l2+0.05)/(l1+0.05);
}
const rgbToHex = (rgb) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(rgb); return '#'+[m[1],m[2],m[3]].map((n)=>Number(n).toString(16).padStart(2,'0')).join(''); };

await go(`/recipe/${id}`);
const muted = await page.evaluate(() => { const el = document.querySelector('[class*="meta"]'); return el ? getComputedStyle(el).color : null; });
const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
say('grey.computedColor', muted);
say('grey.bg', bg);
if (muted) say('grey.realContrast', contrast(rgbToHex(muted), rgbToHex(bg)).toFixed(2));
await page.screenshot({ path: OUT + '/1-recipe-meta-text.png' });

// amber banner: the "לא ניתן לחשב"/"נתונים חלקיים" box on a partial recipe, or unresolved-ingredient note
const GANACHE = 'b343acb2-8fdc-4044-963d-593cacd49e52';
await go(`/recipe/${GANACHE}`);
const amberBox = page.locator('[class*="calcPartialBox"], [class*="unresolvedSummary"], [class*="calcNoneBox"]').first();
if (await amberBox.count()) {
  const [fg, bgc] = await amberBox.evaluate((e) => { const cs = getComputedStyle(e); return [cs.color, cs.backgroundColor]; });
  say('amber.computed', { fg, bgc });
  say('amber.realContrast', contrast(rgbToHex(fg), rgbToHex(bgc)).toFixed(2));
}
await page.screenshot({ path: OUT + '/2-ganache-amber-box.png' });

fs.writeFileSync('s8-color-verify.json', JSON.stringify(R, null, 1));
await browser.close();
