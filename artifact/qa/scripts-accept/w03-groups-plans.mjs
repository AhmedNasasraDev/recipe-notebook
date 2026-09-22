// Sweep 3: plans (list, page, new), groups (page tabs, perms, chat), join screens, qa2 member views.
import { launch, BASE, sleep, PHONE, DESK, text, creds } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
import fs from 'node:fs';
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const errs = [];
for (const vp of [PHONE, DESK]) {
  const { browser, page, errors, net } = await launch({ viewport: vp, storageState: 'state-qa1.json' });
  const go = async (u, sel = 'main') => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(2000); };
  await go('/plans'); const planHref = await page.locator('a[href^="/plan/"]').first().getAttribute('href').catch(() => null);
  if (planHref) { await go(planHref); await audit(page, 'plan');
    for (const tab of ['חומרי גלם נדרשים', 'רשימת רכש ועלות צפויה', 'סדר עבודה ולוח זמנים']) { await page.getByRole('button', { name: tab }).click().catch(() => {}); await sleep(500); await audit(page, 'plan-' + tab.split(' ')[0]); }
  }
  await go('/plan/new'); await audit(page, 'plan-new');
  await page.getByRole('button', { name: 'הוספת מוצר לתוכנית' }).click().catch(() => {}); await sleep(300); await audit(page, 'plan-new-row', { full: false });
  await page.getByRole('button', { name: 'שמירת התוכנית' }).click().catch(() => {}); await sleep(800); await audit(page, 'plan-new-validation', { full: false });
  await go(`/group/${G}`); await audit(page, 'group');
  for (const tab of ['שיעורים', 'צ׳אט', 'חברים והרשאות']) { await page.getByRole('button', { name: tab }).click().catch(() => {}); await sleep(600); await audit(page, 'group-' + tab.replace(/\s.*/, '')); }
  await page.fill('#chat-draft', 'בדיקה-QA הודעה מהמדריך').catch(() => {}); await page.getByRole('button', { name: 'שליחה' }).click().catch(() => {}); await sleep(2000); await audit(page, 'group-chat-sent', { full: false });
  await go(`/group/${G}/perms`); await audit(page, 'perms');
  await go('/join/not-a-real-token'); await audit(page, 'join-bad');
  await go('/recipe/00000000-0000-0000-0000-000000000000'); await audit(page, 'recipe-missing');
  await go('/group/00000000-0000-0000-0000-000000000000'); await audit(page, 'group-missing');
  await go('/plan/00000000-0000-0000-0000-000000000000'); await audit(page, 'plan-missing');
  await go('/no-such-route'); await audit(page, 'route-unknown', { full: false });
  errs.push(...errors.map((e) => `${vp.width}: ${e}`), ...net.filter((n) => n.s >= 400).map((n) => `${vp.width}: ${n.m} ${n.u.slice(0, 80)} ${n.s}`));
  await browser.close();
}
// qa2: member view, empty notebook, empty plans/ingredients, groups as member, group page, chat reply
{
  const { browser, page, errors, net } = await launch({ storageState: 'state-qa2.json' });
  const go = async (u, sel = 'main') => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(2000); };
  await go('/home'); await audit(page, 'qa2-home');
  await go('/notebook'); await audit(page, 'qa2-notebook-empty');
  await go('/plans'); await audit(page, 'qa2-plans-empty');
  await go('/ingredients'); await audit(page, 'qa2-ingredients-empty');
  await go('/tools'); await audit(page, 'qa2-tools');
  await go('/groups'); await audit(page, 'qa2-groups');
  await go(`/group/${G}`); await audit(page, 'qa2-group');
  await page.getByRole('button', { name: 'צ׳אט' }).click().catch(() => {}); await sleep(800); await audit(page, 'qa2-group-chat');
  await page.getByRole('button', { name: 'שיעורים' }).click().catch(() => {}); await sleep(600); await audit(page, 'qa2-group-lessons', { full: false });
  await go(`/group/${G}/perms`); await audit(page, 'qa2-perms');
  errs.push(...errors.map((e) => `qa2: ${e}`), ...net.filter((n) => n.s >= 400).map((n) => `qa2: ${n.m} ${n.u.slice(0, 80)} ${n.s}`));
  await browser.close();
}
console.log('ERRORS/NET:', errs.slice(0, 15));
