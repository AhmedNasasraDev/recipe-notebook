import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + '/recipe/8d123346-5d7a-469d-b856-d39828f4abc2'); await waitMain(page); await sleep(1500);
await page.locator('button[aria-label="פעולות למתכון"]').click(); await sleep(300);
await page.getByRole('menuitem', { name: 'מחיקה' }).click(); await sleep(400);
await page.getByRole('button', { name: /^אישור מחיקת/ }).click(); await sleep(2500);
console.log('cleaned up, now at:', page.url());
await browser.close();
