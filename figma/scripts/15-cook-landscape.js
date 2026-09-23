/*
  15 · COOK MODE, SIDEWAYS  (wide page, y = 2400)

  A phone on its side (874×402) and a tablet on its side (1024×768) while the
  preparation runs. The short screen is the hard one: one step, a compact
  numeral BESIDE the instruction rather than a headline above it, the weighing
  list in two columns that still read row by row, and "הבא" pinned to the
  bottom so continuing never requires scrolling first.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.wide);
const created = [];
const Y = 2400;

// ── phone, sideways, one step ────────────────────────────────────────────
const step = screenFrame('טלפון לרוחב · מצב הכנה · שלב', 874, 402, 200, Y);
page.appendChild(step);
created.push(step.id);
const sBody = col('תוכן', 10);
sBody.paddingTop = 10; sBody.paddingBottom = 0; sBody.paddingLeft = 18; sBody.paddingRight = 18;
step.appendChild(sBody);
sBody.layoutSizingHorizontal = 'FILL';
sBody.layoutSizingVertical = 'FILL';

const sHead = row('כותרת', 8);
sBody.appendChild(sHead); sHead.layoutSizingHorizontal = 'FILL';
sHead.appendChild(await txt('משני/14', '← יציאה', 'טקסט/ראשי'));
const fsPill = row('מסך מלא', 6);
fsPill.paddingLeft = fsPill.paddingRight = 12;
fsPill.primaryAxisAlignItems = 'CENTER';
fsPill.strokes = [pf('קו/עדין')];
fsPill.strokeWeight = 1;
bindR(fsPill, 'פינה/גלולה');
fsPill.appendChild(await txt('מטא/13', 'מסך מלא', 'טקסט/משני'));
fsPill.resize(fsPill.width, 36);
fsPill.counterAxisSizingMode = 'FIXED';
sHead.appendChild(fsPill);
const sName = await txt('משני/14', 'בריוש נאנטר', 'טקסט/ראשי');
sHead.appendChild(sName);
sName.textAutoResize = 'HEIGHT';
sName.layoutSizingHorizontal = 'FILL';

const sBar = row('סרגל שלבים', 6);
sBody.appendChild(sBar); sBar.layoutSizingHorizontal = 'FILL';
for (let i = 6; i >= 1; i -= 1) {
  const seg = figma.createRectangle();
  seg.name = `שלב ${i}`;
  seg.resize(60, i === 3 ? 10 : 7);
  seg.cornerRadius = 5;
  seg.fills = [pf(i < 3 ? 'פעולה/מרווה' : i === 3 ? 'טקסט/ראשי' : 'קו/עדין')];
  sBar.appendChild(seg);
  seg.layoutSizingHorizontal = 'FILL';
}
const sProg = await txt('מטא/13', '2 מתוך 6 שלבים הושלמו', 'טקסט/משני');
sBody.appendChild(sProg); fillText(sProg);

const sStep = row('השלב', 14);
sStep.counterAxisAlignItems = 'MIN';
sBody.appendChild(sStep);
sStep.layoutSizingHorizontal = 'FILL';
sStep.layoutSizingVertical = 'FILL';
const sNum = await txt('כותרת/מתכון', '3', 'טקסט/ראשי');
sStep.appendChild(sNum);
const sTextCol = col('הוראה', 6);
sStep.appendChild(sTextCol);
sTextCol.layoutSizingHorizontal = 'FILL';
const sInstr = await txt('הכנה/הוראה רוחב', 'מוסיפים חמאה קרה בהדרגה, לישה עד מסה חלקה ומבריקה.', 'טקסט/ראשי');
sTextCol.appendChild(sInstr); fillText(sInstr);
const sMeta = await txt('מטא/13', "8 דק' · מהירות 2", 'טקסט/משני');
sTextCol.appendChild(sMeta); fillText(sMeta);
const markRow = row('סימון וטיימר', 10);
sTextCol.appendChild(markRow);
markRow.layoutSizingHorizontal = 'FILL';
const timer = row("טיימר 8 דק'", 6);
timer.paddingLeft = timer.paddingRight = 12;
timer.primaryAxisAlignItems = 'CENTER';
timer.strokes = [pf('קו/עדין')];
timer.strokeWeight = 1;
timer.fills = [pf('רקע/משטח')];
bindR(timer, 'פינה/פקד');
timer.appendChild(await txt('מטא/13', "טיימר 8 דק'", 'טקסט/ראשי'));
timer.resize(timer.width, 44);
timer.counterAxisSizingMode = 'FIXED';
markRow.appendChild(timer);
const mark = await wideButton('סימון השלב כהושלם', 'quiet');
mark.resize(mark.width, 48);
markRow.appendChild(mark);
mark.layoutSizingHorizontal = 'FILL';

const sFoot = row('ניווט בין שלבים', 10);
sFoot.paddingTop = 8; sFoot.paddingBottom = 10; sFoot.paddingLeft = 18; sFoot.paddingRight = 18;
sFoot.fills = [pf('רקע/דף')];
sFoot.strokes = [pf('קו/עדין')];
sFoot.strokeWeight = 1;
sFoot.strokeTopWeight = 1; sFoot.strokeBottomWeight = 0; sFoot.strokeLeftWeight = 0; sFoot.strokeRightWeight = 0;
step.appendChild(sFoot);
sFoot.layoutSizingHorizontal = 'FILL';
const lNext = await wideButton('הבא', 'primary');
lNext.resize(lNext.width, 48);
sFoot.appendChild(lNext);
lNext.layoutSizingHorizontal = 'FILL';
const lPrev = await wideButton('הקודם', 'quiet');
lPrev.resize(lPrev.width, 48);
sFoot.appendChild(lPrev);
lPrev.layoutSizingHorizontal = 'FILL';

// ── tablet, sideways, weighing in two columns ────────────────────────────
const mise = screenFrame('טאבלט לרוחב · מיז אן פלאס', 1024, 768, 200 + 950, Y);
page.appendChild(mise);
created.push(mise.id);
const mBody = col('תוכן', 12);
mBody.paddingTop = 18; mBody.paddingBottom = 0; mBody.paddingLeft = 24; mBody.paddingRight = 24;
mise.appendChild(mBody);
mBody.layoutSizingHorizontal = 'FILL';
mBody.layoutSizingVertical = 'FILL';

const mHead = row('כותרת', 10);
mBody.appendChild(mHead); mHead.layoutSizingHorizontal = 'FILL';
mHead.appendChild(await txt('גוף/16', '← יציאה', 'טקסט/ראשי'));
const mFs = row('מסך מלא', 6);
mFs.paddingLeft = mFs.paddingRight = 12;
mFs.primaryAxisAlignItems = 'CENTER';
mFs.strokes = [pf('קו/עדין')];
mFs.strokeWeight = 1;
bindR(mFs, 'פינה/גלולה');
mFs.appendChild(await txt('מטא/13', 'מסך מלא', 'טקסט/משני'));
mFs.resize(mFs.width, 40);
mFs.counterAxisSizingMode = 'FIXED';
mHead.appendChild(mFs);
const mName = await txt('גוף/17', 'בריוש נאנטר · מיז אן פלאס', 'טקסט/ראשי');
mHead.appendChild(mName);
mName.textAutoResize = 'HEIGHT';
mName.layoutSizingHorizontal = 'FILL';

const mTitle = await txt('הכנה/הוראה', 'הכנת חומרי גלם', 'טקסט/ראשי');
mBody.appendChild(mTitle); fillText(mTitle);
const mHelp = await txt('גוף/17', 'הכינו ושקלו את כל חומרי הגלם לפני שמתחילים בהכנה. הכמויות כאן הן של ההכנה הזאת: כמו במתכון.', 'טקסט/משני');
mBody.appendChild(mHelp); fillText(mHelp);

const mGrid = row('רשימת שקילה', 12);
mGrid.layoutWrap = 'WRAP';
mGrid.counterAxisSpacing = 12;
mGrid.counterAxisAlignItems = 'MIN';
mBody.appendChild(mGrid);
mGrid.layoutSizingHorizontal = 'FILL';
mGrid.layoutSizingVertical = 'FILL';
for (const [qty, name, done] of [
  ["500 גר'", 'קמח לחם 13% חלבון', true],
  ["275 גר'", 'ביצים', true],
  ["62 גר'", 'חלב 3%', true],
  ["60 גר'", 'סוכר', false],
  ["20 גר'", 'שמרים טריים', false],
  ["11 גר'", 'מלח', false],
  ["250 גר'", 'חמאה 82%', false],
]) {
  const r = inst('שורת/שקילה', done ? 'מסומן=כן' : 'מסומן=לא');
  mGrid.appendChild(r);
  r.resize(472, 64);
  r.layoutSizingHorizontal = 'FIXED';
  const texts = r.findAllWithCriteria({ types: ['TEXT'] });
  await setText(texts[0], qty);
  await setText(texts[1], name);
}

const mGate = row('סרגל השער', 14);
mGate.paddingTop = 12; mGate.paddingBottom = 16; mGate.paddingLeft = 24; mGate.paddingRight = 24;
mGate.fills = [pf('רקע/דף')];
mGate.strokes = [pf('קו/עדין')];
mGate.strokeWeight = 1;
mGate.strokeTopWeight = 1; mGate.strokeBottomWeight = 0; mGate.strokeLeftWeight = 0; mGate.strokeRightWeight = 0;
mise.appendChild(mGate);
mGate.layoutSizingHorizontal = 'FILL';
const mBtn = await wideButton('הכול מוכן — מתחילים בהכנה', 'disabled');
mBtn.resize(320, 54);
mBtn.primaryAxisSizingMode = 'FIXED';
mGate.appendChild(mBtn);
const mGateCol = col('הסבר השער', 4);
mGate.appendChild(mGateCol);
mGateCol.layoutSizingHorizontal = 'FILL';
const mCount = await txt('גוף/16 מודגש', '3 מתוך 7 חומרי גלם מוכנים', 'טקסט/ראשי');
mGateCol.appendChild(mCount); fillText(mCount);
const mWhy = await txt('משני/14', 'כדי להתחיל, סמנו את כל חומרי הגלם. נשארו 4.', 'טקסט/משני');
mGateCol.appendChild(mWhy); fillText(mWhy);

return { createdNodeIds: created, screens: ['טלפון לרוחב · שלב', 'טאבלט לרוחב · מיז אן פלאס'] };
