/*
  04 · PHONE · MISE EN PLACE  (402×874, phone slot 3)

  The stage that cannot be skipped: weigh everything before the first step.
  Every row is a real ingredient of this batch with its computed quantity, a
  28px tick and a 64px target; the progress counts the recipe's own ingredients
  (7 here, never a number copied from a mockup). The gate is pinned to the
  bottom with a drawn edge — not a shadow that washes over the last card — and
  while it is shut it says, in one line, exactly what is missing.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.phone);
const screen = screenFrame('טלפון · מיז אן פלאס', 402, 874, 200 + 482 * 3, 200);
page.appendChild(screen);
const body = screenBody(screen, 12);
body.paddingBottom = 0;

// header: way out · recipe · fullscreen (nothing in the far corner)
const head = row('כותרת מצב הכנה', 8);
body.appendChild(head); head.layoutSizingHorizontal = 'FILL';
head.appendChild(await txt('משני/14', '← יציאה', 'טקסט/ראשי'));
const fs = row('מסך מלא', 6);
fs.paddingLeft = fs.paddingRight = 12;
fs.primaryAxisAlignItems = 'CENTER';
fs.strokes = [pf('קו/עדין')];
fs.strokeWeight = 1;
bindR(fs, 'פינה/גלולה');
fs.appendChild(await txt('מטא/13', 'מסך מלא', 'טקסט/משני'));
fs.appendChild(icon('מסך מלא', 'טקסט/משני', 16));
fs.resize(fs.width, 40);
fs.counterAxisSizingMode = 'FIXED';
head.appendChild(fs);
const rName = await txt('גוף/17', 'בריוש נאנטר', 'טקסט/ראשי');
head.appendChild(rName);
rName.textAutoResize = 'HEIGHT';
rName.layoutSizingHorizontal = 'FILL';

const title = await txt('הכנה/הוראה', 'הכנת חומרי גלם', 'טקסט/ראשי');
body.appendChild(title); fillText(title);
const help = await txt('גוף/17', 'הכינו ושקלו את כל חומרי הגלם לפני שמתחילים בהכנה.', 'טקסט/ראשי');
body.appendChild(help); fillText(help);
const batch = await txt('משני/14', 'הכמויות כאן הן של ההכנה הזאת: כמו במתכון', 'טקסט/משני');
body.appendChild(batch); fillText(batch);

// the list — the recipe's own seven rows, the first two already weighed
const MISE = [
  ["500 גר'", 'קמח לחם 13% חלבון', true],
  ["275 גר'", 'ביצים', true],
  ["62 גר'", 'חלב 3%', false],
  ["60 גר'", 'סוכר', false],
  ["20 גר'", 'שמרים טריים', false],
  ["11 גר'", 'מלח', false],
  ["250 גר'", 'חמאה 82%', false],
];
const list = col('רשימת שקילה', 10);
body.appendChild(list);
list.layoutSizingHorizontal = 'FILL';
list.layoutSizingVertical = 'FILL';
for (const [qty, name, done] of MISE) {
  const r = inst('שורת/שקילה', done ? 'מסומן=כן' : 'מסומן=לא');
  list.appendChild(r);
  r.layoutSizingHorizontal = 'FILL';
  const texts = r.findAllWithCriteria({ types: ['TEXT'] });
  await setText(texts[0], qty);
  await setText(texts[1], name);
}

// the gate, pinned, with the reason it is shut
const gate = col('סרגל השער', 6);
gate.paddingTop = 12; gate.paddingBottom = 16; gate.paddingLeft = 16; gate.paddingRight = 16;
gate.fills = [pf('רקע/דף')];
gate.strokes = [pf('קו/עדין')];
gate.strokeWeight = 1;
gate.strokeTopWeight = 1; gate.strokeBottomWeight = 0; gate.strokeLeftWeight = 0; gate.strokeRightWeight = 0;
screen.appendChild(gate);
gate.layoutSizingHorizontal = 'FILL';
const count = await txt('משני/14', '2 מתוך 7 חומרי גלם מוכנים', 'טקסט/משני');
gate.appendChild(count); fillText(count);
const why = await txt('משני/14', 'כדי להתחיל, סמנו את כל חומרי הגלם. נשארו 5.', 'טקסט/משני');
gate.appendChild(why); fillText(why);
const btn = await wideButton('הכול מוכן — מתחילים בהכנה', 'disabled');
gate.appendChild(btn);
btn.layoutSizingHorizontal = 'FILL';
btn.name = 'שער · מתחילים בהכנה';

return { createdNodeIds: [screen.id], screen: screen.name, rows: MISE.length };
