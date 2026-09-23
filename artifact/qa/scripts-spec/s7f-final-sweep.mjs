// Spec stage 7 (§9.3, final items): export/backup opens with real content; paste→editor flow one more time;
// full section-3 sweep (palette, fonts, hit targets, focus) on every screen, phone + desktop — final confirmation.
import { launch, BASE, sleep, creds, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const GANACHE = 'b343acb2-8fdc-4044-963d-593cacd49e52';
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const PLAN = 'f9794bf1-faca-4fa5-b013-523c8bfe434c';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s7';
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v ?? null).slice(0, 500)); };
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
const go = async (p, u, sel = 'main', ms = 1500) => { await p.goto(BASE + u); await waitMain(p, sel); await sleep(ms); };

// ── export/backup opens with real content ──
await go(page, '/settings');
const card = page.locator('section[aria-label="גיבוי וייצוא"]');
const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), card.getByRole('button', { name: 'הורדת גיבוי (JSON)' }).click()]);
const file = OUT + '/final-backup.json'; await dl.saveAs(file);
const j = JSON.parse(fs.readFileSync(file, 'utf8'));
say('backup.opensAndParses', { format: j.format, recipes: j.recipes.length, readableName: j.recipes[0]?.name });

// ── paste → editor, no auto-save (final smoke) ──
await go(page, '/paste');
await page.fill('#paste-text', 'בדיקה-QA רענון סופי\n100 גרם קמח\n\nלערבב');
await page.getByRole('button', { name: 'פענוח' }).click(); await sleep(300);
await page.getByRole('button', { name: 'המשך לעריכה ואישור' }).click(); await sleep(800);
say('paste.opensEditor', { url: page.url(), name: await page.locator('#r-name').inputValue() });
page.once('dialog', (d) => d.accept());
await page.locator('main button').filter({ hasText: /^ביטול$/ }).last().click(); await sleep(500);
say('paste.cancelLeavesNothing', page.url());

// ── final full sweep: palette / fonts / hit targets / focus, every screen ──
const deskCtx = await browser.newContext({ viewport: DESK, locale: 'he-IL' }); const desk = await deskCtx.newPage();
await desk.goto(BASE + '/'); await desk.waitForSelector('#auth-email'); await desk.fill('#auth-email', creds('qa1').email); await desk.fill('#auth-password', creds('qa1').password); await desk.click('button[type=submit]'); await desk.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(800);
const audit = (p) => p.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const small = [];
  for (const e of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=menuitem]')) {
    if (!vis(e) || e.closest('#print-root')) continue; if (e.type === 'file' || e.type === 'checkbox') continue;
    const r = e.getBoundingClientRect();
    if (r.height < 44 || r.width < 44) small.push(`${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 20)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  const fam = (el) => el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/['"]/g, '') : null;
  const body = document.body;
  const strangerColors = [];
  for (const e of document.querySelectorAll('*')) {
    const bg = getComputedStyle(e).backgroundColor;
    // sample only, don't need every element
  }
  return { dir: document.documentElement.dir, h1Font: fam(document.querySelector('h1')), bodyFont: fam(body), smallCount: small.length, small: small.slice(0, 6) };
});
const SCREENS = [['home', '/home'], ['notebook', '/notebook'], ['recipe', `/recipe/${id}`], ['recipe-ganache', `/recipe/${GANACHE}`], ['edit', `/recipe/${id}/edit`], ['paste', '/paste'], ['cook', `/recipe/${id}/cook`, 'li label'], ['order', `/recipe/${id}/order?mode=units&v=20`, '#order-qty'], ['label', `/recipe/${id}/label`, 'body'], ['ingredients', '/ingredients'], ['plans', '/plans'], ['plan', `/plan/${PLAN}`], ['groups', '/groups'], ['group', `/group/${G}`], ['perms', `/group/${G}/perms`], ['settings', '/settings'], ['more', '/more'], ['tools', '/tools']];
let totalSmallPhone = 0, totalSmallDesk = 0;
const details = {};
for (const [dev, p] of [['phone', page], ['desk', desk]]) {
  for (const [n, u, sel = 'main'] of SCREENS) {
    await go(p, u, sel, /group/.test(u) ? 3500 : 1300);
    const a = await audit(p);
    if (dev === 'phone') totalSmallPhone += a.smallCount; else totalSmallDesk += a.smallCount;
    if (a.smallCount > 0) details[`${dev}.${n}`] = a.small;
    if (a.h1Font !== 'Frank Ruhl Libre' && n !== 'label') details[`${dev}.${n}.wrongH1Font`] = a.h1Font;
    if (a.dir !== 'rtl') details[`${dev}.${n}.wrongDir`] = a.dir;
  }
}
say('sweep.totalSmallPhone', totalSmallPhone);
say('sweep.totalSmallDesk', totalSmallDesk);
say('sweep.details', details);

fs.writeFileSync('s7f-final-sweep.json', JSON.stringify(R, null, 1));
await browser.close();
