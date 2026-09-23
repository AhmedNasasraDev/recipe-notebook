/*
  13 · TABLET · 768×1024  (wide page, tablet row)

  A tablet is not a big phone: it has room for two things at once. The notebook
  becomes a two-column grid inside a reading column that stops growing, and the
  recipe puts the ingredients beside the steps so a cook stops scrolling
  between them. The tab bar stays where the thumb is.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.wide);
const created = [];

// ── notebook ─────────────────────────────────────────────────────────────
const nb = screenFrame('טאבלט · מחברת', 768, 1024, 200, 200);
page.appendChild(nb);
created.push(nb.id);
const nbBody = col('תוכן נגלל', 16);
nbBody.paddingTop = 24; nbBody.paddingBottom = 16; nbBody.paddingLeft = 24; nbBody.paddingRight = 24;
nb.appendChild(nbBody);
nbBody.layoutSizingHorizontal = 'FILL';
nbBody.layoutSizingVertical = 'FILL';

const nbHead = row('כותרת', 12);
nbHead.counterAxisAlignItems = 'MIN';
nbBody.appendChild(nbHead); nbHead.layoutSizingHorizontal = 'FILL';
const nbActions = row('פעולות', 8);
nbHead.appendChild(nbActions);
nbActions.appendChild(await pill('הדבקה', 'secondary'));
nbActions.appendChild(await pill('מתכון חדש', 'primary', 'הוספה'));
const nbTitleCol = col('שם המסך', 4);
const nbT = await txt('כותרת/מסך', 'מחברת מתכונים', 'טקסט/ראשי');
nbTitleCol.appendChild(nbT);
const nbS = await txt('משני/14', '5 מתכונים · 2 בסיסים', 'טקסט/משני');
nbTitleCol.appendChild(nbS);
nbHead.appendChild(nbTitleCol);
nbTitleCol.layoutSizingHorizontal = 'FILL';
fillText(nbT); fillText(nbS);

const nbSearch = row('חיפוש', 8);
nbSearch.paddingLeft = nbSearch.paddingRight = 12;
nbSearch.fills = [pf('רקע/משטח')];
nbSearch.strokes = [pf('קו/עדין')];
nbSearch.strokeWeight = 1;
bindR(nbSearch, 'פינה/פקד');
nbBody.appendChild(nbSearch);
nbSearch.layoutSizingHorizontal = 'FILL';
const nbPh = await txt('גוף/16', 'שם, תג או רכיב', 'טקסט/משני');
nbSearch.appendChild(nbPh);
nbSearch.appendChild(icon('חיפוש', 'טקסט/משני', 20));
nbSearch.resize(nbSearch.width, 48);
nbSearch.counterAxisSizingMode = 'FIXED';
fillText(nbPh);

const nbChips = row('קטגוריות', 8);
nbChips.primaryAxisAlignItems = 'MAX';
nbBody.appendChild(nbChips); nbChips.layoutSizingHorizontal = 'FILL';
for (const [label, on] of [['גנאשים ורטבים', false], ['קרמים ומילויים', false], ['לחמים', false], ['בצקים', false], ['הכל', true]]) {
  const c = inst('שבב/סינון', on ? 'מצב=נבחר' : 'מצב=רגיל');
  const t = c.findOne((n) => n.type === 'TEXT');
  await setText(t, label);
  c.resize(Math.max(88, t.width + 36), 44);
  nbChips.appendChild(c);
}

// two-column grid
const grid = row('רשת מתכונים', 14);
grid.counterAxisAlignItems = 'MIN';
grid.layoutWrap = 'WRAP';
grid.counterAxisSpacing = 14;
nbBody.appendChild(grid);
grid.layoutSizingHorizontal = 'FILL';
const CARDS = [
  ['גנאש שוקולד מריר 64%', 'גנאשים ורטבים · 1.14 ק"ג · 12 שע\'', 'מתכון בסיס', 'green'],
  ['בריוש נאנטר', "בצקים · 12 יח' · 85 גר' ליחידה · 3 שע' 38 דק'", 'נוסחה מאושרת', 'amber'],
  ['קרואסון חמאה', "בצקים · 33 יח' · 53 גר' ליחידה · 44 שע' 16 דק'", 'למינציה', 'plain'],
  ['קרם פטיסייר וניל', 'קרמים ומילויים · 1.49 ק"ג · 15 דק\'', 'מתכון בסיס', 'green'],
  ['בריוש שוקולד', "בצקים · 12 יח' · 105 גר' ליחידה · 40 דק'", 'גרסה', 'plain'],
];
for (const [name, meta, tagLabel, tagKind] of CARDS) {
  const c = inst('כרטיס/מתכון');
  grid.appendChild(c);
  c.resize(339, c.height);
  c.layoutSizingHorizontal = 'FIXED';
  const texts = c.findAllWithCriteria({ types: ['TEXT'] });
  await setText(texts[0], name);
  await setText(texts[1], meta);
  const tagRow = c.findOne((n) => n.name === 'תגים');
  const chips = tagRow.children.slice().reverse();
  const KIND = { green: ['רקע/בחירה', 'פעולה/מרווה כהה', null], amber: ['רקע/אזהרה', 'משמעות/אזהרה', null], plain: ['רקע/משטח', 'טקסט/משני', 'קו/עדין'] };
  const [bg, ink, stroke] = KIND[tagKind];
  chips[0].fills = [pf(bg)];
  chips[0].strokes = stroke ? [pf(stroke)] : [];
  chips[0].strokeWeight = stroke ? 1 : 0;
  await setText(chips[0].findOne((n) => n.type === 'TEXT'), tagLabel);
  chips[0].findOne((n) => n.type === 'TEXT').fills = [pf(ink)];
  for (let i = 1; i < chips.length; i += 1) chips[i].visible = false;
}
tabBar(nb, 'מחברת');

// ── recipe, two columns ──────────────────────────────────────────────────
const rc = screenFrame('טאבלט · מתכון', 768, 1024, 200 + 848, 200);
page.appendChild(rc);
created.push(rc.id);
const rcBody = col('תוכן נגלל', 16);
rcBody.paddingTop = 24; rcBody.paddingBottom = 16; rcBody.paddingLeft = 24; rcBody.paddingRight = 24;
rc.appendChild(rcBody);
rcBody.layoutSizingHorizontal = 'FILL';
rcBody.layoutSizingVertical = 'FILL';

const rcHead = row('זהות', 12);
rcHead.counterAxisAlignItems = 'MIN';
rcBody.appendChild(rcHead); rcHead.layoutSizingHorizontal = 'FILL';
const cookBtn = await wideButton('מצב הכנה', 'primary');
cookBtn.resize(220, 54);
cookBtn.primaryAxisSizingMode = 'FIXED';
rcHead.appendChild(cookBtn);
const rcTitleCol = col('שם ותיאור', 6);
const rcT = await txt('כותרת/מתכון', 'בריוש נאנטר', 'טקסט/ראשי');
rcTitleCol.appendChild(rcT);
const rcM = await txt('משני/14', "12 יחידות · 85 גר' ליחידה · 3 שע' 38 דק' עבודה ואפייה", 'טקסט/משני');
rcTitleCol.appendChild(rcM);
rcTitleCol.appendChild(await tag('נוסחה מאושרת לייצור', 'amber'));
rcHead.appendChild(rcTitleCol);
rcTitleCol.layoutSizingHorizontal = 'FILL';
fillText(rcT); fillText(rcM);

const cols = row('שתי עמודות', 16);
cols.counterAxisAlignItems = 'MIN';
rcBody.appendChild(cols);
cols.layoutSizingHorizontal = 'FILL';
cols.layoutSizingVertical = 'FILL';

// left column (in RTL, the second one): steps
const stepsCard = surface('שלבים', 14);
cols.appendChild(stepsCard);
stepsCard.layoutSizingHorizontal = 'FILL';
const stT = await txt('כותרת/כרטיס', 'שלבי הכנה', 'טקסט/ראשי');
stepsCard.appendChild(stT); fillText(stT);
const stR = rule(); stepsCard.appendChild(stR); stR.layoutSizingHorizontal = 'FILL';
for (const [num, text, dur] of [
  ['1', 'לשים קמח, ביצים, חלב, סוכר ושמרים בווים 4 דקות במהירות נמוכה.', "4 דק'"],
  ['2', 'מוסיפים מלח וממשיכים 6 דקות עד פיתוח גלוטן בינוני.', "6 דק'"],
  ['3', 'מוסיפים חמאה קרה בהדרגה, לישה עד מסה חלקה ומבריקה.', "8 דק'"],
  ['4', 'תפיחה ראשונה בקירור, 12 שעות ב-4°C.', "12 שע'"],
  ['5', 'חלוקה ל-12 יחידות של 85 גר\' ועיצוב.', "20 דק'"],
  ['6', 'אפייה 18 דקות ב-165°C עם קיטור בהתחלה.', "18 דק'"],
]) {
  const s = row(`שלב ${num}`, 12);
  s.counterAxisAlignItems = 'MIN';
  const c = col('תוכן', 3);
  const st = await txt('גוף/16', text, 'טקסט/ראשי');
  c.appendChild(st);
  const sd = await txt('מטא/13', dur, 'טקסט/משני');
  c.appendChild(sd);
  s.appendChild(c);
  const badge = row(`מספר ${num}`, 0);
  badge.primaryAxisAlignItems = 'CENTER';
  badge.resize(30, 30);
  badge.primaryAxisSizingMode = 'FIXED';
  badge.counterAxisSizingMode = 'FIXED';
  badge.fills = [pf('רקע/בחירה')];
  bindR(badge, 'פינה/גלולה');
  badge.appendChild(await txt('גוף/16 מודגש', num, 'פעולה/מרווה כהה', 'CENTER'));
  s.appendChild(badge);
  stepsCard.appendChild(s);
  s.layoutSizingHorizontal = 'FILL';
  c.layoutSizingHorizontal = 'FILL';
  fillText(st); fillText(sd);
}

// right column (first child): scale + ingredients
const rightCol = col('עמודת רכיבים', 16);
cols.appendChild(rightCol);
rightCol.resize(320, rightCol.height);
rightCol.layoutSizingHorizontal = 'FIXED';
const scaleCard = surface('כמה להכין?', 10);
rightCol.appendChild(scaleCard);
scaleCard.layoutSizingHorizontal = 'FILL';
const scT = await txt('כותרת/כרטיס', 'כמה להכין?', 'טקסט/ראשי');
scaleCard.appendChild(scT); fillText(scT);
const scSeg = await segmented('מצבי כמות', [['כמו במתכון', true], ['יחידות', false], ['משקל', false]]);
scaleCard.appendChild(scSeg); scSeg.layoutSizingHorizontal = 'FILL';
const scVal = await txt('גוף/16 מודגש', 'כמו במתכון · 1.15 ק"ג · 12 יחידות', 'טקסט/ראשי');
scaleCard.appendChild(scVal); fillText(scVal);

const ingCard = surface('רכיבים', 8);
rightCol.appendChild(ingCard);
ingCard.layoutSizingHorizontal = 'FILL';
const icT = await txt('כותרת/כרטיס', 'רכיבים', 'טקסט/ראשי');
ingCard.appendChild(icT); fillText(icT);
const icR = rule(); ingCard.appendChild(icR); icR.layoutSizingHorizontal = 'FILL';
for (const [qty, name] of [
  ["500 גר'", 'קמח לחם 13% חלבון'], ["275 גר'", 'ביצים'], ["62 גר'", 'חלב 3%'],
  ["60 גר'", 'סוכר'], ["20 גר'", 'שמרים טריים'], ["11 גר'", 'מלח'], ["250 גר'", 'חמאה 82%'],
]) {
  const r = inst('שורת/רכיב');
  ingCard.appendChild(r);
  r.layoutSizingHorizontal = 'FILL';
  const texts = r.findAllWithCriteria({ types: ['TEXT'] });
  await setText(texts[0], qty);
  await setText(texts[1], name);
  if (texts[2]) texts[2].visible = false;
}
tabBar(rc, 'מחברת');

return { createdNodeIds: created, screens: ['טאבלט · מחברת', 'טאבלט · מתכון'] };
