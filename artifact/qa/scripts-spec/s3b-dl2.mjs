import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + '/settings'); await waitMain(page); await sleep(1500);
const card = page.locator('section[aria-label="גיבוי וייצוא"]');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), card.getByRole('button', { name: 'הורדת גיבוי (JSON)' }).click()]);
console.log(JSON.stringify({ fileName: dl.suggestedFilename(), status: (await card.locator('[role=status]').innerText()).trim() }));
await browser.close();
