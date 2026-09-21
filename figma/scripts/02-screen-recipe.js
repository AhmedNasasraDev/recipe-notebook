/*
  02 · PHONE · RECIPE SCREEN  (402×874, phone slot 1)

  The screen a cook actually stands in front of, in the order the work happens:
  identity → the one action that starts cooking → how much to make → what to
  weigh → what to do. The professional material (food cost, yield, pan, version
  history) is a closed disclosure at the end, because it is read at a desk and
  not at a mixer.

  Content is the real recipe from the app's own demo data (בריוש נאנטר), so the
  quantities, times and units are the ones the engine computes — no invented
  numbers.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.phone);
const screen = screenFrame('טלפון · מתכון', 402, 874, 200 + 482 * 1, 200);
page.appendChild(screen);
const body = screenBody(screen, 14);

// ── back ────────────────────────────────────────────────────────────────
const back = row('חזרה', 6);
back.appendChild(await txt('גוף/16', '← המחברת', 'טקסט/משני'));
body.appendChild(back);

// ── identity ────────────────────────────────────────────────────────────
const head = col('זהות המתכון', 6);
body.appendChild(head);
head.layoutSizingHorizontal = 'FILL';
const h1 = await txt('כותרת/מתכון', 'בריוש נאנטר', 'טקסט/ראשי');
head.appendChild(h1); fillText(h1);
const meta = await txt('משני/14', "12 יחידות · 85 גר' ליחידה · 3 שע' 38 דק' עבודה ואפייה", 'טקסט/משני');
head.appendChild(meta); fillText(meta);
head.appendChild(await tag('נוסחה מאושרת לייצור', 'amber'));

// ── the action that starts the work ─────────────────────────────────────
const cook = await wideButton('מצב הכנה', 'primary');
body.appendChild(cook);
cook.layoutSizingHorizontal = 'FILL';
cook.name = 'כפתור · מצב הכנה';

// ── how much to make ────────────────────────────────────────────────────
const scale = surface('כמה להכין?', 10);
body.appendChild(scale);
scale.layoutSizingHorizontal = 'FILL';
const scaleTitle = await txt('כותרת/כרטיס', 'כמה להכין?', 'טקסט/ראשי');
scale.appendChild(scaleTitle); fillText(scaleTitle);
const r1 = rule(); scale.appendChild(r1); r1.layoutSizingHorizontal = 'FILL';
const modes = await segmented('מצבי כמות', [['כמו במתכון', true], ['יחידות', false], ['משקל', false], ['לפי מלאי', false]]);
scale.appendChild(modes); modes.layoutSizingHorizontal = 'FILL';
const chosen = await txt('גוף/16 מודגש', 'כמו במתכון · 1.15 ק"ג · 12 יחידות', 'טקסט/ראשי');
scale.appendChild(chosen); fillText(chosen);
const scaleNote = await txt('מטא/13', 'שינוי הכמויות כאן הוא חישוב בלבד. המתכון המקורי לא משתנה.', 'טקסט/משני');
scale.appendChild(scaleNote); fillText(scaleNote);

// ── ingredients ─────────────────────────────────────────────────────────
const ing = surface('רכיבים', 8);
body.appendChild(ing);
ing.layoutSizingHorizontal = 'FILL';
const ingHead = row('כותרת רכיבים', 10);
ing.appendChild(ingHead); ingHead.layoutSizingHorizontal = 'FILL';
const ingUnits = await segmented('יחידות תצוגה', [['כמו במתכון', true], ['גרמים', false], ['ביתי', false]]);
ingHead.appendChild(ingUnits);
const ingTitle = await txt('כותרת/כרטיס', 'רכיבים', 'טקסט/ראשי');
ingHead.appendChild(ingTitle); fillText(ingTitle);
const r2 = rule(); ing.appendChild(r2); r2.layoutSizingHorizontal = 'FILL';

const ROWS = [
  ["500 גר'", 'קמח לחם 13% חלבון', '', null],
  ["5 יח'", 'ביצים', "275 גר' · בטמפ' החדר", 'plain'],
  ['60 מ"ל', 'חלב 3%', "62 גר'", 'amber'],
  ["60 גר'", 'סוכר', '', null],
  ["20 גר'", 'שמרים טריים', '', null],
  ["11 גר'", 'מלח', '', null],
  ["250 גר'", 'חמאה 82%', 'קרה, בקוביות', null],
];
const rowsWrap = col('שורות רכיבים', 0);
ing.appendChild(rowsWrap); rowsWrap.layoutSizingHorizontal = 'FILL';
for (let i = 0; i < ROWS.length; i += 1) {
  const [qty, name, note, badge] = ROWS[i];
  const r = row(`רכיב · ${name}`, 12);
  r.paddingTop = r.paddingBottom = 12;
  const q = await txt('כמות/17', qty, 'טקסט/ראשי', 'LEFT');
  r.appendChild(q);
  const c = col('שם והערה', 2);
  const nm = await txt('גוף/16', name, 'טקסט/ראשי');
  c.appendChild(nm);
  if (note) {
    const nt = await txt('מטא/13', note, 'טקסט/משני');
    c.appendChild(nt);
  }
  r.appendChild(c);
  if (badge) r.appendChild(await tag(badge === 'amber' ? 'נתון מערכת' : 'נתון מהמתכון', badge === 'amber' ? 'amber' : 'plain'));
  rowsWrap.appendChild(r);
  r.layoutSizingHorizontal = 'FILL';
  c.layoutSizingHorizontal = 'FILL';
  fillText(nm);
  if (i < ROWS.length - 1) {
    const sep = rule();
    rowsWrap.appendChild(sep);
    sep.layoutSizingHorizontal = 'FILL';
    sep.opacity = 0.6;
  }
}

// ── steps ───────────────────────────────────────────────────────────────
const steps = surface('שלבים', 14);
body.appendChild(steps);
steps.layoutSizingHorizontal = 'FILL';
const stepsTitle = await txt('כותרת/כרטיס', 'שלבי הכנה', 'טקסט/ראשי');
steps.appendChild(stepsTitle); fillText(stepsTitle);
const r3 = rule(); steps.appendChild(r3); r3.layoutSizingHorizontal = 'FILL';
const STEPS = [
  ['1', 'לשים קמח, ביצים, חלב, סוכר ושמרים בווים 4 דקות במהירות נמוכה.', "4 דק'"],
  ['2', 'מוסיפים מלח וממשיכים 6 דקות עד פיתוח גלוטן בינוני.', "6 דק'"],
  ['3', 'מוסיפים חמאה קרה בהדרגה, לישה עד מסה חלקה ומבריקה.', "8 דק'"],
  ['4', 'תפיחה ראשונה בקירור, 12 שעות ב-4°C.', "12 שע'"],
];
for (const [num, text, dur] of STEPS) {
  const s = row(`שלב ${num}`, 12);
  s.counterAxisAlignItems = 'MIN';
  const c = col('תוכן השלב', 3);
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
  steps.appendChild(s);
  s.layoutSizingHorizontal = 'FILL';
  c.layoutSizingHorizontal = 'FILL';
  fillText(st);
  fillText(sd);
}

// ── professional material, folded away ──────────────────────────────────
for (const label of ['פרטים מקצועיים', 'עוד פעולות']) {
  const d = row(label, 10);
  d.paddingLeft = d.paddingRight = 16;
  d.paddingTop = d.paddingBottom = 14;
  d.fills = [pf('רקע/משטח')];
  d.strokes = [pf('קו/עדין')];
  d.strokeWeight = 1;
  bindR(d, 'פינה/כרטיס גדול');
  d.appendChild(icon('חץ קדימה', 'טקסט/משני', 20));
  const t = await txt('גוף/16 מודגש', label, 'טקסט/ראשי');
  d.appendChild(t);
  body.appendChild(d);
  d.layoutSizingHorizontal = 'FILL';
  fillText(t);
}

const allerg = await txt('משני/14', 'מכיל: גלוטן · חלב · ביצים', 'טקסט/משני');
body.appendChild(allerg); fillText(allerg);

tabBar(screen, 'מחברת');
return { createdNodeIds: [screen.id], screen: screen.name };
