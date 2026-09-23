// Spec stage 4 audit: palette (§3.1), fonts (§3.2), 44px targets and visible focus (§3.4), on every screen,
// phone 402×874 and desktop 1440×900. Same screens and the same audit as the stage-1 scan, so the counts compare.
import { launch, BASE, sleep, creds, DESK } from './drv.mjs';
import { waitMain } from './walk.mjs';
import fs from 'node:fs';
import path from 'node:path';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const GANACHE = 'b343acb2-8fdc-4044-963d-593cacd49e52';
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const PLAN = 'f9794bf1-faca-4fa5-b013-523c8bfe434c';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-spec-s4'; fs.mkdirSync(OUT, { recursive: true });
const R = {}; const say = (k, v) => { R[k] = v; console.log(k + ': ' + JSON.stringify(v).slice(0, 600)); };
const fontReqs = [];
const { browser, page: phone } = await launch({ storageState: 'state-qa1.json' });
phone.on('request', (r) => { if (/\.woff2?(\?|$)/.test(r.url())) fontReqs.push(r.url().replace(BASE, '')); });
const deskCtx = await browser.newContext({ viewport: DESK, locale: 'he-IL' }); const desk = await deskCtx.newPage();
await desk.goto(BASE + '/'); await desk.waitForSelector('#auth-email'); await desk.fill('#auth-email', creds('qa1').email); await desk.fill('#auth-password', creds('qa1').password); await desk.click('button[type=submit]'); await desk.waitForSelector('nav[aria-label="ניווט ראשי"]', { timeout: 30000 }); await sleep(800);
const go = async (p, u, sel = 'main', ms = 1500) => { await p.goto(BASE + u); await waitMain(p, sel); await sleep(ms); };
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + '.png') });
const audit = (p) => p.evaluate(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const small = [];
  for (const e of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab]')) {
    if (!vis(e) || e.closest('#print-root')) continue; if (e.type === 'file') continue;
    const r = e.getBoundingClientRect();
    if (r.height < 44 || r.width < 44) small.push(`${(e.getAttribute('aria-label') || e.textContent || e.placeholder || e.type || '').trim().slice(0, 22)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  }
  const fam = (el) => el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/['"]/g, '') : null;
  const fonts = { h1: fam(document.querySelector('h1')), h2: fam(document.querySelector('h2')), body: fam(document.body), button: fam(document.querySelector('main button, button')), input: fam(document.querySelector('input')) };
  const hex = (c) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c); return m ? '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('') : c; };
  const main = document.querySelector('main'); const h1 = document.querySelector('h1');
  const filled = [...document.querySelectorAll('button')].map((b) => hex(getComputedStyle(b).backgroundColor)).filter((c) => c !== '#000000' && c !== 'rgba(0, 0, 0, 0)');
  const colours = { body: hex(getComputedStyle(document.body).backgroundColor), main: main ? hex(getComputedStyle(main).backgroundColor) : null, h1: h1 ? hex(getComputedStyle(h1).color) : null, buttonFills: [...new Set(filled)].slice(0, 6) };
  const frl = document.fonts.check('16px "Frank Ruhl Libre"'); const heebo = document.fonts.check('16px "Heebo"');
  // focus: first ENABLED button and first link and first input
  const ring = (el) => { if (!el) return null; el.focus(); const cs = getComputedStyle(el); const r = { outlineStyle: cs.outlineStyle, outlineWidth: cs.outlineWidth, outlineColor: hex(cs.outlineColor) }; el.blur(); return r; };
  const focus = { button: ring([...document.querySelectorAll('button:not([disabled])')].find(vis)), link: ring([...document.querySelectorAll('a[href]')].find(vis)), input: ring([...document.querySelectorAll('input:not([disabled]), textarea:not([disabled])')].find(vis)) };
  return { dir: document.documentElement.dir, fonts, fontsLoaded: { frl, heebo }, colours, smallCount: small.length, small: [...new Set(small)].slice(0, 14), focus };
});
const SCREENS = [['home', '/home'], ['notebook', '/notebook'], ['recipe', `/recipe/${id}`], ['recipe-ganache', `/recipe/${GANACHE}`], ['edit', `/recipe/${id}/edit`], ['paste', '/paste'], ['cook', `/recipe/${id}/cook`, 'li label'], ['order', `/recipe/${id}/order?mode=units&v=20`, '#order-qty'], ['label', `/recipe/${id}/label`, 'body'], ['ingredients', '/ingredients'], ['plans', '/plans'], ['plan', `/plan/${PLAN}`], ['groups', '/groups'], ['group', `/group/${G}`], ['perms', `/group/${G}/perms`], ['settings', '/settings'], ['more', '/more'], ['tools', '/tools']];
const totals = { phone: 0, desk: 0 };
for (const [dev, p] of [['phone', phone], ['desk', desk]]) {
  for (const [n, u, sel = 'main'] of SCREENS) {
    await go(p, u, sel, /group/.test(u) ? 4000 : 1500);
    const a = await audit(p); totals[dev] += a.smallCount;
    say(`${dev}.${n}`, a);
    await shot(p, `${dev}-${n}`);
  }
}
say('totals', totals);
say('fontRequests', [...new Set(fontReqs)]);
// focus ring, drawn: tab to the first control on the paste screen and photograph it
await go(phone, '/paste'); await phone.keyboard.press('Tab'); await phone.keyboard.press('Tab'); await sleep(200);
say('paste.activeAfterTab', await phone.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { tag: e.tagName, label: (e.getAttribute('aria-label') || e.textContent || e.id || '').trim().slice(0, 30), outline: cs.outlineStyle + ' ' + cs.outlineWidth }; }));
await shot(phone, 'focus-ring-paste');
fs.writeFileSync('s4-audit.json', JSON.stringify(R, null, 1));
await browser.close();
