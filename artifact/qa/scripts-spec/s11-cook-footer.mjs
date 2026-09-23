// Real-device bug report (23.09.2026): a short cook-mode step left "הקודם / סיימתי" stranded mid-screen with a huge
// empty band below. Root cause: .foot was an ordinary flex child in .wrap (min-block-size:100dvh) with nothing
// pushing it to the true bottom. Fix: same sticky + margin-block-start:auto pattern already used by .gateBar.
import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s11';
fs.mkdirSync(OUT, { recursive: true });
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v ?? null).slice(0, 600)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + `/recipe/${id}/cook`); await waitMain(page, 'li label'); await sleep(1500);
// go through mise en place to the steps
await page.getByRole('button', { name: 'מעבר להכנה' }).click(); await sleep(1500);

// step 10 (short: the fridge-rest step, matching the user's screenshot) — jump via the segment bar
const segs = page.locator('[class*="bar"] button[aria-label^="שלב "]');
const total = await segs.count();
say('totalSteps', total);
let shortestIdx = 0, shortestLen = 1e9;
for (let i = 0; i < total; i++) { await segs.nth(i).click(); await sleep(150); const len = (await page.locator('[class*="stepText"]').innerText()).length; if (len < shortestLen) { shortestLen = len; shortestIdx = i; } }
await segs.nth(shortestIdx).click(); await sleep(600);
say('shortStep.index', shortestIdx + 1);

const foot = page.locator('nav[aria-label="ניווט בין שלבים"]');
const vh = (await page.viewportSize()).height;
const footBox = await foot.boundingBox();
say('shortStep.footBox', footBox);
say('shortStep.footAtBottomEdge', footBox ? Math.abs(footBox.y + footBox.height - vh) <= 2 : null);
say('shortStep.footPosition', await foot.evaluate((e) => getComputedStyle(e).position));
await page.screenshot({ path: OUT + '/1-short-step-before-fix-check.png' });

// a step with lots of content (timers etc.) — pick a step known to have a long instruction + temp/time chips
let longestIdx = 0, longestLen = 0;
for (let i = 0; i < total; i++) {
  await segs.nth(i).click(); await sleep(150);
  const len = (await page.locator('[class*="stepText"]').innerText()).length;
  if (len > longestLen) { longestLen = len; longestIdx = i; }
}
await segs.nth(longestIdx).click(); await sleep(600);
say('longStep.index', longestIdx + 1);
const scrollHeightBefore = await page.evaluate(() => document.querySelector('[class*="content"]')?.scrollHeight);
const footBox2 = await foot.boundingBox();
say('longStep.footBox', footBox2);
// scroll the content container to the very bottom and confirm the foot bar does not cover the last content line
await page.evaluate(() => document.querySelector('[class*="content"]')?.scrollTo(0, 999999));
await sleep(400);
const overlap = await page.evaluate(() => {
  const foot = document.querySelector('nav[aria-label="ניווט בין שלבים"]');
  const ingsSummary = document.querySelector('[class*="ingsSummary"]');
  if (!foot || !ingsSummary) return null;
  const f = foot.getBoundingClientRect(); const s = ingsSummary.getBoundingClientRect();
  return { footTop: Math.round(f.top), ingsSummaryBottom: Math.round(s.bottom), covered: s.bottom > f.top };
});
say('longStep.noOverlapWithLastContent', overlap);
await page.screenshot({ path: OUT + '/2-long-step-scrolled-to-end.png' });

fs.writeFileSync('s11-cook-footer.json', JSON.stringify(R, null, 1));
await browser.close();
