// Sweep 4: signed-out screens, sign-in validation, wrong password, sign-up, password change, sign-out, onboarding re-run.
import { launch, BASE, sleep, PHONE, DESK, text, creds } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
const errs = [];
for (const vp of [PHONE, DESK]) {
  const { browser, page, errors } = await launch({ viewport: vp });
  const go = async (u, sel = 'body') => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(1800); };
  await go('/'); await audit(page, 'auth-signin');
  await page.click('button[type=submit]').catch(() => {}); await sleep(600); await audit(page, 'auth-signin-empty', { full: false });
  await page.fill('#auth-email', 'not-an-email'); await page.fill('#auth-password', '123'); await page.click('button[type=submit]'); await sleep(800); await audit(page, 'auth-signin-badformat', { full: false });
  await page.fill('#auth-email', creds('qa1').email); await page.fill('#auth-password', 'wrong-password-123'); await page.click('button[type=submit]'); await sleep(3000); await audit(page, 'auth-wrong-password', { full: false });
  await page.getByRole('button', { name: /הרשמה/ }).first().click().catch(() => {}); await sleep(500); await audit(page, 'auth-signup');
  await page.fill('#auth-email', 'x'); await page.fill('#auth-password', '12'); await page.click('button[type=submit]'); await sleep(800); await audit(page, 'auth-signup-invalid', { full: false });
  await go('/recipe/abc'); await audit(page, 'signed-out-deep-link', { full: false });
  await go('/join/sometoken'); await audit(page, 'signed-out-join', { full: false });
  errs.push(...errors.map((e) => `${vp.width}: ${e}`));
  await browser.close();
}
// signed-in: settings → change password (validation), sign out, sign in back, onboarding re-run
{
  const { browser, page, errors } = await launch({ storageState: 'state-qa2.json' });
  const go = async (u, sel = 'main') => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(1800); };
  await go('/settings');
  await page.getByRole('button', { name: 'שינוי סיסמה' }).click(); await sleep(400); await audit(page, 'settings-change-password', { full: false });
  await page.getByRole('button', { name: /שמירת הסיסמה|החלפת הסיסמה|שינוי הסיסמה/ }).last().click().catch(() => {}); await sleep(600); await audit(page, 'settings-change-password-empty', { full: false });
  const pw = page.locator('input[type=password]');
  if (await pw.count() >= 2) { await pw.nth(0).fill('wrong-current'); await pw.nth(1).fill('newpass123'); if (await pw.count() > 2) await pw.nth(2).fill('newpass123'); await page.getByRole('button', { name: /שמירת הסיסמה|החלפת הסיסמה|שינוי הסיסמה/ }).last().click().catch(() => {}); await sleep(3000); await audit(page, 'settings-change-password-wrongcurrent', { full: false }); }
  await page.getByRole('button', { name: 'לעבור שוב על שאלות הפתיחה' }).click().catch(() => {}); await sleep(1200); await audit(page, 'onboarding-q1');
  await page.getByRole('button', { name: /מקצועי/ }).first().click().catch(() => {}); await page.getByRole('button', { name: 'המשך' }).click().catch(() => {}); await sleep(300); await audit(page, 'onboarding-q2');
  await page.getByRole('button', { name: 'המשך' }).click().catch(() => {}); await sleep(300); await audit(page, 'onboarding-q3');
  await page.getByRole('button', { name: /סיום/ }).click().catch(() => {}); await sleep(2000); await audit(page, 'onboarding-done', { full: false });
  await go('/settings'); await page.getByRole('button', { name: 'התנתקות' }).click(); await sleep(2500); await audit(page, 'after-signout', { full: false });
  await page.fill('#auth-email', creds('qa2').email); await page.fill('#auth-password', creds('qa2').password); await page.click('button[type=submit]'); await sleep(3500); await audit(page, 'after-signin-back', { full: false });
  errs.push(...errors.map((e) => `qa2: ${e}`));
  await browser.close();
}
console.log('ERRORS:', errs.slice(0, 10));
