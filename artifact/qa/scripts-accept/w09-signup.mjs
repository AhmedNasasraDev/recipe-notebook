// New-user flow: sign up qa3 (fresh browser), see the confirmation message; the verification mail is read separately.
import { launch, BASE, sleep, text, creds } from './drv.mjs';
import { audit } from './walk.mjs';
const { browser, page, errors, net } = await launch();
await page.goto(BASE + '/'); await sleep(1500);
await page.getByRole('button', { name: /הרשמה/ }).first().click(); await sleep(400);
await page.fill('#auth-email', 'nasasraah+qa3@gmail.com'); await page.fill('#auth-password', creds('qa1').password);
await page.click('button[type=submit]'); await sleep(4500);
await audit(page, 'signup-submitted', { full: false });
console.log('signup text:', (await text(page)).slice(0, 400));
console.log('net:', net.filter((n) => n.u.includes('/auth/')).map((n) => `${n.m} ${n.u.slice(0, 60)} ${n.s}`));
await browser.close();
