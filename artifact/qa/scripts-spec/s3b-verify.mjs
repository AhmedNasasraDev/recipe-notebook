// Spec stage 3ב: A-6 trial log on the recipe page (add, persists after reload, remove) and A-5 backup download from
// settings (file name, JSON shape, counts). Test data only: the log entries are written to a QA recipe and removed.
import { launch, BASE, sleep, creds, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s3b'; fs.mkdirSync(OUT, { recursive: true });
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v).slice(0, 700)); };
const GANACHE = 'b343acb2-8fdc-4044-963d-593cacd49e52';
const { browser, page, errors } = await launch({ storageState: 'state-qa1.json' });
const go = async (p, u, sel = 'main', ms = 1800) => { await p.goto(BASE + u); await waitMain(p, sel); await sleep(ms); };
const openPro = async (p) => { const s = p.locator('summary').filter({ hasText: 'פרטים מקצועיים' }); if (!(await p.locator('details[open] summary').filter({ hasText: 'פרטים מקצועיים' }).count())) await s.click(); await sleep(500); };
const logText = async (p) => (await p.locator('section[aria-label="יומן ניסויים"]').innerText()).replace(/\s+/g, ' ');
const trialWrites = []; page.on('request', (r) => { if (/rest\/v1\/trials/.test(r.url())) trialWrites.push(`${r.request ? '' : ''}${r.method()} ${r.url().replace(/^https:\/\/[^/]+/, '').slice(0, 90)}`); });

// ── A-6 ──
await go(page, `/recipe/${GANACHE}`); await openPro(page);
const log = page.locator('section[aria-label="יומן ניסויים"]');
say('A6.cardPresent', await log.count());
say('A6.before', await logText(page));
const box = await log.boundingBox(); await page.evaluate((y) => window.scrollTo(0, y - 80), box?.y ?? 0); await sleep(300);
await page.screenshot({ path: OUT + '/A6-1-log-empty-phone.png' });
await log.locator('input[type=date]').fill('2026-09-21');
await log.locator('textarea').fill('בדיקה-QA ניסוי 1 — נמס מהר מדי, לקרר יותר');
await log.getByRole('button', { name: 'הוספה ליומן' }).click(); await sleep(2500);
say('A6.afterAdd', await logText(page));
say('A6.hitTargets', await log.evaluate((s) => [...s.querySelectorAll('button, input, textarea')].map((e) => { const r = e.getBoundingClientRect(); return `${(e.getAttribute('aria-label') || e.textContent || e.type).trim().slice(0, 18)} ${Math.round(r.width)}×${Math.round(r.height)}`; })));
await page.screenshot({ path: OUT + '/A6-2-log-added-phone.png' });
await page.reload(); await waitMain(page); await sleep(1500); await openPro(page);
say('A6.afterReload', await logText(page));
// second entry, then remove the first
await log.locator('input[type=date]').fill('2026-09-22'); await log.locator('textarea').fill('בדיקה-QA ניסוי 2 — תקין'); await log.getByRole('button', { name: 'הוספה ליומן' }).click(); await sleep(2500);
say('A6.twoEntriesOrder', await log.locator('li').allInnerTexts());
await log.getByRole('button', { name: /^הסרת הרשומה מ21 בספטמבר 2026/ }).click(); await sleep(300);
say('A6.confirmText', (await log.locator('[role=group][aria-label="אישור הסרה"]').innerText()).replace(/\s+/g, ' '));
await page.screenshot({ path: OUT + '/A6-3-remove-confirm-phone.png' });
await log.getByRole('button', { name: 'כן, להסיר' }).click(); await sleep(2500);
say('A6.afterRemove', await log.locator('li').allInnerTexts());
await page.reload(); await waitMain(page); await sleep(1500); await openPro(page);
say('A6.afterRemoveReload', await log.locator('li').allInnerTexts());
// editor must not touch the log: open editor, save without changes to stage 4, check log intact
await go(page, `/recipe/${GANACHE}/edit`); await page.getByRole('button', { name: /^שלב 4 / }).click(); await sleep(300);
await page.getByRole('button', { name: 'שמירת השינויים' }).click(); await sleep(3000);
await openPro(page); say('A6.afterEditorSave', await log.locator('li').allInnerTexts());
// cleanup: remove the remaining test entry
await log.getByRole('button', { name: /^הסרת הרשומה מ22 בספטמבר 2026/ }).click(); await sleep(300); await log.getByRole('button', { name: 'כן, להסיר' }).click(); await sleep(2500);
say('A6.afterCleanup', await logText(page));
say('A6.trialRequests', trialWrites);

// ── A-5 ──
await go(page, '/settings');
const card = page.locator('section[aria-label="גיבוי וייצוא"]');
say('A5.cardText', (await card.innerText()).replace(/\s+/g, ' ').slice(0, 400));
const cb = await card.boundingBox(); await page.evaluate((y) => window.scrollTo(0, y - 80), cb?.y ?? 0); await sleep(300);
await page.screenshot({ path: OUT + '/A5-1-settings-card-phone.png' });
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), card.getByRole('button', { name: 'הורדת גיבוי (JSON)' }).click()]);
const file = OUT + '/backup-sample.json'; await dl.saveAs(file);
say('A5.fileName', dl.suggestedFilename());
await sleep(800); say('A5.status', (await card.locator('[role=status]').innerText()).trim());
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
say('A5.json', { format: j.format, version: j.version, exportedAt: j.exportedAt, email: j.account?.email, recipes: j.recipes.length, names: j.recipes.map((r) => r.name), catalog: j.catalog.length, plans: j.plans.length, planNames: j.plans.map((p) => p.name), hasVersions: j.recipes.some((r) => 'versions' in r), hasUpdatedAt: j.recipes.some((r) => 'updatedAt' in r), withPrivateNote: j.recipes.filter((r) => r.privateNote).length, firstRecipeKeys: Object.keys(j.recipes[0]).slice(0, 30), bytes: fs.statSync(file).size });
await page.screenshot({ path: OUT + '/A5-2-after-download-phone.png' });
say('pageErrors', errors.slice(0, 5));
// desktop
const dctx = await browser.newContext({ viewport: DESK, locale: 'he-IL', acceptDownloads: true }); const desk = await dctx.newPage();
await desk.goto(BASE + '/'); await desk.waitForSelector('#auth-email'); await desk.fill('#auth-email', creds('qa1').email); await desk.fill('#auth-password', creds('qa1').password); await desk.click('button[type=submit]'); await desk.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(800);
await go(desk, `/recipe/${GANACHE}`); await openPro(desk); const dl2 = desk.locator('section[aria-label="יומן ניסויים"]'); const b2 = await dl2.boundingBox(); await desk.evaluate((y) => window.scrollTo(0, y - 120), b2?.y ?? 0); await sleep(300);
await desk.screenshot({ path: OUT + '/A6-4-log-desk.png' });
await go(desk, '/settings'); const c2 = await desk.locator('section[aria-label="גיבוי וייצוא"]').boundingBox(); await desk.evaluate((y) => window.scrollTo(0, y - 120), c2?.y ?? 0); await sleep(300);
await desk.screenshot({ path: OUT + '/A5-3-settings-desk.png' });
fs.writeFileSync('s3b-verify.json', JSON.stringify(R, null, 1));
await browser.close();
