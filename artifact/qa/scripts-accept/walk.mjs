// Shared sweep helper: screenshot + text dump + automated audit for one screen state.
import fs from 'node:fs';
import path from 'node:path';
export const OUT = path.join(process.cwd(), 'walk');
export const SHOTS = '/home/user/recipe-notebook/artifact/qa/shots-accept';
fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(SHOTS, { recursive: true });
const INTERNAL = /§|\bS\d\b|\(\d{2}\)|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|undefined|NaN|\bnull\b|PGRST|TypeError|\[object|_id\b|Error:|stack/;
export async function audit(page, name, opts = {}) {
  const r = await page.evaluate(({ INTERNAL_SRC, phoneish }) => {
    const INTERNAL = new RegExp(INTERNAL_SRC);
    const vw = innerWidth, vh = innerHeight;
    const out = { overflowX: [], clipped: [], tiny: [], unnamed: [], small: [], internal: [], english: [], brokenImg: [], overlap: [], emptyBtn: [], placeholders: [] };
    const scrollers = [document.documentElement, ...document.querySelectorAll('main, .wrap, [class*="wrap"]')];
    for (const s of scrollers) if (s.scrollWidth > s.clientWidth + 2) out.overflowX.push(`${s.tagName}.${String(s.className).slice(0, 30)} ${s.scrollWidth}>${s.clientWidth}`);
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const n = walker.currentNode; const t = n.textContent.replace(/\s+/g, ' ').trim(); if (!t) continue;
      const el = n.parentElement; if (!el || el.closest('script,style,#print-root')) continue;
      const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      const rect = el.getBoundingClientRect(); if (rect.width === 0 && rect.height === 0) continue;
      const px = parseFloat(cs.fontSize);
      if (px < 12 && !el.closest('.visuallyHidden') && !seen.has('t' + t)) { seen.add('t' + t); out.tiny.push(`${t.slice(0, 30)} ${px}px`); }
      if (INTERNAL.test(t) && !seen.has('i' + t)) { seen.add('i' + t); out.internal.push(t.slice(0, 80)); }
      if (/^[A-Za-z][A-Za-z .,'/-]{3,}$/.test(t) && !/^(PDF|WebP|Mise en place|F|C|CSV|HACCP|OK)$/i.test(t) && !seen.has('e' + t)) { seen.add('e' + t); out.english.push(t.slice(0, 60)); }
      // clipped: text element whose content is wider than its box and hidden
      if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && !seen.has('c' + t)) { seen.add('c' + t); out.clipped.push(`${t.slice(0, 40)} (${el.scrollWidth}>${el.clientWidth})`); }
    }
    for (const b of document.querySelectorAll('button, a[href], input, select, textarea, [role=button]')) {
      const rect = b.getBoundingClientRect(); if (rect.width === 0 || rect.height === 0) continue;
      if (b.closest('#print-root')) continue;
      const name = (b.getAttribute('aria-label') || b.textContent || b.getAttribute('placeholder') || (b.id && document.querySelector(`label[for="${b.id}"]`)?.textContent) || b.getAttribute('title') || '').trim();
      if (!name && !['file', 'checkbox', 'radio'].includes(b.type)) out.unnamed.push(`${b.tagName}.${String(b.className).slice(0, 30)}`);
      if ((b.tagName === 'BUTTON' || b.tagName === 'A') && !b.textContent.trim() && !b.getAttribute('aria-label')) out.emptyBtn.push(String(b.className).slice(0, 30));
      if ((b.tagName === 'BUTTON' || b.tagName === 'A') && rect.height < 40 && rect.width < 40) out.small.push(`${name.slice(0, 25)} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
      if (b.tagName === 'INPUT' && !['checkbox', 'radio', 'file', 'submit', 'button'].includes(b.type) && !b.placeholder && !b.value) out.placeholders.push(name.slice(0, 30) || b.id);
    }
    for (const img of document.querySelectorAll('img')) { const r = img.getBoundingClientRect(); if (r.width > 0 && img.complete && img.naturalWidth === 0) out.brokenImg.push(img.getAttribute('src')?.slice(0, 60) ?? '?'); }
    // overlap between interactive controls
    const ctrls = [...document.querySelectorAll('button, a[href], input, select')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < vh && r.bottom > 0; });
    for (let i = 0; i < ctrls.length; i++) for (let j = i + 1; j < ctrls.length; j++) {
      if (ctrls[i].contains(ctrls[j]) || ctrls[j].contains(ctrls[i])) continue;
      const a = ctrls[i].getBoundingClientRect(), b = ctrls[j].getBoundingClientRect();
      const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ix > 8 && iy > 8) out.overlap.push(`${(ctrls[i].getAttribute('aria-label') || ctrls[i].textContent).trim().slice(0, 20)} × ${(ctrls[j].getAttribute('aria-label') || ctrls[j].textContent).trim().slice(0, 20)}`);
    }
    for (const k of Object.keys(out)) out[k] = out[k].slice(0, 12);
    return { url: location.pathname + location.search, vw, vh, text: document.body.innerText, ...out };
  }, { INTERNAL_SRC: INTERNAL.source, phoneish: true });
  const tag = `${name}-${r.vw}x${r.vh}`;
  fs.writeFileSync(path.join(OUT, `${tag}.txt`), r.text);
  const issues = Object.fromEntries(Object.entries(r).filter(([k, v]) => Array.isArray(v) && v.length));
  fs.writeFileSync(path.join(OUT, `${tag}.audit.json`), JSON.stringify({ url: r.url, ...issues }, null, 1));
  await page.screenshot({ path: path.join(SHOTS, `${tag}.png`), fullPage: opts.full !== false }).catch(() => {});
  const summary = Object.entries(issues).map(([k, v]) => `${k}:${v.length}`).join(' ');
  console.log(`[${tag}] ${r.url} ${summary || 'clean'}`);
  return r;
}
export const waitMain = (page, sel = 'main', ms = 20000) => page.waitForSelector(sel, { timeout: ms }).catch(() => {});
