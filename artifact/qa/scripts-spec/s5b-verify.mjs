// Spec stage 5b (§3.3): the disclosure is now labelled "נתוני ייצור ועלויות" (production and cost data), one
// button, holding everything: pan, food cost, costing panel, yield/loss, formula (dough only), allergens, version
// history, trial log. Checks the label, that no cost/production figures remain outside it, and DDT/hydration gating.
import { launch, BASE, sleep, creds, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const GANACHE = 'b343acb2-8fdc-4044-963d-593cacd49e52';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s5b'; fs.mkdirSync(OUT, { recursive: true });
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v).slice(0, 700)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const go = async (p, u, ms = 2500) => { await p.goto(BASE + u); await waitMain(p); await sleep(ms); };
const body = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();

await go(page, `/recipe/${id}`, 3000);
say('label.exists', await page.locator('summary').filter({ hasText: 'נתוני ייצור ועלויות' }).count());
say('label.oldGone', await page.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).count());
await page.screenshot({ path: OUT + '/1-phone-closed.png' });

// numbers outside the disclosure (the open page), excluding the ingredients list and steps (the recipe itself)
say('outside.beforeOpen', await page.evaluate(() => {
  const det = document.querySelector('details');
  const main = document.querySelector('main') || document.body;
  const txt = [...main.querySelectorAll('*')]
    .filter((e) => !det?.contains(e) && e.children.length === 0 && e.textContent.trim())
    .map((e) => e.textContent.trim());
  return txt.filter((t) => /\d/.test(t));
}));

// open it: everything a professional needs should be here
await page.locator('summary').filter({ hasText: 'נתוני ייצור ועלויות' }).click(); await sleep(600);
const b = await body(page);
say('inside.hasFoodCost', /פוד קוסט/.test(b));
say('inside.hasYieldLoss', /תשואה ופחת/.test(b));
say('inside.hasFormula', /נוסחה/.test(b) && /הידרציה/.test(b));
say('inside.hasAllergens', /לא זוהו אלרגנים|מכיל:/.test(b));
say('inside.hasVersions', /גרסאות|אין עוד היסטוריה/.test(b));
say('inside.hasTrialLog', /יומן ניסויים/.test(b));
await page.screenshot({ path: OUT + '/2-phone-open.png', fullPage: true });

// DDT/hydration only on dough recipes (ganache should NOT show it)
await go(page, `/recipe/${GANACHE}`, 2500);
await page.locator('summary').filter({ hasText: 'נתוני ייצור ועלויות' }).click(); await sleep(600);
const gb = await body(page);
say('ganache.noHydration', !/הידרציה/.test(gb));
say('ganache.noFormula', !/נוסחה/.test(gb));
say('ganache.hasFoodCost', /פוד קוסט/.test(gb));

// desktop
const dctx = await browser.newContext({ viewport: DESK, locale: 'he-IL' }); const desk = await dctx.newPage();
await desk.goto(BASE + '/'); await desk.waitForSelector('#auth-email'); await desk.fill('#auth-email', creds('qa1').email); await desk.fill('#auth-password', creds('qa1').password); await desk.click('button[type=submit]'); await desk.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(800);
await go(desk, `/recipe/${id}`, 2500);
say('desk.label', await desk.locator('summary').filter({ hasText: 'נתוני ייצור ועלויות' }).count());
await desk.screenshot({ path: OUT + '/3-desk-closed.png' });
await desk.locator('summary').filter({ hasText: 'נתוני ייצור ועלויות' }).click(); await sleep(600);
await desk.screenshot({ path: OUT + '/4-desk-open.png' });

fs.writeFileSync('s5b-verify.json', JSON.stringify(R, null, 1));
await browser.close();
