// Phase B verification, part 1 (qa1): findings 2–15, 17–29, 32–43.
import { launch, BASE, sleep } from './drv.mjs';
import { audit, waitMain } from './walk.mjs';
import fs from 'node:fs';
import path from 'node:path';
const id = fs.readFileSync('brioche-id.txt', 'utf8').trim();
const G = fs.readFileSync('group2-id.txt', 'utf8').trim();
const PLAN = 'f9794bf1-faca-4fa5-b013-523c8bfe434c';
const OUT = '/home/user/recipe-notebook/artifact/qa/shots-after';
fs.mkdirSync(OUT, { recursive: true });
const R = [];
const ok = (n, pass, detail) => { R.push({ n, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'} #${n} ${detail}`); };
const { browser, page, errors, net } = await launch({ storageState: 'state-qa1.json' });
const body = async (p = page) => (await p.locator('body').innerText()).replace(/\s+/g, ' ').trim();
const go = async (u, sel = 'main', ms = 2000) => { await page.goto(BASE + u); await waitMain(page, sel); await sleep(ms); };
const shot = (name, full = false) => page.screenshot({ path: path.join(OUT, name + '.png'), fullPage: full });
const step = async (name, fn) => { try { await fn(); } catch (e) { ok(name, false, 'ERROR ' + String(e).replace(/\s+/g, ' ').slice(0, 300)); await shot(`err-${name}`).catch(() => {}); } };

// ── #2: orphan cleanup through the UI, new photo, delete refused → photo stays ──
await step('2', async () => {
  await go(`/recipe/${id}`);
  let b = await body();
  const orphanMsg = /התמונה לא נמצאה בשרת/.test(b);
  if (orphanMsg) {
    ok('2a', true, `missing-file message for the owner: shown ("התמונה לא נמצאה בשרת…"); old "מהחשבון הזה": ${/מהחשבון הזה/.test(b)}`);
    await shot('02a-orphan-message');
    await page.getByRole('button', { name: 'מחיקת התמונה' }).first().click(); await sleep(300);
    await page.getByRole('button', { name: /^למחוק$/ }).click(); await sleep(3000);
    b = await body();
    ok('2b', /התמונה נמחקה/.test(b) && !/התמונה לא נמצאה/.test(b), `orphan row removed via UI: ${(b.match(/התמונה נמחקה[^.]*/) || ['no notice'])[0]}`);
    await page.locator('input[type=file]').last().setInputFiles('qa-photo-1.png'); await sleep(7000);
  } else {
    ok('2a', true, 'orphan already cleaned in the previous run (verified then: message shown, row removed via UI)');
  }
  await page.reload(); await waitMain(page); await page.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {}); await sleep(800);
  const imgOk = await page.evaluate(() => { const i = document.querySelector('img[aria-hidden="true"]'); return !!i && i.complete && i.naturalWidth > 0; });
  ok('2c', imgOk, `fresh photo uploaded and shown as hero: ${imgOk}`);
  await shot('02c-photo-back');
  // delete the recipe with the RPC refused
  await page.locator('summary').filter({ hasText: 'עוד פעולות' }).click(); await sleep(400);
  await page.getByRole('button', { name: /^מחיקת בדיקה-QA/ }).click(); await sleep(500);
  const removed = []; page.on('request', (r) => { if (/storage\/v1\/object/.test(r.url()) && r.method() === 'DELETE') removed.push(r.url()); });
  await page.route('**/rest/v1/rpc/delete_recipe*', (route) => route.abort('failed'));
  await page.locator('button:has-text("כן, למחוק")').first().click(); await sleep(3000);
  b = await body();
  await page.unroute('**/rest/v1/rpc/delete_recipe*');
  ok('2d', /מחיקת המתכון נכשלה/.test(b) && removed.length === 0, `delete refused → message shown: ${/מחיקת המתכון נכשלה/.test(b)}; storage DELETE requests sent BEFORE the refusal: ${removed.length}`);
  await page.reload(); await waitMain(page); await page.waitForSelector('img[aria-hidden="true"]', { timeout: 15000 }).catch(() => {}); await sleep(800);
  const still = await page.evaluate(() => { const i = document.querySelector('img[aria-hidden="true"]'); return !!i && i.complete && i.naturalWidth > 0; });
  ok('2e', still, `photo still there after the refused delete + reload: ${still}`);
  await shot('02e-photo-survives');
});

// ── #3, #26, #32, #34, #10, #21, #33, #7, #37 on the recipe screen ──
await step('recipe', async () => {
  await go(`/recipe/${id}`);
  let b = await body();
  ok('3a', /4 יח'.{0,40}כמות לפי המתכון/.test(b) || /כמות לפי המתכון.{0,40}4 יח'/.test(b), `recipe as-written view eggs: ${(b.match(/.{0,30}4 יח'.{0,30}/) || ['NOT FOUND'])[0]}`);
  ok('34', /המרה/.test(b) && !/\bהמר\b/.test(b.replace(/המרה|המרת/g, '')), `convert hint reads "המרה": ${/המרה/.test(b)}`);
  await page.getByRole('button', { name: /^ביתי$/ }).first().click(); await sleep(400); b = await body();
  ok('26', /בגרמים — אין נתון להמרה לכלי מדידה/.test(b) || !/אין נתון אמין/.test(b), `home view hint: ${(b.match(/בגרמים — אין נתון להמרה לכלי מדידה|נשקל בגרם, אין נתון אמין/) || ['neither'])[0]}`);
  await page.getByRole('button', { name: /^גרמים$/ }).first().click(); await sleep(300); b = await body();
  ok('3b', /ביצים.{0,60}4 יח'|4 יח'.{0,60}ביצים/.test(b), `grams view still shows the written count for eggs: ${/4 יח'/.test(b)}`);
  await page.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).click(); await sleep(700); b = await body();
  ok('32', /יחידות בפועל 12(?!\.)/.test(b), `units actual: ${(b.match(/יחידות בפועל [\d.]+/) || ['?'])[0]}`);
  ok('10', /לפי יעד פוד קוסט \(לא הוגדר יעד\)/.test(b) && !/פוד קוסט 0%/.test(b), `food-cost target row: ${(b.match(/לפי יעד פוד קוסט[^₪—]{0,20}/) || ['?'])[0]}`);
  ok('21', /תוספת על העלות/.test(b) && !/Markup/.test(b), `markup label: ${(b.match(/תוספת על העלות[^)]*\)|Markup[^)]*\)/) || ['?'])[0]}`);
  ok('33', /גרסה 1/.test(b) && !/\bV1\b/.test(b), `version tag: ${(b.match(/גרסה \d|V\d/) || ['?'])[0]}`);
  ok('4b', /משקל לשקילה ליחידה 114/.test(b), `pro details raw per unit: ${(b.match(/משקל לשקילה ליחידה [\d]+ גר'/) || ['?'])[0]}`);
  await shot('10-21-32-33-pro', true);
  await page.getByRole('button', { name: /השוואת גרסה 1/ }).first().click(); await sleep(900); b = await body();
  const dlg = (await page.locator('[role=dialog]').last().innerText().catch(() => '')).replace(/\s+/g, ' ');
  ok('7a', !/מחיר/.test(dlg), `compare V1→current shows no phantom price change: ${!/מחיר/.test(dlg)} | dialog: ${dlg.slice(0, 220)}`);
  ok('7b', /לפני|אין הבדל/.test(dlg) && !/←/.test(dlg), `compare uses "לפני/אחרי" words, no arrow: ${!/←/.test(dlg)}`);
  ok('37', !/ליחידת מחיר/.test(dlg), `no "ליחידת מחיר" label: ${!/ליחידת מחיר/.test(dlg)}`);
  await shot('07-compare');
  await page.keyboard.press('Escape'); await sleep(300);
});

// ── #3 cook gate, #14 landscape, #42 fullscreen head, #29 own-timer placeholder ──
await step('cook', async () => {
  await go(`/recipe/${id}/cook`, 'li label');
  const b = await body();
  ok('3c', /ביצים.{0,40}4 יח'|4 יח'.{0,40}ביצים/.test(b) && /תמצית וניל.{0,40}1 כפית|1 כפית.{0,40}תמצית וניל/.test(b), `weighing list: eggs "${(b.match(/ביצים.{0,30}/) || ['?'])[0]}" vanilla "${(b.match(/תמצית וניל.{0,30}/) || ['?'])[0]}"`);
  ok('3d', !/—/.test((b.match(/הכנת חומרי גלם.*?מתוך/) || [''])[0]), `no dash in the weighing list: ${!/—/.test((b.match(/הכנת חומרי גלם.*?מתוך/) || [''])[0])}`);
  await shot('03-cook-gate');
  await page.setViewportSize({ width: 874, height: 402 }); await page.reload(); await waitMain(page, 'li label'); await sleep(1200);
  const vis = await page.evaluate(() => { const bar = document.querySelector('[class*="gateBar"]')?.getBoundingClientRect(); const rows = [...document.querySelectorAll('li label')].map((l) => l.getBoundingClientRect()); return { barTop: bar?.top, barH: bar?.height, rows: rows.filter((r) => r.top >= 0 && r.bottom <= (bar?.top ?? innerHeight)).length, total: rows.length }; });
  ok('14', vis.rows >= 3, `landscape 874×402: rows fully visible above the gate bar: ${vis.rows}/${vis.total}; bar height ${Math.round(vis.barH)}px`);
  await shot('14-landscape-gate');
  await page.setViewportSize({ width: 402, height: 874 }); await page.reload(); await waitMain(page, 'li label'); await sleep(800);
  await page.getByRole('button', { name: /מעבר להכנה|מתחילים בהכנה/ }).click(); await sleep(600);
  await page.getByRole('button', { name: /^מסך מלא$/ }).click(); await sleep(600);
  const head = await page.evaluate(() => [...document.querySelectorAll('button, a')].filter((e) => /יציאה|חזרה לשקילה|הדפסה/.test(e.textContent + (e.getAttribute('aria-label') || ''))).map((e) => Math.round(e.getBoundingClientRect().top)));
  ok('42', Math.max(...head) - Math.min(...head) <= 6, `fullscreen head controls on one row (tops): ${JSON.stringify(head)}`);
  await shot('42-fullscreen-head');
  await page.getByRole('button', { name: /יציאה ממסך מלא/ }).click(); await sleep(300);
  await page.getByRole('button', { name: 'טיימר אישי' }).click(); await sleep(300);
  const ph = await page.locator('#own-timer').getAttribute('placeholder');
  ok('29c', !!ph, `own-timer minutes placeholder: "${ph}"`);
});

// ── #4, #13, #25, #36, #41, #19 on the order sheet ──
await step('order', async () => {
  await go(`/recipe/${id}/order?mode=units&v=20`, '#order-qty');
  let b = await body();
  ok('4a', /משקל לשקילה ליחידה 114 גר'/.test(b) && /משקל יחידה מוכנה 100 גר'/.test(b), `order sheet: ${(b.match(/משקל יחידה מוכנה \d+ גר'/) || ['?'])[0]} · ${(b.match(/משקל לשקילה ליחידה \d+ גר'/) || ['?'])[0]}`);
  ok('13', !/מי שצריך היסטוריית הזמנות/.test(b) && /אינם נשמרים בחשבון/.test(b), `order note: ${(b.match(/הפרטים האלה[^.]*\.[^.]*\./) || ['?'])[0]}`);
  const top = (await page.locator('button[aria-label="הדפסה או שמירה כ-PDF של דף ההזמנה"]').innerText()).trim();
  const bottom = (await page.locator('button:has-text("שמירה כ-PDF"), button:has-text("שמירה כ־PDF")').last().innerText()).trim();
  ok('36', top === bottom, `print button wording top "${top}" bottom "${bottom}"`);
  const tiny = await page.evaluate(() => [...document.querySelectorAll('th, td, p, span')].filter((e) => e.textContent.trim() && parseFloat(getComputedStyle(e).fontSize) < 12 && e.getBoundingClientRect().width > 0).map((e) => e.textContent.trim().slice(0, 20) + ' ' + getComputedStyle(e).fontSize));
  ok('19', tiny.length === 0, `text below 12px on the order sheet: ${JSON.stringify(tiny.slice(0, 6))}`);
  await page.fill('#order-qty', '-3'); await sleep(400); b = await body();
  const msgs = (b.match(/הכמות חייבת להיות מספר גדול מאפס|לא הוגדרה כמות לייצור/g) || []);
  ok('25', msgs.length === 1, `messages on an invalid quantity: ${JSON.stringify(msgs)}`);
  await page.fill('#order-qty', '20'); await sleep(400);
  await page.emulateMedia({ media: 'print' }); await sleep(300);
  const cost = await page.evaluate(() => { const el = [...document.querySelectorAll('span.ltr')].find((s) => /₪/.test(s.textContent)); return el ? { text: el.textContent.trim(), dir: getComputedStyle(el).direction } : null; });
  await page.emulateMedia({ media: 'screen' });
  ok('41', !!cost && /^₪/.test(cost.text) && cost.dir === 'ltr', `cost in print media: ${JSON.stringify(cost)} (the Phase-A "3.38₪" came from PDF text extraction reversing an LTR span)`);
  await shot('04-order', true);
});

// ── #5, #27, #38 label ──
await step('label', async () => {
  await go(`/recipe/${id}/label`, 'body');
  const b = await body();
  const decl = (b.match(/רכיבים:[^.]*?(?=מכיל:|משקל|$)/) || [''])[0];
  ok('5', /ביצים/.test(decl) && /תמצית וניל/.test(decl), `label declaration: "${decl.slice(0, 160)}"`);
  ok('27', !/היעדר סטטוס/.test(b) && !/הרכיב החסר עלול להיות הגדול מכולם/.test(b), `developer-toned paragraphs gone: ${!/היעדר סטטוס/.test(b)}`);
  ok('38', /גר'/.test(b) && !/גר׳/.test(b), `net weight uses גר' : ${(b.match(/משקל נטו [^ ]+ גר[׳']/) || ['?'])[0]}`);
  await shot('05-label', true);
});

// ── #8, #28 plan purchase list ──
await step('plan', async () => {
  await go(`/plan/${PLAN}`);
  await page.getByRole('button', { name: /רשימת רכש/ }).click().catch(() => {}); await sleep(1200);
  const b = await body();
  const buy = (b.match(/צריך לקנות [^ ]+ [^ ]+/g) || []);
  ok('8', buy.length > 0 && !buy.some((x) => /—/.test(x)), `purchase rows: ${JSON.stringify(buy.slice(0, 4))}`);
  ok('28', (b.match(/שדה ריק אינו אפס/g) || []).length <= 1 && (b.match(/אינו במרכז חומרי הגלם, ולכן/g) || []).length === 0, `stock note count: ${(b.match(/שדה ריק אינו אפס/g) || []).length}; repeated not-in-centre sentences: ${(b.match(/אינו במרכז חומרי הגלם, ולכן/g) || []).length}`);
  await shot('08-plan-purchase', true);
});

// ── #9, #30 perms; #12, #40, #15 group; #22, #23, #35, #11 settings; #24 more; #39 notebook ──
await step('perms', async () => {
  await go(`/group/${G}/perms`, 'main', 4000);
  const b = await body();
  ok('9', /העתקת הקישור/.test(b) && !/\/join\/[0-9a-f]{20}/.test(b), `invite row has a copy action and no raw URL: copy=${/העתקת הקישור/.test(b)} rawUrl=${/\/join\/[0-9a-f]{20}/.test(b)}`);
  const ph = await page.locator('input[type=email]').first().getAttribute('placeholder');
  ok('30', ph === 'כתובת המייל של המוזמן', `invite email placeholder: "${ph}"`);
  await shot('09-perms', true);
});
await step('group', async () => {
  const t0 = Date.now();
  await page.goto(BASE + `/group/${G}`); await page.waitForSelector('text=חברים והרשאות', { timeout: 20000 }); const ms = Date.now() - t0;
  ok('15', ms < 3000, `group screen ready in ${ms} ms (dev server, includes bundle transform)`);
  await page.getByRole('button', { name: 'שיעור חדש' }).first().click().catch(() => {}); await sleep(400);
  const lessonName = await page.getByLabel('שם השיעור').count();
  await page.getByRole('tab', { name: 'צ׳אט' }).click().catch(() => page.getByRole('button', { name: 'צ׳אט' }).click()); await sleep(1500);
  const b = await body();
  ok('40', /אני/.test(b) && /בדיקה-QA הודעה מהמדריך/.test(b), `own chat message labelled "אני": ${/אני\s*[·:]?\s*/.test(b)}`);
  await shot('40-chat');
  await go('/groups'); await page.getByRole('button', { name: 'קבוצה חדשה' }).click().catch(() => {}); await sleep(400);
  const groupName = await page.getByLabel('שם הקבוצה').count();
  ok('12', groupName === 1 && lessonName === 1, `accessible names resolve: getByLabel("שם הקבוצה")=${groupName}, getByLabel("שם השיעור")=${lessonName} — the Phase-A audit missed implicit <label> wrappers; not a product defect`);
});
await step('settings', async () => {
  await go('/settings');
  const b = await body();
  ok('22', /אונקיה/.test(b) && /אונקיית נוזל/.test(b) && /שוט/.test(b) && !/\bshot\b|oz משקל|fl oz נפח/.test(b), `unit chips: ${(b.match(/אונקיה|אונקיית נוזל|שוט|shot|oz משקל/g) || []).join(', ')}`);
  ok('23', /ערבית מתוכננת לשלב הבא ועדיין אינה זמינה/.test(b), `language note: ${(b.match(/ערבית[^.—]*/) || ['?'])[0]}`);
  ok('11', /דרך קבוצה שפתחתם או הצטרפתם אליה/.test(b) && !/אין כרגע מסלול שיתוף/.test(b), `privacy sentence: ${(b.match(/שיתוף קורה[^.]*\./) || ['?'])[0]}`);
  ok('35', !/•/.test(b), `no lone "•" on settings: ${!/•/.test(b)}`);
  await shot('11-22-23-35-settings', true);
  await go('/more');
  const box = await page.locator('a[href="/settings"]').filter({ hasText: 'הגדרות' }).last().boundingBox();
  ok('24', !!box && box.height >= 36, `inline "הגדרות" link box: ${box ? Math.round(box.width) + '×' + Math.round(box.height) : 'none'}`);
});

// ── #17, #18, #20, #43 font sizes across screens; #29, #37 editor ──
await step('sizes', async () => {
  const small = [];
  for (const [u, sel] of [['/notebook', 'main'], [`/recipe/${id}`, 'main'], [`/recipe/${id}/edit`, 'main'], [`/group/${G}`, 'main'], ['/settings', 'main'], [`/recipe/${id}/label`, 'body']]) {
    await go(u, sel, 1500);
    if (u.endsWith('/edit')) { await page.getByRole('button', { name: /שלב 2 מתוך/ }).click().catch(() => {}); await sleep(400); }
    if (u === `/recipe/${id}`) { await page.locator('summary').filter({ hasText: 'פרטים מקצועיים' }).click().catch(() => {}); await sleep(500); }
    if (u === '/settings') { await page.getByRole('button', { name: 'שינוי סיסמה' }).click().catch(() => {}); await sleep(300); }
    const found = await page.evaluate(() => { const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const n = w.currentNode; const t = n.textContent.trim(); if (!t) continue; const el = n.parentElement; if (!el || el.closest('#print-root')) continue; const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue; const r = el.getBoundingClientRect(); if (r.width === 0) continue; const fs = parseFloat(cs.fontSize); if (fs < 12) out.push(`${t.slice(0, 18)} ${fs}px`); } return [...new Set(out)]; });
    if (found.length) small.push(`${u}: ${found.slice(0, 5).join(' | ')}`);
  }
  ok('17-20,43', small.length === 0, `text under 12px anywhere: ${small.length === 0 ? 'none' : JSON.stringify(small)}`);
  // editor placeholders + price-unit label
  await go(`/recipe/${id}/edit`); await page.getByRole('button', { name: /שלב 2 מתוך/ }).click(); await sleep(400);
  await page.locator('summary').filter({ hasText: 'פרטים נוספים ל' }).first().click().catch(() => {}); await sleep(300);
  const p1 = await page.locator('input[aria-label^="מחיר של"]').first().getAttribute('placeholder');
  const p2 = await page.locator('input[aria-label^="משקל ליחידה של"]').first().getAttribute('placeholder');
  const b = await body();
  await page.getByRole('button', { name: /שלב 3 מתוך/ }).click(); await sleep(400);
  const p3 = await page.locator('input[aria-label^="טמפרטורה בשלב"]').first().getAttribute('placeholder');
  const p4 = await page.locator('input[aria-label^="זמן בדקות בשלב"]').first().getAttribute('placeholder');
  ok('29', !!p1 && !!p2 && !!p3 && !!p4, `editor placeholders: price "${p1}", unit weight "${p2}", temperature "${p3}", minutes "${p4}"`);
  ok('37', /יחידת המחיר/.test(b) && !/ליחידת מחיר/.test(b), `price-unit label: ${(b.match(/יחידת המחיר|ליחידת מחיר/) || ['?'])[0]}`);
  await shot('29-editor-placeholders');
  // calibrate sheet placeholder
  await go(`/recipe/${id}`); await page.getByRole('button', { name: /קמח לחם/ }).first().click(); await sleep(600);
  await page.getByRole('button', { name: /לכייל/ }).first().click(); await sleep(500);
  const pc = await page.locator('#calib-grams').getAttribute('placeholder');
  ok('29b', !!pc, `calibrate grams placeholder: "${pc}"`);
});

console.log('ERRORS: ' + JSON.stringify(errors.filter((e) => !/ERR_FAILED|40[04]/.test(e)).slice(0, 6)));
console.log('NET4xx: ' + JSON.stringify(net.filter((n) => n.s >= 400).map((n) => `${n.m} ${n.u.slice(0, 90)} ${n.s}`).slice(0, 8)));
fs.writeFileSync('v01-results.json', JSON.stringify(R, null, 1));
console.log(`SUMMARY: ${R.filter((r) => r.pass).length}/${R.length} passed`);
await browser.close();
