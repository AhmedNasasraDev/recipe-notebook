/*
  05 · PHONE · COOK MODE, ONE STEP  (402×874, phone slot 4)

  Read at arm's length with flour on your hands: one step on the screen, the
  instruction at 25px, a progress bar of one segment per step that can be
  jumped, a timer per step that has a duration, and the way forward filled in
  sage at the bottom right. The ingredient list is one press away and closed by
  default, because it competes with the instruction for the same pixels.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.phone);
const screen = screenFrame('טלפון · מצב הכנה · שלב', 402, 874, 200 + 482 * 4, 200);
page.appendChild(screen);
const body = screenBody(screen, 14);
body.paddingBottom = 0;

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

// progress: one segment per step, done in sage, current darker and taller
const bar = row('סרגל שלבים', 6);
bar.counterAxisAlignItems = 'CENTER';
body.appendChild(bar); bar.layoutSizingHorizontal = 'FILL';
for (let i = 6; i >= 1; i -= 1) {
  const seg = figma.createRectangle();
  seg.name = `שלב ${i}`;
  const state = i < 3 ? 'done' : i === 3 ? 'now' : 'todo';
  seg.resize(40, state === 'now' ? 12 : 8);
  seg.cornerRadius = 6;
  seg.fills = [pf(state === 'done' ? 'פעולה/מרווה' : state === 'now' ? 'טקסט/ראשי' : 'קו/עדין')];
  bar.appendChild(seg);
  seg.layoutSizingHorizontal = 'FILL';
}
const progress = await txt('משני/14', '2 מתוך 6 שלבים הושלמו', 'טקסט/משני');
body.appendChild(progress); fillText(progress);

// the step itself
const stepBox = row('השלב', 14);
stepBox.counterAxisAlignItems = 'MIN';
body.appendChild(stepBox);
stepBox.layoutSizingHorizontal = 'FILL';
const num = await txt('הכנה/שלב', '3', 'טקסט/ראשי');
stepBox.appendChild(num);
const stepCol = col('טקסט השלב', 8);
stepBox.appendChild(stepCol);
stepCol.layoutSizingHorizontal = 'FILL';
const stepText = await txt('הכנה/הוראה', 'מוסיפים חמאה קרה בהדרגה, לישה עד מסה חלקה ומבריקה.', 'טקסט/ראשי');
stepCol.appendChild(stepText); fillText(stepText);
const stepMeta = await txt('משני/14', "8 דק' · מהירות 2", 'טקסט/משני');
stepCol.appendChild(stepMeta); fillText(stepMeta);

const mark = await wideButton('סימון השלב כהושלם', 'quiet');
body.appendChild(mark);
mark.layoutSizingHorizontal = 'FILL';

const timerRow = row('טיימר', 10);
body.appendChild(timerRow);
timerRow.layoutSizingHorizontal = 'FILL';
timerRow.primaryAxisAlignItems = 'MIN';
const timerBtn = row("הפעלת טיימר ל-8 דק'", 6);
timerBtn.paddingLeft = timerBtn.paddingRight = 14;
timerBtn.primaryAxisAlignItems = 'CENTER';
timerBtn.strokes = [pf('קו/עדין')];
timerBtn.strokeWeight = 1;
timerBtn.fills = [pf('רקע/משטח')];
bindR(timerBtn, 'פינה/פקד');
timerBtn.appendChild(await txt('משני/14', "הפעלת טיימר ל-8 דק'", 'טקסט/ראשי'));
timerBtn.appendChild(icon('טיימר', 'טקסט/ראשי', 18));
timerBtn.resize(timerBtn.width, 44);
timerBtn.counterAxisSizingMode = 'FIXED';
timerRow.appendChild(timerBtn);

// a running timer, as it looks while counting down
const running = row('טיימר פועל', 10);
running.paddingLeft = running.paddingRight = 14;
running.paddingTop = running.paddingBottom = 10;
running.fills = [pf('רקע/בחירה')];
bindR(running, 'פינה/כרטיס');
body.appendChild(running);
running.layoutSizingHorizontal = 'FILL';
const clock = await txt('כמות/17', '04:12', 'פעולה/מרווה כהה', 'LEFT');
running.appendChild(clock);
const rlbl = await txt('משני/14', "שלב 2 · תפיחה · נשארו 4 דק'", 'פעולה/מרווה כהה');
running.appendChild(rlbl);
rlbl.textAutoResize = 'HEIGHT';
rlbl.layoutSizingHorizontal = 'FILL';

const spacer = figma.createFrame();
spacer.name = 'רווח';
spacer.fills = [];
body.appendChild(spacer);
spacer.layoutSizingHorizontal = 'FILL';
spacer.layoutSizingVertical = 'FILL';

const ings = row('הרכיבים', 10);
ings.paddingTop = 12;
ings.strokes = [pf('קו/עדין')];
ings.strokeWeight = 1;
ings.strokeTopWeight = 1; ings.strokeBottomWeight = 0; ings.strokeLeftWeight = 0; ings.strokeRightWeight = 0;
body.appendChild(ings);
ings.layoutSizingHorizontal = 'FILL';
ings.appendChild(icon('חץ קדימה', 'טקסט/משני', 18));
const ingsT = await txt('משני/14', 'הרכיבים של השלב הזה', 'טקסט/ראשי');
ings.appendChild(ingsT); fillText(ingsT);

// footer: forward is filled, back is available but quiet
const foot = row('ניווט בין שלבים', 10);
foot.paddingTop = 8; foot.paddingBottom = 16; foot.paddingLeft = 16; foot.paddingRight = 16;
foot.fills = [pf('רקע/דף')];
foot.strokes = [pf('קו/עדין')];
foot.strokeWeight = 1;
foot.strokeTopWeight = 1; foot.strokeBottomWeight = 0; foot.strokeLeftWeight = 0; foot.strokeRightWeight = 0;
screen.appendChild(foot);
foot.layoutSizingHorizontal = 'FILL';
const next = await wideButton('הבא', 'primary');
next.name = 'ניווט · הבא';
foot.appendChild(next);
next.layoutSizingHorizontal = 'FILL';
const prev = await wideButton('הקודם', 'quiet');
prev.name = 'ניווט · הקודם';
foot.appendChild(prev);
prev.layoutSizingHorizontal = 'FILL';

return { createdNodeIds: [screen.id], screen: screen.name };
