// Sweep 5 (qa1): loading states, network failures on load/save/delete, join with a bad token, convert & calibrate sheets,
// delete dialog, duplicate, favourite, recents on home, versions after an edit, chat via the real tab role.
import { launch, BASE, sleep, text } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const { browser, page, errors, net } = await launch({ storageState: 'state-qa1.json' });
const go = async (u, sel = 'main') => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(1800); };
// loading: slow down the recipes request and capture the interim screen
await page.route('**/rest/v1/recipes?*', async (route) => { await sleep(3500); await route.continue(); });
await page.goto(BASE + '/notebook'); await sleep(1200); await audit(page, 'notebook-loading', { full: false });
await sleep(3500); await page.unroute('**/rest/v1/recipes?*');
// network failure on the notebook load
await page.route('**/rest/v1/recipes?*', (route) => route.abort('failed'));
await page.goto(BASE + '/notebook'); await sleep(3000); await audit(page, 'notebook-load-failed');
await page.unroute('**/rest/v1/recipes?*');
// network failure on image list + private note
await page.route('**/rest/v1/recipe_images?*', (route) => route.abort('failed'));
await page.route('**/rest/v1/private_notes?*', (route) => route.abort('failed'));
await go(`/recipe/${id}`); await sleep(1500); await audit(page, 'recipe-images-note-failed');
await page.unroute('**/rest/v1/recipe_images?*'); await page.unroute('**/rest/v1/private_notes?*');
// delete failure on a recipe (abort the rpc) → dialog stays with a Hebrew message
await go(`/recipe/${id}`);
await page.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(400);
await page.getByRole('button', { name: /^מחיקת בדיקה-QA/ }).click(); await sleep(400); await audit(page, 'recipe-delete-dialog', { full: false });
await page.route('**/rest/v1/rpc/delete_recipe*', (route) => route.abort('failed'));
await page.getByRole('button', { name: /^כן, למחוק|^למחוק$|מחיקה סופית/ }).first().click().catch(() => {}); await sleep(2500); await audit(page, 'recipe-delete-failed', { full: false });
await page.unroute('**/rest/v1/rpc/delete_recipe*');
await page.getByRole('button', { name: /ביטול/ }).last().click().catch(() => {});
// convert sheet (row button contains the ingredient name) + calibrate
await page.getByRole('button', { name: /קמח לחם/ }).first().click().catch(() => {}); await sleep(600); await audit(page, 'convert-sheet', { full: false });
await page.getByRole('button', { name: /כיול|לכייל/ }).first().click().catch(() => {}); await sleep(500); await audit(page, 'calibrate-sheet', { full: false });
await page.keyboard.press('Escape'); await sleep(300);
await page.getByRole('button', { name: /^סגירה$|^סגור$/ }).first().click().catch(() => {}); await sleep(300);
// favourite + home recents
await page.getByRole('button', { name: /הוספה למועדפים/ }).click().catch(() => {}); await sleep(500); await audit(page, 'recipe-favourited', { full: false });
await go('/home'); await audit(page, 'home-after-visit');
// versions after an edit: change a step time and save
await go(`/recipe/${id}/edit`); await page.getByRole('button', { name: /שלב 3 מתוך/ }).click(); await sleep(300);
await page.locator('[aria-label^="זמן בדקות בשלב"]').nth(0).fill('9'); await page.getByRole('button', { name: /שלב 4 מתוך/ }).click(); await sleep(300);
await page.getByRole('button', { name: 'שמירת השינויים' }).click(); await sleep(3500); await audit(page, 'recipe-after-edit', { full: false });
await page.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).click(); await sleep(600);
const t = await text(page); fs.writeFileSync('walk/versions-text.txt', t.slice(t.indexOf('גרסאות')));
await page.getByRole('button', { name: /השוואה|הצגת הבדלים|מה השתנה/ }).first().click().catch(() => {}); await sleep(500); await audit(page, 'versions-compare', { full: false });
// join with a bad token: press the button
await go('/join/not-a-real-token'); await page.getByRole('button', { name: 'הצטרפות לקבוצה' }).click(); await sleep(2500); await audit(page, 'join-bad-pressed', { full: false });
// chat via the real tab role
await go(`/group/${G}`); await page.getByRole('tab', { name: 'צ׳אט' }).click().catch(async () => { await page.getByText('צ׳אט').first().click(); }); await sleep(800); await audit(page, 'group-chat-tab');
await page.fill('#chat-draft', 'בדיקה-QA הודעה מהמדריך').catch(() => {}); await page.getByRole('button', { name: 'שליחה' }).click().catch(() => {}); await sleep(2000); await audit(page, 'group-chat-sent2', { full: false });
await page.getByRole('tab', { name: 'שיעורים' }).click().catch(() => {}); await sleep(500);
await page.getByRole('button', { name: /הוספת קורס|קורס חדש/ }).first().click().catch(() => {}); await sleep(400); await audit(page, 'group-course-form', { full: false });
console.log('ERRORS:', errors.filter((e) => !/ERR_FAILED|40[04]/.test(e)).slice(0, 8));
console.log('NET 4xx/5xx:', net.filter((n) => n.s >= 400).map((n) => `${n.m} ${n.u.slice(0, 70)} ${n.s}`).slice(0, 8));
await browser.close();
