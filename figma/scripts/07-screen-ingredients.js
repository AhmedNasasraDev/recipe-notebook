/*
  07 · PHONE · INGREDIENTS & PRICES  (402×874, phone slot 7)

  The ingredient centre, plus the thing that is usually missing from one: when
  a price changes, the screen says WHAT ELSE that changes — how many recipes
  and which, before the edit is applied. A price with no source is marked as
  such rather than shown as a number that looks authoritative.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.phone);
const screen = screenFrame('טלפון · חומרי גלם ומחירים', 402, 874, 200 + 482 * 7, 200);
page.appendChild(screen);
const body = screenBody(screen, 14);

const top = row('ראש המסך', 10);
body.appendChild(top); top.layoutSizingHorizontal = 'FILL';
top.appendChild(await pill('חומר גלם חדש', 'secondary', 'הוספה'));
const title = await txt('כותרת/מסך', 'חומרי גלם ומחירים', 'טקסט/ראשי');
top.appendChild(title); fillText(title);

const lead = await txt('משני/14', '6 חומרי גלם · עדכון אחרון 14 בספטמבר', 'טקסט/משני');
body.appendChild(lead); fillText(lead);

const ITEMS = [
  ['קמח לחם 13% חלבון', '₪4.20', 'לק"ג · שק 25 ק"ג', 'מאושר'],
  ['חמאה 82%', '₪38.00', 'לק"ג · גליל 1 ק"ג', 'מאושר'],
  ['ביצים L', '₪0.95', "ליח' · תבנית 30", 'מאושר'],
  ['שמרים טריים', '₪12.50', 'לק"ג · קופסה 500 גר\'', 'מערכת'],
  ['חלב 3%', '₪5.60', 'לליטר · בקבוק 1 ל\'', 'מערכת'],
  ['וניל בורבון', '—', 'חסר מחיר', 'הערכה'],
];
const list = col('רשימת חומרי גלם', 10);
body.appendChild(list); list.layoutSizingHorizontal = 'FILL';
for (const [name, price, unit, kind] of ITEMS) {
  const card = surface(`חומר גלם · ${name}`, 8);
  list.appendChild(card);
  card.layoutSizingHorizontal = 'FILL';
  const line = row('שם ומחיר', 10);
  card.appendChild(line); line.layoutSizingHorizontal = 'FILL';
  const p = await txt('כמות/17', price, price === '—' ? 'טקסט/משני' : 'טקסט/ראשי', 'LEFT');
  line.appendChild(p);
  const n = await txt('גוף/16 מודגש', name, 'טקסט/ראשי');
  line.appendChild(n); fillText(n);
  const sub = row('יחידה ומקור', 8);
  card.appendChild(sub); sub.layoutSizingHorizontal = 'FILL';
  sub.appendChild(inst('תג/מקור נתון', kind === 'מאושר' ? 'סוג=מאושר' : kind === 'מערכת' ? 'סוג=מערכת' : 'סוג=הערכה'));
  const u = await txt('מטא/13', unit, 'טקסט/משני');
  sub.appendChild(u); fillText(u);
}

// the edit sheet, with the consequence stated first
const sheet = col('גלילון · עדכון מחיר', 12);
sheet.paddingTop = 20; sheet.paddingBottom = 20; sheet.paddingLeft = 16; sheet.paddingRight = 16;
sheet.fills = [pf('רקע/משטח')];
sheet.strokes = [pf('קו/עדין')];
sheet.strokeWeight = 1;
bindR(sheet, 'פינה/גלילון');
body.appendChild(sheet);
sheet.layoutSizingHorizontal = 'FILL';
const sTitle = await txt('כותרת/כרטיס', 'עדכון מחיר · חמאה 82%', 'טקסט/ראשי');
sheet.appendChild(sTitle); fillText(sTitle);
const fRow = row('שדות', 10);
sheet.appendChild(fRow); fRow.layoutSizingHorizontal = 'FILL';
for (const [label, value] of [['מחיר', '₪41.00'], ['ליחידת קנייה', 'ק"ג']]) {
  const f = col(label, 4);
  const l = await txt('מטא/13', label, 'טקסט/משני');
  f.appendChild(l);
  const box = row('שדה', 0);
  box.paddingLeft = box.paddingRight = 12;
  box.fills = [pf('רקע/משטח')];
  box.strokes = [pf('קו/עדין')];
  box.strokeWeight = 1;
  bindR(box, 'פינה/פקד');
  const v = await txt('גוף/16', value, 'טקסט/ראשי');
  box.appendChild(v);
  f.appendChild(box);
  fRow.appendChild(f);
  f.layoutSizingHorizontal = 'FILL';
  fillText(l);
  box.layoutSizingHorizontal = 'FILL';
  box.resize(box.width, 48);
  box.counterAxisSizingMode = 'FIXED';
  fillText(v);
}
const impact = col('מה זה משנה', 6);
impact.paddingTop = impact.paddingBottom = 10; impact.paddingLeft = impact.paddingRight = 12;
impact.fills = [pf('רקע/אזהרה')];
bindR(impact, 'פינה/כרטיס');
sheet.appendChild(impact);
impact.layoutSizingHorizontal = 'FILL';
const iTitle = await txt('גוף/16 מודגש', 'העדכון ישנה עלות של 3 מתכונים', 'משמעות/אזהרה');
impact.appendChild(iTitle); fillText(iTitle);
const iBody = await txt('משני/14', 'בריוש נאנטר ₪38.40 → ₪39.15 · קרואסון חמאה ₪52.10 → ₪54.00 · בריוש שוקולד ₪41.20 → ₪42.05', 'משמעות/אזהרה');
impact.appendChild(iBody); fillText(iBody);
const acts = row('פעולות', 10);
sheet.appendChild(acts); acts.layoutSizingHorizontal = 'FILL';
acts.appendChild(await wideButton('ביטול', 'quiet'));
const apply = await wideButton('עדכון המחיר', 'primary');
acts.appendChild(apply);
apply.layoutSizingHorizontal = 'FILL';

tabBar(screen, 'עוד');
return { createdNodeIds: [screen.id], screen: screen.name };
