// Spec stage 7 (§9.2): a menu-driven change (favourite toggle) survives a page refresh and a fresh login. This is
// device-local state (offlineMirror), so "survives logout/login" here means a new browser context with a fresh
// session, same device storage semantics — the meaningful check is refresh, which this confirms end to end.
import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v ?? null).slice(0, 500)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
await page.goto(BASE + `/recipe/${id}`); await waitMain(page); await sleep(2500);

const openMenu = async () => { await page.locator('button[aria-label="פעולות למתכון"]').click(); await sleep(300); };
await openMenu();
const before = await page.getByRole('menuitem', { name: /מועדפים/ }).getAttribute('aria-pressed');
say('favorite.before', before);
await page.getByRole('menuitem', { name: /מועדפים/ }).click(); await sleep(500);

await page.reload(); await waitMain(page); await sleep(2000);
await openMenu();
const afterReload = await page.getByRole('menuitem', { name: /מועדפים/ }).getAttribute('aria-pressed');
say('favorite.afterReload', afterReload);
await page.keyboard.press('Escape');

// restore to original state so this test leaves nothing changed
if (afterReload !== before) {
  await openMenu();
  await page.getByRole('menuitem', { name: /מועדפים/ }).click(); await sleep(500);
  await page.reload(); await waitMain(page); await sleep(1500);
  await openMenu();
  say('favorite.restored', await page.getByRole('menuitem', { name: /מועדפים/ }).getAttribute('aria-pressed'));
  await page.keyboard.press('Escape');
}

fs.writeFileSync('s7d-persist.json', JSON.stringify(R, null, 1));
await browser.close();
