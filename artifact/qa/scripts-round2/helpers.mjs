import { sleep, text } from './drv.mjs';
// Click through the onboarding if it appears (it reappears on every load while the load bug stands).
export async function passOnboarding(page) {
  const b = await text(page);
  if (!b.includes('איך נוח לכם לעבוד')) return false;
  await page.getByRole('button', { name: /מקצועי/ }).first().click();
  await page.getByRole('button', { name: 'המשך' }).click(); await sleep(250);
  await page.getByRole('button', { name: 'המשך' }).click(); await sleep(250);
  await page.getByRole('button', { name: /סיום/ }).click(); await sleep(2500);
  return true;
}
export async function alerts(page) {
  return (await page.locator('[role=alert]').allInnerTexts()).map((s) => s.replace(/\s+/g, ' '));
}
