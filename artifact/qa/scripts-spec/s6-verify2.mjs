// A-9 re-check with REAL keyboard navigation (Tab), which is what an actual user does and what :focus-visible's
// browser heuristic actually keys on — a programmatic .focus() call does not reliably trigger it.
import { launch, BASE, sleep, creds, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s6';
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v).slice(0, 500)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const go = async (p, u, ms = 2000) => { await p.goto(BASE + u); await waitMain(p); await sleep(ms); };

const dctx = await browser.newContext({ viewport: DESK, locale: 'he-IL' }); const desk = await dctx.newPage();
await desk.goto(BASE + '/'); await desk.waitForSelector('#auth-email');
// keyboard-driven login, so the browser's focus-visible modality is "keyboard" from the start
await desk.click('#auth-email'); await desk.keyboard.type(creds('qa1').email);
await desk.keyboard.press('Tab'); await desk.keyboard.type(creds('qa1').password);
await desk.keyboard.press('Enter');
await desk.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(800);
await go(desk, '/paste', 2000);
await desk.click('#paste-text'); await desk.keyboard.type('עוגה');
await desk.keyboard.press('Tab'); // textarea -> parse button
const active = await desk.evaluate(() => ({ tag: document.activeElement.tagName, text: document.activeElement.textContent?.trim() }));
say('A9.desk.activeAfterTab', active);
say('A9.desk.parseBtnFocusRing', await desk.evaluate(() => {
  const e = document.activeElement; const cs = getComputedStyle(e);
  return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor };
}));
await desk.screenshot({ path: OUT + '/3b-desk-parse-focus-keyboard.png' });
fs.writeFileSync('s6-verify2.json', JSON.stringify(R, null, 1));
await browser.close();
