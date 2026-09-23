// Clean, top-of-page screenshots of the stage-4 design on phone and desktop (the audit's own shots are mid-scroll).
import { launch, BASE, sleep, creds, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s4';
const { browser, page: phone } = await launch({ storageState: 'state-qa1.json' });
const deskCtx = await browser.newContext({ viewport: DESK, locale: 'he-IL' }); const desk = await deskCtx.newPage();
await desk.goto(BASE + '/'); await desk.waitForSelector('#auth-email'); await desk.fill('#auth-email', creds('qa1').email); await desk.fill('#auth-password', creds('qa1').password); await desk.click('button[type=submit]'); await desk.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(800);
const go = async (p, u, ms = 2000) => { await p.goto(BASE + u); await waitMain(p); await sleep(ms); };
for (const [dev, p] of [['phone', phone], ['desk', desk]]) {
  for (const [n, u] of [['home', '/home'], ['recipe', `/recipe/${id}`], ['settings', '/settings'], ['notebook', '/notebook']]) {
    await go(p, u, /recipe/.test(u) ? 3500 : 2000);
    await p.screenshot({ path: `${OUT}/clean-${dev}-${n}.png` });
  }
}
// the disabled state and a warning banner: the edit screen's stage bar + the recipe's partial-cost line
await browser.close();
