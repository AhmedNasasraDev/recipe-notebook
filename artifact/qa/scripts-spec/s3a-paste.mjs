// Spec stage 3א, A-4: paste → parse → "המשך לעריכה ואישור" opens the editor with the draft; cancel leaves no recipe;
// save creates it (persists after reload, version note "יובא מהדבקת טקסט"); the test recipe is then deleted.
import { launch, BASE, sleep, creds, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s3a'; fs.mkdirSync(OUT, { recursive: true });
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v).slice(0, 600)); };
const TEXT = ['בדיקה-QA בריוש מהדבקה', '500 גרם קמח לחם', '60 מ"ל חלב', '11 גרם מלח', '', 'ללוש 12 דקות במהירות בינונית', 'לאפות 20 דקות ב-180 מעלות'].join('\n');
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const go = async (p, u, sel = 'main', ms = 1800) => { await p.goto(BASE + u); await waitMain(p, sel); await sleep(ms); };
const countRecipes = async (p) => { await go(p, '/notebook'); return (await p.locator('main').innerText()).match(/(\d+) מתכונים/)?.[1] ?? null; };
const writes = []; page.on('request', (r) => { if (/rest\/v1\/rpc\/save_recipe/.test(r.url())) writes.push(r.url().replace(/^https:\/\/[^/]+/, '')); });

say('countBefore', await countRecipes(page));
await go(page, '/paste');
await page.fill('#paste-text', TEXT); await page.getByRole('button', { name: 'פענוח' }).click(); await sleep(500);
say('pasteButtons', await page.evaluate(() => [...document.querySelectorAll('main button')].map((b) => b.textContent.trim()).filter(Boolean)));
say('pasteHint', (await page.locator('main').innerText()).match(/שום דבר לא נשמר[^.]*\./)?.[0] ?? 'missing');
await page.screenshot({ path: OUT + '/A4-1-paste-parsed-phone.png', fullPage: true });
await page.getByRole('button', { name: 'המשך לעריכה ואישור' }).click(); await sleep(1200);
say('editorUrl', page.url());
say('editorHeading', await page.locator('h1').first().innerText());
say('editorName', await page.locator('#r-name').inputValue());
await page.screenshot({ path: OUT + '/A4-2-editor-stage1-phone.png' });
await page.getByRole('button', { name: /^שלב 2 / }).click(); await sleep(400);
say('editorRows', await page.evaluate(() => [...document.querySelectorAll('input[aria-label^="שם הרכיב בשורה"]')].map((i, n) => `${i.value}|${document.querySelector(`input[aria-label="כמות של ${i.value}"]`)?.value}|${document.querySelector(`select[aria-label="יחידת המדידה של ${i.value}"]`)?.value}`)));
await page.screenshot({ path: OUT + '/A4-3-editor-stage2-phone.png' });
await page.getByRole('button', { name: /^שלב 3 / }).click(); await sleep(400);
say('editorSteps', await page.evaluate(() => [...document.querySelectorAll('main textarea')].map((t) => t.value).filter(Boolean)));
say('saveCallsSoFar', writes.length);
// cancel: the unsaved-changes question must be asked, and nothing saved
page.once('dialog', async (d) => { say('cancelDialog', d.message()); await d.accept(); });
await page.getByRole('button', { name: /^שלב 4 / }).click(); await sleep(300);
await page.locator('main button').filter({ hasText: /^ביטול$/ }).last().click(); await sleep(1500);
say('afterCancelUrl', page.url());
say('countAfterCancel', await countRecipes(page));
say('saveCallsAfterCancel', writes.length);
// again, and save this time
await go(page, '/paste'); await page.fill('#paste-text', TEXT); await page.getByRole('button', { name: 'פענוח' }).click(); await sleep(400);
await page.getByRole('button', { name: 'המשך לעריכה ואישור' }).click(); await sleep(1000);
await page.getByRole('button', { name: /^שלב 4 / }).click(); await sleep(300);
await page.getByRole('button', { name: 'שמירת המתכון' }).click(); await sleep(4000);
say('afterSaveUrl', page.url());
const rid = page.url().split('/recipe/')[1]?.split(/[/?]/)[0];
say('saveCallsAfterSave', writes.length);
await page.reload(); await waitMain(page); await sleep(1500);
say('recipeAfterReload', { title: await page.locator('h1').first().innerText(), hasFlour: /קמח לחם/.test(await page.locator('main').innerText()) });
await page.screenshot({ path: OUT + '/A4-4-saved-recipe-phone.png' });
await page.locator('summary').filter({ hasText: 'עוד פעולות' }).click().catch(() => {}); await sleep(300);
const vh = page.locator('section[aria-label="היסטוריית גרסאות"]');
say('versionHistory', (await vh.count()) ? (await vh.innerText()).replace(/\s+/g, ' ').slice(0, 300) : 'not on screen');
say('countAfterSave', await countRecipes(page));
// clean up the test recipe (destructive test on test data only)
await go(page, `/recipe/${rid}`);
await page.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(300);
await page.getByRole('button', { name: /^מחיקת בדיקה-QA/ }).first().click(); await sleep(400);
await page.locator('button:has-text("כן, למחוק")').first().click(); await sleep(3000);
say('countAfterCleanup', await countRecipes(page));
// a reload of /recipe/new must NOT replay the paste
await go(page, '/recipe/new'); say('plainNewIsEmpty', (await page.locator('#r-name').inputValue()) === '');
// desktop
const dctx = await browser.newContext({ viewport: DESK, locale: 'he-IL' }); const desk = await dctx.newPage();
await desk.goto(BASE + '/'); await desk.waitForSelector('#auth-email'); await desk.fill('#auth-email', creds('qa1').email); await desk.fill('#auth-password', creds('qa1').password); await desk.click('button[type=submit]'); await desk.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(800);
await go(desk, '/paste'); await desk.fill('#paste-text', TEXT); await desk.getByRole('button', { name: 'פענוח' }).click(); await sleep(400);
await desk.screenshot({ path: OUT + '/A4-5-paste-parsed-desk.png', fullPage: true });
await desk.getByRole('button', { name: 'המשך לעריכה ואישור' }).click(); await sleep(1000);
say('deskEditor', { url: desk.url(), name: await desk.locator('#r-name').inputValue() });
await desk.screenshot({ path: OUT + '/A4-6-editor-desk.png' });
desk.once('dialog', (d) => d.accept());
await desk.locator('main button').filter({ hasText: /^ביטול$/ }).last().click(); await sleep(800);
fs.writeFileSync('s3a-paste.json', JSON.stringify(R, null, 1));
await browser.close();
