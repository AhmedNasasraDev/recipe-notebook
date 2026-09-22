// Sweep 2 (qa1): recipe screen, professional details, sheets, editor stages, new recipe, cook, order, label.
import { launch, BASE, sleep, PHONE, DESK, text } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
import fs from 'node:fs';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const errs = [];
for (const vp of [PHONE, DESK]) {
  const { browser, page, errors, net } = await launch({ viewport: vp, storageState: 'state-qa1.json' });
  const go = async (u, sel = 'main') => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(2200); };
  await go(`/recipe/${id}`); await page.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {}); await audit(page, 'recipe');
  // priced brioche (the one with prices) — find via notebook
  const priced = await page.evaluate(() => [...document.querySelectorAll('a[href^="/recipe/"]')].map((a) => a.getAttribute('href')));
  await page.getByRole('button', { name: /גרמים/ }).first().click().catch(() => {}); await sleep(300); await audit(page, 'recipe-view-grams', { full: false });
  await page.getByRole('button', { name: /^ביתי$/ }).first().click().catch(() => {}); await sleep(300); await audit(page, 'recipe-view-home', { full: false });
  await page.getByRole('button', { name: /^יחידות$/ }).first().click().catch(() => {}); await page.fill('#scale-value', '6').catch(() => {}); await sleep(400); await audit(page, 'recipe-scale-units6', { full: false });
  await page.fill('#scale-value', 'abc').catch(() => {}); await sleep(300); await audit(page, 'recipe-scale-invalid', { full: false });
  await page.fill('#scale-value', '0').catch(() => {}); await sleep(300); await audit(page, 'recipe-scale-zero', { full: false });
  await page.getByRole('button', { name: /לפי מלאי/ }).first().click().catch(() => {}); await sleep(300); await audit(page, 'recipe-scale-stock', { full: false });
  await page.getByRole('button', { name: /כמויות כמו במתכון|^כמו במתכון$/ }).first().click().catch(() => {});
  await page.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).click().catch(() => {}); await sleep(600); await audit(page, 'recipe-pro');
  await page.locator('summary').filter({ hasText: 'עוד פעולות' }).click().catch(() => {}); await sleep(500); await audit(page, 'recipe-more', { full: false });
  await page.getByRole('button', { name: /^מחיקת / }).first().click().catch(() => {}); await sleep(400); await audit(page, 'recipe-delete-dialog', { full: false });
  await page.getByRole('button', { name: /ביטול/ }).last().click().catch(() => {});
  // convert sheet on the first ingredient row
  await page.locator('button[class*="ingRow"]').first().click().catch(() => {}); await sleep(600); await audit(page, 'recipe-convert-sheet', { full: false });
  await page.keyboard.press('Escape'); await sleep(300);
  await page.getByRole('button', { name: /סגירה|סגור/ }).first().click().catch(() => {});
  // private note
  await page.locator('textarea').first().fill('בדיקה-QA הערה אישית').catch(() => {}); await sleep(300); await audit(page, 'recipe-note-typed', { full: false });
  await page.getByRole('button', { name: /שמירת ההערה|שמירה/ }).first().click().catch(() => {}); await sleep(2000); await audit(page, 'recipe-note-saved', { full: false });
  // focal control open
  await page.getByRole('button', { name: 'התאמת מיקום התמונה' }).click().catch(() => {}); await sleep(300); await audit(page, 'recipe-focus-open', { full: false });
  await page.getByRole('button', { name: /^ביטול$/ }).first().click().catch(() => {});
  // priced brioche recipe (second in the list) — pro details with costs
  const other = priced.find((h) => !h.includes(id) && !h.includes('/edit'));
  if (other) { await go(other); await page.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).click().catch(() => {}); await sleep(600); await audit(page, 'recipe-priced-pro'); }
  // editor — every stage on the pasted brioche
  await go(`/recipe/${id}/edit`); await audit(page, 'edit-stage1');
  for (const n of [2, 3, 4]) { await page.getByRole('button', { name: new RegExp(`שלב ${n} מתוך`) }).click().catch(() => {}); await sleep(500); await audit(page, `edit-stage${n}`); }
  await page.getByRole('button', { name: /שלב 2 מתוך/ }).click().catch(() => {}); await sleep(300);
  await page.locator('summary').filter({ hasText: 'פרטים נוספים ל' }).first().click().catch(() => {}); await sleep(300); await audit(page, 'edit-stage2-details', { full: false });
  await page.locator('input[aria-label^="כמות של"]').first().fill('0').catch(() => {});
  await page.getByRole('button', { name: /שלב 4 מתוך/ }).click().catch(() => {}); await sleep(300);
  await page.getByRole('button', { name: 'שמירת השינויים' }).click().catch(() => {}); await sleep(800); await audit(page, 'edit-validation-zero', { full: false });
  await go('/recipe/new'); await audit(page, 'new-stage1');
  await page.getByRole('button', { name: 'שמירת המתכון' }).click().catch(() => {}); await sleep(600); await audit(page, 'new-validation-empty', { full: false });
  await page.getByRole('button', { name: /המשך ל/ }).click().catch(() => {}); await sleep(300); await audit(page, 'new-stage2', { full: false });
  // cook
  await go(`/recipe/${id}/cook`, 'li label'); await audit(page, 'cook-gate');
  await page.locator('li label input').first().check().catch(() => {}); await sleep(300);
  await page.getByRole('button', { name: /מעבר להכנה|מתחילים בהכנה/ }).click(); await sleep(600); await audit(page, 'cook-step1');
  await page.getByRole('button', { name: 'שלב 2' }).click(); await sleep(300);
  await page.getByRole('button', { name: /הפעלת טיימר/ }).click().catch(() => {}); await sleep(1200); await audit(page, 'cook-step2-timer');
  await page.getByRole('button', { name: 'טיימר אישי' }).click().catch(() => {}); await sleep(300); await audit(page, 'cook-own-timer-form', { full: false });
  await page.getByRole('button', { name: /^מסך מלא$/ }).click().catch(() => {}); await sleep(600); await audit(page, 'cook-fullscreen');
  await page.getByRole('button', { name: /יציאה ממסך מלא/ }).click().catch(() => {});
  await page.getByRole('button', { name: 'שלב 5' }).click().catch(() => {}); await sleep(300); await audit(page, 'cook-last-step', { full: false });
  await page.locator('summary').filter({ hasText: 'הרכיבים' }).click().catch(() => {}); await sleep(300); await audit(page, 'cook-ings-open', { full: false });
  // order + label
  await go(`/recipe/${id}/order`, '#order-qty'); await audit(page, 'order-noqty');
  await page.fill('#order-qty', '20'); await sleep(500); await audit(page, 'order-20');
  await page.fill('#order-qty', '-3'); await sleep(400); await audit(page, 'order-negative', { full: false });
  await go(`/recipe/${id}/label`, '.wrap, main, body'); await audit(page, 'label');
  errs.push(...errors.map((e) => `${vp.width}: ${e}`), ...net.filter((n) => n.s >= 400).map((n) => `${vp.width}: ${n.m} ${n.u.slice(0, 80)} ${n.s}`));
  await browser.close();
}
console.log('ERRORS/NET:', errs.slice(0, 12));
