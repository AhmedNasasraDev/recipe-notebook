// A-4: the first save of a pasted draft records the version note "יובא מהדבקת טקסט". Captures the save_recipe payload.
import { launch, BASE, sleep } from './drv.mjs';
import { waitMain } from './walk.mjs';
const TEXT = ['בדיקה-QA הערת גרסה', '500 גרם קמח לחם', '11 גרם מלח', '', 'ללוש 12 דקות'].join('\n');
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const go = async (u, sel = 'main', ms = 1500) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };
const payloads = []; page.on('request', (r) => { if (/rpc\/save_recipe/.test(r.url())) { try { const b = JSON.parse(r.postData() || '{}'); payloads.push({ p_version_note: b.p_version_note, id: b.p_recipe?.id ?? b.p_id ?? null, keys: Object.keys(b) }); } catch { payloads.push({ raw: (r.postData() || '').slice(0, 200) }); } } });
await go('/paste'); await page.fill('#paste-text', TEXT); await page.getByRole('button', { name: 'פענוח' }).click(); await sleep(300);
await page.getByRole('button', { name: 'המשך לעריכה ואישור' }).click(); await sleep(800);
await page.getByRole('button', { name: /^שלב 4 / }).click(); await sleep(300);
await page.getByRole('button', { name: 'שמירת המתכון' }).click(); await sleep(3500);
const rid = page.url().split('/recipe/')[1]?.split(/[/?]/)[0];
console.log(JSON.stringify({ recipe: rid, savePayloads: payloads }, null, 1));
// clean up (test recipe only)
await page.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(300);
await page.getByRole('button', { name: /^מחיקת בדיקה-QA/ }).first().click(); await sleep(400);
await page.locator('button:has-text("כן, למחוק")').first().click(); await sleep(3000);
console.log('cleanup url:', page.url());
await browser.close();
