// Basic accessibility and narrow-width checks on the screens touched in this round.
import { launch, BASE, sleep, shot, check, results } from './drv.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const { browser, page, errors } = await launch({ viewport: { width: 360, height: 740 }, storageState: 'state-qa1.json' });
const audit = (label) => page.evaluate((label) => {
  const out = { label, unnamed: [], small: [], tiny: [], overflow: document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('main, .wrap')].some((m) => m.scrollWidth > m.clientWidth + 1) };
  for (const b of document.querySelectorAll('button, a[href], input, select, textarea')) {
    const r = b.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    const name = (b.getAttribute('aria-label') || b.textContent || b.getAttribute('placeholder') || (b.id && document.querySelector(`label[for="${b.id}"]`)?.textContent) || '').trim();
    if (!name && b.type !== 'file' && b.type !== 'checkbox') out.unnamed.push(`${b.tagName}:${b.className.toString().slice(0, 30)}`);
    if (b.tagName === 'BUTTON' || b.tagName === 'A') { if (r.height < 44 && r.width < 44) out.small.push(`${name.slice(0, 25)} ${Math.round(r.width)}×${Math.round(r.height)}`); }
  }
  for (const el of document.querySelectorAll('main p, main span, main li, main td, main label, .wrap p, .wrap span, .wrap li')) {
    const px = parseFloat(getComputedStyle(el).fontSize); const r = el.getBoundingClientRect();
    if (r.width && px < 12 && (el.textContent || '').trim()) out.tiny.push(`${(el.textContent || '').trim().slice(0, 20)} ${px}px`);
  }
  out.tiny = [...new Set(out.tiny)].slice(0, 6); out.small = out.small.slice(0, 8); out.unnamed = out.unnamed.slice(0, 8);
  return out;
}, label);
const focusRing = () => page.evaluate(() => { const b = document.querySelector('button[aria-label^="הדפסה"]'); if (!b) return null; b.focus(); const cs = getComputedStyle(b); return { outline: cs.outlineStyle, w: cs.outlineWidth }; });

await page.goto(BASE + `/recipe/${id}`); await page.waitForSelector('main'); await sleep(2500);
let a = await audit('recipe@360');
check('A01', 'recipe @360: no horizontal overflow', !a.overflow, JSON.stringify(a));
check('A02', 'recipe @360: every control has an accessible name', a.unnamed.length === 0, a.unnamed.join(' | '));
check('A03', 'recipe @360: no text under 12px', a.tiny.length === 0, a.tiny.join(' | '));
const tb = await page.locator('button[aria-label="הדפסה או שמירה כ-PDF של המתכון"]').boundingBox();
check('A04', 'recipe @360: print button fits and is ≥44px tall', tb && tb.height >= 44 && tb.x >= 0 && tb.x + tb.width <= 360, JSON.stringify(tb));
await shot(page, 'W23-recipe-360');
await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
const fr = await page.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { tag: e.tagName, name: e.getAttribute('aria-label') || e.textContent?.trim().slice(0, 20), outline: cs.outlineStyle, ow: cs.outlineWidth }; });
check('A05', 'keyboard focus is visible on the top-bar controls', fr && fr.outline !== 'none' && parseFloat(fr.ow) >= 2, JSON.stringify(fr));

await page.goto(BASE + `/recipe/${id}/cook`); await page.waitForSelector('li label', { timeout: 20000 }); await sleep(300);
a = await audit('cook@360');
check('A06', 'cook @360: no overflow, named controls, no tiny text', !a.overflow && a.unnamed.length === 0 && a.tiny.length === 0, JSON.stringify(a));
await shot(page, 'W24-cook-360');

await page.goto(BASE + `/recipe/${id}/order?mode=units&v=20`); await page.waitForSelector('#order-qty', { timeout: 20000 }); await sleep(300);
a = await audit('order@360');
check('A07', 'order @360: no overflow, named controls, no tiny text', !a.overflow && a.unnamed.length === 0 && a.tiny.length === 0, JSON.stringify(a));
await shot(page, 'W25-order-360');

// contrast of the timer clock on its card (running)
await page.goto(BASE + `/recipe/${id}/cook`); await page.waitForSelector('li label', { timeout: 20000 });
await page.getByRole('button', { name: /מעבר להכנה|מתחילים בהכנה/ }).click(); await sleep(500);
await page.getByRole('button', { name: 'שלב 2' }).click();
await page.getByRole('button', { name: /הפעלת טיימר/ }).click(); await sleep(800);
const contrast = await page.evaluate(() => {
  const lum = (c) => { const [r, g, b] = c.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const clock = [...document.querySelectorAll('[aria-label="טיימרים"] .ltr')].find((e) => /^\d+:\d\d/.test(e.textContent));
  const card = clock.closest('[role]');
  const fg = getComputedStyle(clock).color, bg = getComputedStyle(card).backgroundColor;
  const l1 = lum(fg), l2 = lum(bg); return { fg, bg, ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100 };
});
check('A08', 'timer clock contrast ≥ 7:1 on its card', contrast.ratio >= 7, JSON.stringify(contrast));
console.log('errors:', errors.slice(0, 5));
console.log(JSON.stringify(results.filter(r => r.pass === false)));
await browser.close();
