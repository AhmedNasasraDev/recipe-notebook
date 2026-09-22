import { launch, sleep, creds } from './drv.mjs';
import fs from 'node:fs';
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const BASE = 'http://127.0.0.1:5200';
const { browser, page } = await launch({});
await page.goto(BASE + '/'); await page.waitForSelector('#auth-email');
await page.fill('#auth-email', creds('qa1').email); await page.fill('#auth-password', creds('qa1').password); await page.click('button[type=submit]');
await page.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(1000);
const times = [];
for (let i = 0; i < 3; i++) {
  const t0 = Date.now();
  await page.goto(BASE + `/group/${G}`); await page.waitForSelector('text=חברים והרשאות', { timeout: 30000 }); times.push(Date.now() - t0);
  await page.goto(BASE + '/home'); await sleep(800);
}
const t1 = Date.now(); await page.goto(BASE + '/groups'); await page.waitForSelector('text=בדיקה-QA קבוצה סבב 2'); const t2 = Date.now(); await page.locator('a[href*="/group/"]').first().click(); await page.waitForSelector('text=חברים והרשאות', { timeout: 30000 }); const inApp = Date.now() - t2;
console.log(JSON.stringify({ productionBuild: true, coldNavigationsMs: times, listToGroupMs: inApp }));
await browser.close();
