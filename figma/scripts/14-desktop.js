/*
  14 · DESKTOP · 1440×900  (wide page, desktop row)

  On a desktop the danger is the opposite of a phone: a row stretched across
  1,400px puts an ingredient's name at one end of the monitor and its quantity
  at the other. So the application keeps a reading column (max 1,040px here,
  centred) while the page background and the bars stay full width — the same
  rule the built app follows.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.wide);
const created = [];
const Y = 1360;

const deskShell = (name, x) => {
  const f = screenFrame(name, 1440, 900, x, Y);
  return f;
};

// ── notebook ─────────────────────────────────────────────────────────────
const nb = deskShell('מחשב · מחברת', 200);
page.appendChild(nb);
created.push(nb.id);
const nbOuter = row('שורת עמוד', 0);
nbOuter.primaryAxisAlignItems = 'CENTER';
nbOuter.counterAxisAlignItems = 'MIN';
nb.appendChild(nbOuter);
nbOuter.layoutSizingHorizontal = 'FILL';
nbOuter.layoutSizingVertical = 'FILL';
const column = col('עמוד קריאה', 16);
column.paddingTop = 28; column.paddingBottom = 28; column.paddingLeft = 24; column.paddingRight = 24;
nbOuter.appendChild(column);
column.resize(1040, column.height);
column.layoutSizingHorizontal = 'FIXED';
column.layoutSizingVertical = 'FILL';

const head = row('כותרת', 12);
head.counterAxisAlignItems = 'MIN';
column.appendChild(head); head.layoutSizingHorizontal = 'FILL';
const acts = row('פעולות', 8);
head.appendChild(acts);
acts.appendChild(await pill('הדבקה', 'secondary'));
acts.appendChild(await pill('מתכון חדש', 'primary', 'הוספה'));
const titleCol = col('שם המסך', 4);
const t1 = await txt('כותרת/מסך', 'מחברת מתכונים', 'טקסט/ראשי');
titleCol.appendChild(t1);
const t2 = await txt('משני/14', '5 מתכונים · 2 בסיסים · עדכון אחרון לפני 4 דקות', 'טקסט/משני');
titleCol.appendChild(t2);
head.appendChild(titleCol);
titleCol.layoutSizingHorizontal = 'FILL';
fillText(t1); fillText(t2);

const toolbar = row('סרגל חיפוש וסינון', 10);
column.appendChild(toolbar); toolbar.layoutSizingHorizontal = 'FILL';
const chipsRow = row('קטגוריות', 8);
chipsRow.primaryAxisAlignItems = 'MAX';
toolbar.appendChild(chipsRow);
for (const [label, on] of [['קרמים ומילויים', false], ['לחמים', false], ['בצקים', false], ['הכל', true]]) {
  const c = inst('שבב/סינון', on ? 'מצב=נבחר' : 'מצב=רגיל');
  const t = c.findOne((n) => n.type === 'TEXT');
  await setText(t, label);
  c.resize(Math.max(88, t.width + 36), 44);
  chipsRow.appendChild(c);
}
const search = row('חיפוש', 8);
search.paddingLeft = search.paddingRight = 12;
search.fills = [pf('רקע/משטח')];
search.strokes = [pf('קו/עדין')];
search.strokeWeight = 1;
bindR(search, 'פינה/פקד');
toolbar.appendChild(search);
search.resize(360, 48);
search.primaryAxisSizingMode = 'FIXED';
search.counterAxisSizingMode = 'FIXED';
const sph = await txt('גוף/16', 'שם, תג או רכיב', 'טקסט/משני');
search.appendChild(sph);
search.appendChild(icon('חיפוש', 'טקסט/משני', 20));
fillText(sph);

const grid = row('רשת מתכונים', 16);
grid.layoutWrap = 'WRAP';
grid.counterAxisSpacing = 16;
grid.counterAxisAlignItems = 'MIN';
column.appendChild(grid);
grid.layoutSizingHorizontal = 'FILL';
for (const [name, meta] of [
  ['גנאש שוקולד מריר 64%', 'גנאשים ורטבים · 1.14 ק"ג · 12 שע\''],
  ['בריוש נאנטר', "בצקים · 12 יח' · 85 גר' ליחידה"],
  ['קרואסון חמאה', "בצקים · 33 יח' · 53 גר' ליחידה"],
  ['קרם פטיסייר וניל', 'קרמים ומילויים · 1.49 ק"ג'],
  ['בריוש שוקולד', "בצקים · 12 יח' · 105 גר' ליחידה"],
  ['גנאש חלב 33%', 'גנאשים ורטבים · 0.8 ק"ג'],
]) {
  const c = inst('כרטיס/מתכון');
  grid.appendChild(c);
  c.resize(320, c.height);
  c.layoutSizingHorizontal = 'FIXED';
  const texts = c.findAllWithCriteria({ types: ['TEXT'] });
  await setText(texts[0], name);
  await setText(texts[1], meta);
  const tagRow = c.findOne((n) => n.name === 'תגים');
  const chips = tagRow.children.slice().reverse();
  for (let i = 1; i < chips.length; i += 1) chips[i].visible = false;
  chips[0].fills = [pf('רקע/משטח')];
  chips[0].strokes = [pf('קו/עדין')];
  chips[0].strokeWeight = 1;
  const ct = chips[0].findOne((n) => n.type === 'TEXT');
  await setText(ct, 'בצקים');
  ct.fills = [pf('טקסט/משני')];
}
tabBar(nb, 'מחברת');

// ── recipe ───────────────────────────────────────────────────────────────
const rc = deskShell('מחשב · מתכון', 200 + 1520);
page.appendChild(rc);
created.push(rc.id);
const rcOuter = row('שורת עמוד', 0);
rcOuter.primaryAxisAlignItems = 'CENTER';
rcOuter.counterAxisAlignItems = 'MIN';
rc.appendChild(rcOuter);
rcOuter.layoutSizingHorizontal = 'FILL';
rcOuter.layoutSizingVertical = 'FILL';
const rcColumn = col('עמוד קריאה', 16);
rcColumn.paddingTop = 28; rcColumn.paddingBottom = 28; rcColumn.paddingLeft = 24; rcColumn.paddingRight = 24;
rcOuter.appendChild(rcColumn);
rcColumn.resize(1040, rcColumn.height);
rcColumn.layoutSizingHorizontal = 'FIXED';
rcColumn.layoutSizingVertical = 'FILL';

const rcHead = row('זהות', 12);
rcHead.counterAxisAlignItems = 'MIN';
rcColumn.appendChild(rcHead); rcHead.layoutSizingHorizontal = 'FILL';
const cook = await wideButton('מצב הכנה', 'primary');
cook.resize(240, 54);
cook.primaryAxisSizingMode = 'FIXED';
rcHead.appendChild(cook);
const rcTitles = col('שם', 6);
const rt = await txt('כותרת/מתכון', 'בריוש נאנטר', 'טקסט/ראשי');
rcTitles.appendChild(rt);
const rm = await txt('משני/14', "12 יחידות · 85 גר' ליחידה · 3 שע' 38 דק' · פוד קוסט ₪3.20 ליחידה", 'טקסט/משני');
rcTitles.appendChild(rm);
rcHead.appendChild(rcTitles);
rcTitles.layoutSizingHorizontal = 'FILL';
fillText(rt); fillText(rm);

const three = row('שלוש עמודות', 16);
three.counterAxisAlignItems = 'MIN';
rcColumn.appendChild(three);
three.layoutSizingHorizontal = 'FILL';
three.layoutSizingVertical = 'FILL';

// steps (widest, on the left in RTL → appended first)
const steps = surface('שלבים', 14);
three.appendChild(steps);
steps.layoutSizingHorizontal = 'FILL';
const sT = await txt('כותרת/כרטיס', 'שלבי הכנה', 'טקסט/ראשי');
steps.appendChild(sT); fillText(sT);
const sR = rule(); steps.appendChild(sR); sR.layoutSizingHorizontal = 'FILL';
for (const [num, text] of [
  ['1', 'לשים קמח, ביצים, חלב, סוכר ושמרים בווים 4 דקות במהירות נמוכה.'],
  ['2', 'מוסיפים מלח וממשיכים 6 דקות עד פיתוח גלוטן בינוני.'],
  ['3', 'מוסיפים חמאה קרה בהדרגה, לישה עד מסה חלקה ומבריקה.'],
  ['4', 'תפיחה ראשונה בקירור, 12 שעות ב-4°C.'],
  ['5', 'חלוקה ל-12 יחידות של 85 גר\' ועיצוב.'],
  ['6', 'אפייה 18 דקות ב-165°C עם קיטור בהתחלה.'],
]) {
  const s = row(`שלב ${num}`, 12);
  s.counterAxisAlignItems = 'MIN';
  const st = await txt('גוף/16', text, 'טקסט/ראשי');
  s.appendChild(st);
  const badge = row(`מספר ${num}`, 0);
  badge.primaryAxisAlignItems = 'CENTER';
  badge.resize(30, 30);
  badge.primaryAxisSizingMode = 'FIXED';
  badge.counterAxisSizingMode = 'FIXED';
  badge.fills = [pf('רקע/בחירה')];
  bindR(badge, 'פינה/גלולה');
  badge.appendChild(await txt('גוף/16 מודגש', num, 'פעולה/מרווה כהה', 'CENTER'));
  s.appendChild(badge);
  steps.appendChild(s);
  s.layoutSizingHorizontal = 'FILL';
  fillText(st);
}

// ingredients
const ing = surface('רכיבים', 8);
three.appendChild(ing);
ing.resize(320, ing.height);
ing.layoutSizingHorizontal = 'FIXED';
const iT = await txt('כותרת/כרטיס', 'רכיבים', 'טקסט/ראשי');
ing.appendChild(iT); fillText(iT);
const iR = rule(); ing.appendChild(iR); iR.layoutSizingHorizontal = 'FILL';
for (const [qty, name] of [
  ["500 גר'", 'קמח לחם 13% חלבון'], ["275 גר'", 'ביצים'], ["62 גר'", 'חלב 3%'],
  ["60 גר'", 'סוכר'], ["20 גר'", 'שמרים טריים'], ["11 גר'", 'מלח'], ["250 גר'", 'חמאה 82%'],
]) {
  const r = inst('שורת/רכיב');
  ing.appendChild(r);
  r.layoutSizingHorizontal = 'FILL';
  const texts = r.findAllWithCriteria({ types: ['TEXT'] });
  await setText(texts[0], qty);
  await setText(texts[1], name);
  if (texts[2]) texts[2].visible = false;
}

// professional panel, open on a desktop because there is room for it
const pro = surface('פרטים מקצועיים', 8);
three.appendChild(pro);
pro.resize(280, pro.height);
pro.layoutSizingHorizontal = 'FIXED';
const pT = await txt('כותרת/כרטיס', 'פרטים מקצועיים', 'טקסט/ראשי');
pro.appendChild(pT); fillText(pT);
const pR = rule(); pro.appendChild(pR); pR.layoutSizingHorizontal = 'FILL';
for (const [label, value, opts] of [
  ['עלות חומרי גלם', '₪38.40', {}],
  ['עלות ליחידה', '₪3.20', { strong: true }],
  ['מחיר מכירה', 'חסר נתון', { valueColor: 'משמעות/אזהרה' }],
  ['תשואה נטו', '1.10 ק"ג', {}],
  ['פחת מוגדר', '4%', {}],
  ['גרסה נוכחית', 'V3 · 14.9', {}],
]) {
  const { node } = await dataRow(label, value, opts);
  pro.appendChild(node);
  node.layoutSizingHorizontal = 'FILL';
}
tabBar(rc, 'מחברת');

return { createdNodeIds: created, screens: ['מחשב · מחברת', 'מחשב · מתכון'] };
