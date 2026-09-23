// Spec stage 1: scan only. Verifies U-1..U-3, and checks every screen against section 3 (fonts, RTL, 44px hit
// targets, focus) and section 8 (menu behaviour, hero), on phone 402×874 and desktop 1440×900. No code changes.
import { launch, BASE, sleep, creds, PHONE, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
import path from 'node:path';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const GANACHE = 'b343acb2-8fdc-4044-963d-593cacd49e52';
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const PLAN = 'f9794bf1-faca-4fa5-b013-523c8bfe434c';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s1';
fs.mkdirSync(OUT, { recursive: true });
const R = {};
const say = (k, v) => { R[k] = v; console.log(k + ': ' + (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 700)); };
const body = async (p) => (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();
const { browser, page: phone } = await launch({ storageState: 'state-qa1.json' });
const deskCtx = await browser.newContext({ viewport: DESK, locale: 'he-IL' }); const desk = await deskCtx.newPage();
await desk.goto(BASE + '/'); await desk.waitForSelector('#auth-email'); await desk.fill('#auth-email', creds('qa1').email); await desk.fill('#auth-password', creds('qa1').password); await desk.click('button[type=submit]'); await desk.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(800);
const go = async (p, u, sel = 'main', ms = 1800) => { await p.goto(BASE + u); await waitMain(p, sel); await sleep(ms); };
const shot = (p, name, full = false) => p.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });

// generic per-screen audit: fonts, dir, hit targets < 44, focus outline, numbers count
const audit = (p) => p.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const small = [];
  for (const e of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab]')) {
    if (!vis(e) || e.closest('#print-root')) continue;
    if (e.type === 'file') continue;
    const r = e.getBoundingClientRect();
    if (r.height < 44 || r.width < 44) small.push(`${(e.getAttribute('aria-label') || e.textContent || e.placeholder || e.type || '').trim().slice(0, 22)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  const fonts = {};
  for (const sel of ['h1', 'h2', 'body', 'button', 'input']) { const el = document.querySelector(sel); if (el) fonts[sel] = getComputedStyle(el).fontFamily.split(',')[0].replace(/['"]/g, ''); }
  const dir = document.documentElement.dir || getComputedStyle(document.body).direction;
  // focus ring: focus the first button and read outline
  const b = [...document.querySelectorAll('button, a[href]')].find(vis);
  let focus = null;
  if (b) { b.focus(); const cs = getComputedStyle(b); focus = { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow.slice(0, 40) }; b.blur(); }
  return { dir, fonts, smallCount: small.length, small: [...new Set(small)].slice(0, 14), focus };
});

const SCREENS = [['home', '/home', 'main'], ['notebook', '/notebook', 'main'], ['recipe', `/recipe/${id}`, 'main'], ['recipe-ganache', `/recipe/${GANACHE}`, 'main'], ['edit', `/recipe/${id}/edit`, 'main'], ['paste', '/paste', 'main'], ['cook', `/recipe/${id}/cook`, 'li label'], ['order', `/recipe/${id}/order?mode=units&v=20`, '#order-qty'], ['label', `/recipe/${id}/label`, 'body'], ['ingredients', '/ingredients', 'main'], ['plans', '/plans', 'main'], ['plan', `/plan/${PLAN}`, 'main'], ['groups', '/groups', 'main'], ['group', `/group/${G}`, 'main'], ['perms', `/group/${G}/perms`, 'main'], ['settings', '/settings', 'main'], ['more', '/more', 'main'], ['tools', '/tools', 'main']];
for (const [dev, p] of [['phone', phone], ['desk', desk]]) {
  for (const [n, u, sel] of SCREENS) {
    await go(p, u, sel, /group/.test(u) ? 4000 : 1500);
    const a = await audit(p);
    say(`${dev}.${n}`, a);
    await shot(p, `${dev}-${n}`, false);
  }
}

// ── U-1 / U-2 / U-3 and section 8 on the recipe screen (phone) ──
await go(phone, `/recipe/${id}`); await phone.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {}); await sleep(500);
say('U1.bottomMore', await phone.locator('summary').filter({ hasText: 'עוד פעולות' }).count());
const menuBtn = phone.locator('button[aria-label="עוד פעולות על המתכון"]');
say('U1.topMenuButton', { count: await menuBtn.count(), box: await menuBtn.boundingBox(), ariaHasPopup: await menuBtn.getAttribute('aria-haspopup'), ariaExpanded: await menuBtn.getAttribute('aria-expanded') });
const scrollBefore = await phone.evaluate(() => document.querySelector('main')?.scrollTop ?? window.scrollY);
await menuBtn.click(); await sleep(900);
const scrollAfter = await phone.evaluate(() => document.querySelector('main')?.scrollTop ?? window.scrollY);
say('U1.clickResult', { menuRoleCount: await phone.locator('[role=menu]').count(), scrolledPx: Math.round(scrollAfter - scrollBefore), bottomPanelOpen: await phone.locator('details[open] summary').filter({ hasText: 'עוד פעולות' }).count() });
await shot(phone, 'U1-after-menu-click');
// keyboard: Escape closes? focus returns?
await phone.keyboard.press('Escape'); await sleep(300);
say('U1.escape', { bottomPanelStillOpen: await phone.locator('details[open] summary').filter({ hasText: 'עוד פעולות' }).count(), activeEl: await phone.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.tagName) });
// actions inventory under "עוד פעולות" and elsewhere on the screen
say('U1.actionsInventory', await phone.evaluate(() => [...document.querySelectorAll('main button, main a[href], main summary')].map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 40)).filter((t) => /עריכה|שכפול|מחיק|הדפסה|תווית|דף הזמנה|מצב הכנה|מועדפים|תמונה|שיתוף|עוד פעולות|המחברת/.test(t))));
// U-2 print button size at top
const printTop = phone.locator('button[aria-label="הדפסה או שמירה כ-PDF של המתכון"]');
say('U2.printTop', { box: await printTop.boundingBox(), text: (await printTop.innerText()).trim(), bg: await printTop.evaluate((e) => getComputedStyle(e).backgroundColor) });
// U-3 hero
say('U3.hero', await phone.evaluate(() => { const h = document.querySelector('[class*="hero"]'); const img = h?.querySelector('img'); if (!h) return { hero: false }; const r = h.getBoundingClientRect(); const main = document.querySelector('main').getBoundingClientRect(); return { hero: true, width: Math.round(r.width), mainWidth: Math.round(main.width), height: Math.round(r.height), img: !!img, objectFit: img ? getComputedStyle(img).objectFit : null, objectPosition: img ? getComputedStyle(img).objectPosition : null, imgLoaded: img ? img.complete && img.naturalWidth > 0 : null, titleAbove: (document.querySelector('h1')?.getBoundingClientRect().top ?? 0) < r.top }; }));
await shot(phone, 'U3-hero-phone');
await go(desk, `/recipe/${id}`); await desk.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {}); await sleep(500);
say('U3.heroDesk', await desk.evaluate(() => { const h = document.querySelector('[class*="hero"]'); if (!h) return { hero: false }; const r = h.getBoundingClientRect(); const main = document.querySelector('main').getBoundingClientRect(); return { width: Math.round(r.width), mainWidth: Math.round(main.width), height: Math.round(r.height) }; }));
await shot(desk, 'U3-hero-desk');
// no image → fallback?
await go(phone, `/recipe/${GANACHE}`);
say('U3.noImage', await phone.evaluate(() => ({ hero: !!document.querySelector('[class*="hero"]'), imagesSectionText: (document.body.innerText.match(/אין תמונות למתכון הזה|הוספת תמונה/g) || []).join(' | ') })));
await shot(phone, 'U3-no-image');
// broken image (signed URL blocked) → what shows?
await phone.route('**/storage/v1/object/sign/**', (route) => route.abort('failed'));
await go(phone, `/recipe/${id}`, 'main', 3000);
say('U3.brokenImage', await phone.evaluate(() => ({ hero: !!document.querySelector('[class*="hero"]'), brokenImgIcon: [...document.querySelectorAll('img')].some((i) => i.complete && i.naturalWidth === 0 && i.getBoundingClientRect().width > 0), message: (document.body.innerText.match(/התמונה לא נמצאה בשרת[^.]*\.|התמונה אינה זמינה[^.]*\./) || ['none'])[0] })));
await shot(phone, 'U3-broken-image');
await phone.unroute('**/storage/v1/object/sign/**');
// section 3.3: numbers visible on the recipe page outside "פרטים מקצועיים"; hydration/DDT on a non-dough recipe
await go(phone, `/recipe/${id}`);
say('S33.numbersOutsidePro', await phone.evaluate(() => { const det = [...document.querySelectorAll('details')].find((d) => /פרטים מקצועיים/.test(d.textContent)); const txt = [...document.querySelectorAll('main *')].filter((e) => !det?.contains(e) && e.children.length === 0 && e.textContent.trim()).map((e) => e.textContent.trim()); const nums = txt.filter((t) => /\d/.test(t)); return { lines: txt.length, withNumbers: nums.length, sample: nums.slice(0, 12) }; }));
await go(phone, `/recipe/${GANACHE}`); await phone.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).click().catch(() => {}); await sleep(500);
const gb = await body(phone);
say('S33.ganacheProDetails', { hydration: /הידרציה/.test(gb), ddt: /DDT|טמפרטורת בצק/.test(gb), category: (gb.match(/גנאשים ורטבים|בצקים|קרמים/) || ['?'])[0] });
await go(phone, `/recipe/${id}`); await phone.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).click().catch(() => {}); await sleep(500);
const bb = await body(phone);
say('S33.briocheProDetails', { hydration: /הידרציה/.test(bb), ddt: /DDT|טמפרטורת בצק/.test(bb) });
// 5.1 paste flow: does the parse result open in the editor, or save directly?
await go(phone, '/paste');
say('S51.pasteButtons', await phone.evaluate(() => [...document.querySelectorAll('main button')].map((b) => b.textContent.trim()).filter(Boolean)));
say('S51.pasteText', (await body(phone)).slice(0, 400));
fs.writeFileSync('s1-scan.json', JSON.stringify(R, null, 1));
await browser.close();
