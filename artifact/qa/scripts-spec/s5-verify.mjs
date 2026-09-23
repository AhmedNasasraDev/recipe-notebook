// Spec stage 5 (section 8): the ⋮ menu (U-1, U-2, §8.1–8.2) and the hero band (U-3, §8.3) on the production build,
// phone 402×874 and desktop 1440×900. Read-only on the data: nothing is saved, duplicated or deleted (the delete item
// only opens the confirmation, which is cancelled).
import { launch, BASE, sleep, creds, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const GANACHE = 'b343acb2-8fdc-4044-963d-593cacd49e52';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s5'; fs.mkdirSync(OUT, { recursive: true });
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v).slice(0, 700)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
const go = async (p, u, ms = 2500) => { await p.goto(BASE + u); await waitMain(p); await sleep(ms); };
const hex = (c) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c); return m ? '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('') : c; };
const box = async (loc) => { const b = await loc.boundingBox(); return b ? { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } : null; };

// ── U-1 / U-2 / §8.2 on the phone ──
await go(page, `/recipe/${id}`, 3500);
say('bar.controls', await page.evaluate(() => [...document.querySelectorAll('[class*="topBar"] button, [class*="topBar"] a')].map((e) => (e.getAttribute('aria-label') || e.textContent).trim())));
say('bar.printButtonGone', await page.locator('button[aria-label*="הדפסה"]').count());
say('bar.bottomPanelGone', await page.locator('summary').filter({ hasText: 'עוד פעולות' }).count());
const btn = page.locator('button[aria-label="פעולות למתכון"]');
say('menuBtn', { box: await box(btn), haspopup: await btn.getAttribute('aria-haspopup'), expanded: await btn.getAttribute('aria-expanded') });
await page.screenshot({ path: OUT + '/1-phone-recipe-top.png' });
const scrollBefore = await page.evaluate(() => document.querySelector('main')?.scrollTop ?? window.scrollY);
await btn.click(); await sleep(400);
const scrollAfter = await page.evaluate(() => document.querySelector('main')?.scrollTop ?? window.scrollY);
const menu = page.locator('[role=menu]');
const items = page.locator('[role=menuitem]');
say('menu.open', { count: await menu.count(), scrolledPx: scrollAfter - scrollBefore, expanded: await btn.getAttribute('aria-expanded'), items: await items.allInnerTexts() });
const mb = await box(menu); const vw = page.viewportSize();
say('menu.box', { ...mb, insideViewport: mb.x >= 0 && mb.y >= 0 && mb.x + mb.w <= vw.width && mb.y + mb.h <= vw.height });
say('menu.itemSizes', await items.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return `${e.textContent.trim()} ${Math.round(r.width)}×${Math.round(r.height)}`; })));
say('menu.deleteStyle', await items.last().evaluate((e) => ({ text: e.textContent.trim(), color: getComputedStyle(e).color, isLast: e === [...document.querySelectorAll('[role=menuitem]')].at(-1), separatorBefore: !!e.previousElementSibling && e.previousElementSibling.getAttribute('role') === 'separator' })));
say('menu.bg', await menu.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, z: getComputedStyle(e).zIndex })));
say('menu.focusOnOpen', await page.evaluate(() => document.activeElement?.textContent?.trim()));
await page.screenshot({ path: OUT + '/2-phone-menu-open.png' });
// keyboard: arrows, Escape returns focus
await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
say('menu.afterTwoArrowDown', await page.evaluate(() => document.activeElement?.textContent?.trim()));
await page.keyboard.press('End'); say('menu.afterEnd', await page.evaluate(() => document.activeElement?.textContent?.trim()));
await page.keyboard.press('Escape'); await sleep(200);
say('menu.escape', { menuCount: await menu.count(), focusOnButton: await page.evaluate(() => document.activeElement?.getAttribute('aria-label')) });
// outside click closes
await btn.click(); await sleep(200); await page.mouse.click(200, 600); await sleep(200);
say('menu.outsideClickCloses', (await menu.count()) === 0);
// keyboard open with ArrowDown on the button, Enter activates
await btn.focus(); await page.keyboard.press('ArrowDown'); await sleep(200);
say('menu.openByArrow', await menu.count());
await page.keyboard.press('Escape');
// delete → confirmation at the top, then cancel
await btn.click(); await sleep(200); await items.last().click(); await sleep(400);
const dlg = page.locator('[role=alertdialog]');
say('delete.confirm', { count: await dlg.count(), box: await box(dlg), text: (await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 80) });
await page.screenshot({ path: OUT + '/3-phone-delete-confirm.png' });
await page.getByRole('button', { name: 'ביטול המחיקה' }).click(); await sleep(200);
say('delete.cancelled', (await dlg.count()) === 0);
// share (headless: no navigator.share → clipboard)
await btn.click(); await sleep(200); await page.getByRole('menuitem', { name: 'שיתוף' }).click(); await sleep(600);
say('share', { status: (await page.locator('[class*="menuStatus"]').innerText().catch(() => 'none')).trim(), clipboardStart: (await page.evaluate(() => navigator.clipboard.readText().catch(() => 'unreadable'))).slice(0, 60) });
await page.screenshot({ path: OUT + '/4-phone-share-status.png' });
// photo → scrolls to the gallery
const yBefore = await page.evaluate(() => document.querySelector('main')?.scrollTop ?? window.scrollY);
await btn.click(); await sleep(200); await page.getByRole('menuitem', { name: 'תמונה' }).click(); await sleep(900);
say('photo.scrolls', { before: yBefore, after: await page.evaluate(() => document.querySelector('main')?.scrollTop ?? window.scrollY), galleryInView: await page.evaluate(() => { const r = document.getElementById('recipe-images')?.getBoundingClientRect(); return r ? r.top >= 0 && r.top < window.innerHeight : null; }) });
// menu items are real links / print item exists
await go(page, `/recipe/${id}`, 2500); await btn.click(); await sleep(200);
say('menu.links', await page.evaluate(() => [...document.querySelectorAll('[role=menuitem][href]')].map((a) => a.textContent.trim() + ' → ' + a.getAttribute('href'))));
await page.keyboard.press('Escape');

// ── U-3 hero ──
say('hero.phone', await page.evaluate(() => { const img = document.querySelector('[class*="heroPhoto"]'); const main = document.querySelector('main').getBoundingClientRect(); const r = img?.getBoundingClientRect(); return img ? { height: Math.round(r.height), width: Math.round(r.width), mainWidth: Math.round(main.width), objectFit: getComputedStyle(img).objectFit, titleBelow: (document.querySelector('h1')?.getBoundingClientRect().top ?? 0) > r.bottom } : null; }));
await go(page, `/recipe/${GANACHE}`, 3000);
say('hero.noImage', await page.evaluate(() => { const f = document.querySelector('[class*="heroFallback"]'); if (!f) return null; const cs = getComputedStyle(f); const r = f.getBoundingClientRect(); return { height: Math.round(r.height), width: Math.round(r.width), bg: cs.backgroundColor, borderBottom: cs.borderBottomColor, text: f.textContent.trim(), hasSvg: !!f.querySelector('svg') }; }));
await page.screenshot({ path: OUT + '/5-phone-no-image.png' });
await page.route('**/storage/v1/object/sign/**', (route) => route.abort('failed'));
await go(page, `/recipe/${id}`, 3500);
say('hero.brokenLink', await page.evaluate(() => ({ fallback: !!document.querySelector('[class*="heroFallback"]'), photo: !!document.querySelector('[class*="heroPhoto"]'), text: document.querySelector('[class*="heroFallback"]')?.textContent.trim() })));
await page.screenshot({ path: OUT + '/6-phone-broken-link.png' });
await page.unroute('**/storage/v1/object/sign/**');

// ── desktop ──
const dctx = await browser.newContext({ viewport: DESK, locale: 'he-IL' }); const desk = await dctx.newPage();
await desk.goto(BASE + '/'); await desk.waitForSelector('#auth-email'); await desk.fill('#auth-email', creds('qa1').email); await desk.fill('#auth-password', creds('qa1').password); await desk.click('button[type=submit]'); await desk.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(800);
await go(desk, `/recipe/${id}`, 3500);
say('hero.desk', await desk.evaluate(() => { const img = document.querySelector('[class*="heroPhoto"]'); const r = img?.getBoundingClientRect(); const main = document.querySelector('main').getBoundingClientRect(); return img ? { height: Math.round(r.height), width: Math.round(r.width), mainWidth: Math.round(main.width) } : null; }));
await desk.screenshot({ path: OUT + '/7-desk-recipe-top.png' });
const dbtn = desk.locator('button[aria-label="פעולות למתכון"]'); await dbtn.click(); await sleep(300);
const dm = await box(desk.locator('[role=menu]')); const dvw = desk.viewportSize();
say('menu.deskBox', { ...dm, insideViewport: dm.x >= 0 && dm.y >= 0 && dm.x + dm.w <= dvw.width && dm.y + dm.h <= dvw.height });
await desk.screenshot({ path: OUT + '/8-desk-menu-open.png' });
await desk.keyboard.press('Escape');
await go(desk, `/recipe/${GANACHE}`, 3000);
say('hero.deskNoImage', await desk.evaluate(() => { const f = document.querySelector('[class*="heroFallback"]'); return f ? Math.round(f.getBoundingClientRect().height) : null; }));
await desk.screenshot({ path: OUT + '/9-desk-no-image.png' });
fs.writeFileSync('s5-verify.json', JSON.stringify(R, null, 1));
await browser.close();
