/*
  09 · PHONE · PRODUCTION PLAN & PURCHASING  (402×874, phone slot 9)

  One production day, read in the order it is worked: what is being made, what
  has to be bought for it, and in what order to start so the proofing fits the
  shift. The shopping list is derived from the products — it is never typed
  twice — and anything whose price is unknown is flagged rather than silently
  costed at zero.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.phone);
const screen = screenFrame('טלפון · תכנון ורכש', 402, 874, 200 + 482 * 9, 200);
page.appendChild(screen);
const body = screenBody(screen, 14);

const top = row('ראש המסך', 10);
body.appendChild(top); top.layoutSizingHorizontal = 'FILL';
top.appendChild(await pill('תוכנית חדשה', 'secondary', 'הוספה'));
const title = await txt('כותרת/מסך', 'יום ייצור — חמישי', 'טקסט/ראשי');
top.appendChild(title); fillText(title);
const sub = await txt('משני/14', '3 מוצרים · 11 חומרי גלם · עלות משוערת ₪412', 'טקסט/משני');
body.appendChild(sub); fillText(sub);

// products
const prod = surface('מוצרים וכמויות', 8);
body.appendChild(prod); prod.layoutSizingHorizontal = 'FILL';
const pT = await txt('כותרת/כרטיס', 'מוצרים וכמויות', 'טקסט/ראשי');
prod.appendChild(pT); fillText(pT);
const pR = rule(); prod.appendChild(pR); pR.layoutSizingHorizontal = 'FILL';
for (const [name, qty, note] of [
  ['בריוש נאנטר', '×2 מתכונים', "24 יח'"],
  ['קרואסון חמאה', '×1 מתכון', "33 יח'"],
  ['קרם פטיסייר וניל', '×1 מתכון', '1.49 ק"ג'],
]) {
  const r = row(`מוצר · ${name}`, 10);
  r.paddingTop = r.paddingBottom = 8;
  const q = await txt('כמות/17', qty, 'טקסט/ראשי', 'LEFT');
  r.appendChild(q);
  const c = col('שם והערה', 2);
  const n = await txt('גוף/16', name, 'טקסט/ראשי');
  c.appendChild(n);
  const nt = await txt('מטא/13', note, 'טקסט/משני');
  c.appendChild(nt);
  r.appendChild(c);
  prod.appendChild(r);
  r.layoutSizingHorizontal = 'FILL';
  c.layoutSizingHorizontal = 'FILL';
  fillText(n); fillText(nt);
}

// shopping list
const buy = surface('רשימת קניות', 8);
body.appendChild(buy); buy.layoutSizingHorizontal = 'FILL';
const bT = await txt('כותרת/כרטיס', 'רשימת קניות', 'טקסט/ראשי');
buy.appendChild(bT); fillText(bT);
const bLead = await txt('מטא/13', 'מחושבת מהמוצרים למעלה, בניכוי מה שיש במלאי.', 'טקסט/משני');
buy.appendChild(bLead); fillText(bLead);
const bR = rule(); buy.appendChild(bR); bR.layoutSizingHorizontal = 'FILL';
for (const [name, need, cost, flag] of [
  ['קמח לחם 13% חלבון', '4.5 ק"ג', '₪18.90', null],
  ['חמאה 82%', '2.8 ק"ג', '₪106.40', null],
  ['ביצים L', "45 יח'", '₪42.75', null],
  ['וניל בורבון', '2 מקלות', 'חסר מחיר', 'amber'],
]) {
  const r = row(`קנייה · ${name}`, 10);
  r.paddingTop = r.paddingBottom = 8;
  const c2 = await txt('גוף/16 מודגש', cost, flag ? 'משמעות/אזהרה' : 'טקסט/ראשי', 'LEFT');
  r.appendChild(c2);
  const c = col('שם וכמות', 2);
  const n = await txt('גוף/16', name, 'טקסט/ראשי');
  c.appendChild(n);
  const nt = await txt('מטא/13', `נדרש ${need}`, 'טקסט/משני');
  c.appendChild(nt);
  r.appendChild(c);
  buy.appendChild(r);
  r.layoutSizingHorizontal = 'FILL';
  c.layoutSizingHorizontal = 'FILL';
  fillText(n); fillText(nt);
}
const total = await dataRow('סה"כ לרכש (ללא הפריט החסר)', '₪168.05', { strong: true });
buy.appendChild(total.node);
total.node.layoutSizingHorizontal = 'FILL';

// work order
const order = surface('סדר עבודה', 10);
body.appendChild(order); order.layoutSizingHorizontal = 'FILL';
const oT = await txt('כותרת/כרטיס', 'סדר עבודה', 'טקסט/ראשי');
order.appendChild(oT); fillText(oT);
const oR = rule(); order.appendChild(oR); oR.layoutSizingHorizontal = 'FILL';
for (const [when, what] of [
  ['06:00', 'לישת בריוש · תפיחה בקירור 12 שע\''],
  ['06:40', 'פיתוח בלוק חמאה לקרואסון'],
  ['08:00', 'קרם פטיסייר · קירור מהיר'],
  ['18:00', 'עיצוב בריוש · תפיחה שנייה'],
]) {
  const r = row(`שלב ${when}`, 12);
  r.counterAxisAlignItems = 'MIN';
  const w = await txt('גוף/16', what, 'טקסט/ראשי');
  r.appendChild(w);
  const t = await txt('גוף/16 מודגש', when, 'פעולה/מרווה כהה', 'LEFT');
  r.appendChild(t);
  order.appendChild(r);
  r.layoutSizingHorizontal = 'FILL';
  fillText(w);
}

tabBar(screen, 'עוד');
return { createdNodeIds: [screen.id], screen: screen.name };
