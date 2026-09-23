// Sweep 6: PDFs (recipe, order, label) text + visual; landscape, 360 and tablet layouts of the main screens.
import { launch, BASE, sleep, text } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const parse = (await import('/tmp/claude-0/-home-user-recipe-notebook/c3a9fa06-9b8e-56e2-96b0-42c6561963e9/scratchpad/pdftool/node_modules/pdf-parse/lib/pdf-parse.js')).default;
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-accept';
const { browser, page } = await launch({ storageState: 'state-qa1.json' });
const pdfOf = async (url, name, sheet) => {
  await page.goto(BASE + url); await waitMain(page, 'body'); await sleep(2500); await page.waitForSelector('img[aria-hidden="true"]', { timeout: 8000 }).catch(() => {});
  await page.emulateMedia({ media: 'print' });
  if (sheet) { await page.evaluate(() => window.dispatchEvent(new Event('beforeprint'))); await sleep(700); }
  const pdf = await page.pdf({ format: 'A4', printBackground: true, path: `${OUT}/${name}.pdf` });
  await page.setViewportSize({ width: 794, height: 1123 }); await page.screenshot({ path: `${OUT}/${name}-print-view.png`, fullPage: true }); await page.setViewportSize({ width: 402, height: 874 });
  if (sheet) await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  const info = await parse(pdf); const t = info.text.replace(/\s+/g, ' ');
  fs.writeFileSync(`walk/${name}.pdf.txt`, t);
  console.log(`${name}: pages=${info.numpages} chars=${t.length} internal=${JSON.stringify((t.match(/§|\(\d\d\)|S\d\b|undefined|NaN|null|[0-9a-f]{8}-[0-9a-f]{4}/g) || []).slice(0, 5))}`);
};
await pdfOf(`/recipe/${id}`, 'pdf-recipe', true);
await pdfOf(`/recipe/${id}?mode=units&v=6`, 'pdf-recipe-scaled', true);
await pdfOf(`/recipe/${id}/order?mode=units&v=20`, 'pdf-order', false);
await pdfOf(`/recipe/${id}/label`, 'pdf-label', false);
await pdfOf(`/recipe/${id}/cook`, 'pdf-cook', true);
// layouts
for (const vp of [{ w: 874, h: 402, n: 'land' }, { w: 360, h: 740, n: '360' }, { w: 820, h: 1180, n: 'tab' }]) {
  await page.setViewportSize({ width: vp.w, height: vp.h });
  for (const [u, n, sel] of [['/home', 'home', 'main'], ['/notebook', 'notebook', 'main'], [`/recipe/${id}`, 'recipe', 'main'], [`/recipe/${id}/edit`, 'edit', 'main'], [`/recipe/${id}/cook`, 'cook', 'li label'], [`/recipe/${id}/order?mode=units&v=20`, 'order', '#order-qty'], ['/plans', 'plans', 'main'], ['/settings', 'settings', 'main']]) {
    await page.goto(BASE + u); await waitMain(page, sel); await sleep(1500); await audit(page, `${vp.n}-${n}`, { full: vp.n !== 'land' });
  }
}
await browser.close();
