/*
  08 · PHONE · COST & YIELD  (402×874, phone slot 8)

  Numbers a business decides by, so the screen is strict about provenance: a
  figure that exists is shown plainly, a figure that is MISSING says "חסר נתון"
  in amber and never renders as 0, and anything derived from an estimate carries
  the estimate badge. Food cost is shown with the sale price it depends on —
  and when that price is absent, the percentage is withheld, not guessed.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.phone);
const screen = screenFrame('טלפון · תמחור ותפוקה', 402, 874, 200 + 482 * 8, 200);
page.appendChild(screen);
const body = screenBody(screen, 14);

const top = row('ראש המסך', 10);
body.appendChild(top); top.layoutSizingHorizontal = 'FILL';
top.appendChild(await txt('משני/14', '← המתכון', 'טקסט/משני'));
const title = await txt('כותרת/מסך', 'תמחור ותפוקה', 'טקסט/ראשי');
top.appendChild(title); fillText(title);
const sub = await txt('משני/14', "בריוש נאנטר · 12 יחידות · 1.15 ק\"ג", 'טקסט/משני');
body.appendChild(sub); fillText(sub);

// food cost
const fc = surface('פוד קוסט', 8);
body.appendChild(fc); fc.layoutSizingHorizontal = 'FILL';
const fcT = await txt('כותרת/כרטיס', 'פוד קוסט', 'טקסט/ראשי');
fc.appendChild(fcT); fillText(fcT);
const fcR = rule(); fc.appendChild(fcR); fcR.layoutSizingHorizontal = 'FILL';
const COST = [
  ['עלות חומרי הגלם', '₪38.40', {}],
  ['עלות לק"ג', '₪33.40', {}],
  ['עלות ליחידה', '₪3.20', { strong: true }],
  ['מחיר מכירה ליחידה', 'חסר נתון', { valueColor: 'משמעות/אזהרה' }],
  ['פוד קוסט', 'לא מחושב · חסר מחיר מכירה', { valueColor: 'משמעות/אזהרה' }],
];
for (const [label, value, opts] of COST) {
  const { node } = await dataRow(label, value, opts);
  fc.appendChild(node);
  node.layoutSizingHorizontal = 'FILL';
}
const fcWhy = col('הסבר', 4);
fcWhy.paddingTop = fcWhy.paddingBottom = 10; fcWhy.paddingLeft = fcWhy.paddingRight = 12;
fcWhy.fills = [pf('רקע/אזהרה')];
bindR(fcWhy, 'פינה/כרטיס');
fc.appendChild(fcWhy); fcWhy.layoutSizingHorizontal = 'FILL';
const fcWhyT = await txt('משני/14', 'אין מחיר מכירה למתכון הזה, ולכן אחוז הפוד קוסט לא מוצג. אפס אינו תשובה כאן.', 'משמעות/אזהרה');
fcWhy.appendChild(fcWhyT); fillText(fcWhyT);
const fcCta = await wideButton('הוספת מחיר מכירה', 'quiet');
fc.appendChild(fcCta);
fcCta.layoutSizingHorizontal = 'FILL';

// yield & waste
const yd = surface('תשואה ופחת', 8);
body.appendChild(yd); yd.layoutSizingHorizontal = 'FILL';
const ydT = await txt('כותרת/כרטיס', 'תשואה ופחת', 'טקסט/ראשי');
yd.appendChild(ydT); fillText(ydT);
const ydR = rule(); yd.appendChild(ydR); ydR.layoutSizingHorizontal = 'FILL';
const YIELD = [
  ['משקל בצק לפני אפייה', '1.15 ק"ג', {}],
  ['פחת מוגדר', '4%', {}],
  ['תשואה נטו', '1.10 ק"ג', { strong: true }],
  ['יחידות בפועל', "12 יח' · 92 גר' ליחידה", {}],
  ['פחת שנמדד בייצור', 'לא נמדד', { valueColor: 'טקסט/משני' }],
];
for (const [label, value, opts] of YIELD) {
  const { node } = await dataRow(label, value, opts);
  yd.appendChild(node);
  node.layoutSizingHorizontal = 'FILL';
}

// provenance of the whole card
const prov = row('מקור הנתונים', 8);
body.appendChild(prov); prov.layoutSizingHorizontal = 'FILL';
prov.appendChild(inst('תג/מקור נתון', 'סוג=מערכת'));
const provT = await txt('מטא/13', 'שני מחירים במתכון הזה הם נתוני מערכת ולא מחירי הרכש שלך. עדכון שלהם ישנה את החישוב.', 'טקסט/משני');
prov.appendChild(provT); fillText(provT);

tabBar(screen, 'עוד');
return { createdNodeIds: [screen.id], screen: screen.name };
