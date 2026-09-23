// Spec stage 6 (remaining cosmetic): A-9 (keyboard focus visible on the "פענוח" button) and A-13 (plain-language
// explanation of why smart parsing is unavailable), on phone and desktop.
import { launch, BASE, sleep, creds, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s6'; fs.mkdirSync(OUT, { recursive: true });
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v).slice(0, 500)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const go = async (p, u, ms = 2000) => { await p.goto(BASE + u); await waitMain(p); await sleep(ms); };

await go(page, '/paste', 2000);
// A-13: the new text, no jargon
const hint = await page.locator('main').innerText();
say('A13.newText', /פענוח חכם בעזרת בינה מלאכותית אינו זמין כרגע/.test(hint));
say('A13.noJargon', {
  proxyGone: !/שרת מתווך/.test(hint),
  rateLimitGone: !/מגבלת קצב/.test(hint),
  apiKeyGone: !/מפתח ה-API|API key/.test(hint),
});
await page.screenshot({ path: OUT + '/1-phone-paste-text.png' });

// A-9: Tab directly to the "פענוח" button and check its computed outline
await page.type('#paste-text', 'עוגה\n100 גרם קמח');
const btn = page.locator('button', { hasText: 'פענוח' });
await btn.focus();
say('A9.parseBtnFocusRing', await btn.evaluate((e) => {
  const cs = getComputedStyle(e);
  return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: cs.outlineColor };
}));
await page.screenshot({ path: OUT + '/2-phone-parse-focus.png' });

// desktop
const dctx = await browser.newContext({ viewport: DESK, locale: 'he-IL' }); const desk = await dctx.newPage();
await desk.goto(BASE + '/'); await desk.waitForSelector('#auth-email'); await desk.fill('#auth-email', creds('qa1').email); await desk.fill('#auth-password', creds('qa1').password); await desk.click('button[type=submit]'); await desk.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(800);
await go(desk, '/paste', 2000);
const dbtn = desk.locator('button', { hasText: 'פענוח' });
await dbtn.focus();
say('A9.desk.parseBtnFocusRing', await dbtn.evaluate((e) => {
  const cs = getComputedStyle(e);
  return { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth };
}));
await desk.screenshot({ path: OUT + '/3-desk-parse-focus.png' });

fs.writeFileSync('s6-verify.json', JSON.stringify(R, null, 1));
await browser.close();
