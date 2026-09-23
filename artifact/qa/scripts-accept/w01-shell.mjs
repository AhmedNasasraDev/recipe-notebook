// Sweep 1 (qa1, data present): home, notebook (+search, filter, favourites), more, settings, tools, ingredients, plans, groups list — phone and desktop.
import { launch, BASE, sleep, PHONE, DESK } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
const errs = [];
for (const vp of [PHONE, DESK]) {
  const { browser, page, errors, net } = await launch({ viewport: vp, storageState: 'state-qa1.json' });
  const go = async (u, sel) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(1800); };
  await go('/home'); await audit(page, 'home');
  await go('/notebook'); await audit(page, 'notebook');
  await page.fill('input[placeholder*="חיפוש"]', 'בריוש').catch(() => {}); await sleep(600); await audit(page, 'notebook-search', { full: false });
  await page.fill('input[placeholder*="חיפוש"]', 'זזזז').catch(() => {}); await sleep(600); await audit(page, 'notebook-search-none', { full: false });
  await page.fill('input[placeholder*="חיפוש"]', '').catch(() => {});
  await page.getByRole('button', { name: 'גנאשים ורטבים' }).first().click().catch(() => {}); await sleep(600); await audit(page, 'notebook-filter', { full: false });
  await page.getByRole('button', { name: 'קרמים ומילויים' }).first().click().catch(() => {}); await sleep(600); await audit(page, 'notebook-filter-empty', { full: false });
  await go('/more'); await audit(page, 'more');
  await go('/settings'); await audit(page, 'settings');
  await go('/tools'); await audit(page, 'tools');
  await go('/ingredients'); await audit(page, 'ingredients');
  await page.getByRole('button', { name: /חומר גלם חדש|הוספת חומר גלם/ }).first().click().catch(() => {}); await sleep(400); await audit(page, 'ingredients-add-form');
  await go('/plans'); await audit(page, 'plans');
  await go('/groups'); await audit(page, 'groups');
  await page.getByRole('button', { name: 'קבוצה חדשה' }).click().catch(() => {}); await sleep(400); await audit(page, 'groups-create-form', { full: false });
  errs.push(...errors.map((e) => `${vp.width}: ${e}`), ...net.filter((n) => n.s >= 400).map((n) => `${vp.width}: ${n.m} ${n.u.slice(0, 80)} ${n.s}`));
  await browser.close();
}
console.log('ERRORS/NET:', errs.slice(0, 12));
