/*
  06 · PHONE · CREATE & EDIT, IN STAGES  (402×874, phone slots 5 and 6)

  Two frames, because the point of the flow is that it is gradual:
    · stage 1 — "מה מכינים": name, category, yield. Nothing else on screen.
    · stage 3 — "רכיבים", with one row in error and unsaved changes pending.

  Saving is deliberate: the bar is pinned, the button states what it will do,
  an error sits UNDER the field that caused it (never a banner at the top that
  makes you hunt), and nothing the cook typed is ever cleared on failure.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.phone);
const created = [];

// ── stage 1 ───────────────────────────────────────────────────────────────
const s1 = screenFrame('טלפון · יצירה · שלב 1', 402, 874, 200 + 482 * 5, 200);
page.appendChild(s1);
created.push(s1.id);
const b1 = screenBody(s1, 14);
b1.paddingBottom = 0;

const top1 = row('ראש המסך', 10);
b1.appendChild(top1); top1.layoutSizingHorizontal = 'FILL';
top1.appendChild(await txt('משני/14', '← ביטול', 'טקסט/משני'));
const t1 = await txt('כותרת/מסך', 'מתכון חדש', 'טקסט/ראשי');
top1.appendChild(t1); fillText(t1);

const steps = row('התקדמות', 6);
b1.appendChild(steps); steps.layoutSizingHorizontal = 'FILL';
for (let i = 4; i >= 1; i -= 1) {
  const seg = figma.createRectangle();
  seg.name = `שלב ${i}`;
  seg.resize(40, i === 1 ? 6 : 4);
  seg.cornerRadius = 3;
  seg.fills = [pf(i === 1 ? 'פעולה/מרווה' : 'קו/עדין')];
  steps.appendChild(seg);
  seg.layoutSizingHorizontal = 'FILL';
}
const stepLbl = await txt('משני/14', 'שלב 1 מתוך 4 · מה מכינים', 'טקסט/משני');
b1.appendChild(stepLbl); fillText(stepLbl);

const card1 = surface('פרטים בסיסיים', 14);
b1.appendChild(card1); card1.layoutSizingHorizontal = 'FILL';
const c1t = await txt('כותרת/כרטיס', 'פרטים בסיסיים', 'טקסט/ראשי');
card1.appendChild(c1t); fillText(c1t);
const r1 = rule(); card1.appendChild(r1); r1.layoutSizingHorizontal = 'FILL';

const nameField = inst('טופס/שדה', 'מצב=רגיל');
card1.appendChild(nameField);
nameField.layoutSizingHorizontal = 'FILL';
const nfTexts = nameField.findAllWithCriteria({ types: ['TEXT'] });
await setText(nfTexts[0], 'שם המתכון');
await setText(nfTexts[1], 'בריוש שוקולד');

const catCol = col('קטגוריה', 6);
card1.appendChild(catCol); catCol.layoutSizingHorizontal = 'FILL';
const catLbl = await txt('מטא/13', 'קטגוריה', 'טקסט/משני');
catCol.appendChild(catLbl); fillText(catLbl);
const cats = await segmented('בחירת קטגוריה', [['בצקים', true], ['לחמים', false], ['קרמים', false]]);
catCol.appendChild(cats); cats.layoutSizingHorizontal = 'FILL';

const yieldCol = col('תפוקה', 6);
card1.appendChild(yieldCol); yieldCol.layoutSizingHorizontal = 'FILL';
const yLbl = await txt('מטא/13', 'תפוקה', 'טקסט/משני');
yieldCol.appendChild(yLbl); fillText(yLbl);
const yRow = row('שדות תפוקה', 10);
yieldCol.appendChild(yRow); yRow.layoutSizingHorizontal = 'FILL';
for (const [label, value] of [["גר' ליחידה", '105'], ['יחידות', '12']]) {
  const f = col(label, 4);
  const l = await txt('מטא/12', label, 'טקסט/משני');
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
  yRow.appendChild(f);
  f.layoutSizingHorizontal = 'FILL';
  fillText(l);
  box.layoutSizingHorizontal = 'FILL';
  box.resize(box.width, 48);
  box.counterAxisSizingMode = 'FIXED';
  fillText(v);
}
const hint = await txt('מטא/13', 'אפשר להשלים מחירים, פחת ואלרגנים בשלב 4 — לא חייבים עכשיו.', 'טקסט/משני');
card1.appendChild(hint); fillText(hint);

const save1 = row('סרגל שמירה', 10);
save1.paddingTop = 12; save1.paddingBottom = 16; save1.paddingLeft = 16; save1.paddingRight = 16;
save1.fills = [pf('רקע/דף')];
save1.strokes = [pf('קו/עדין')];
save1.strokeWeight = 1;
save1.strokeTopWeight = 1; save1.strokeBottomWeight = 0; save1.strokeLeftWeight = 0; save1.strokeRightWeight = 0;
s1.appendChild(save1);
save1.layoutSizingHorizontal = 'FILL';
const next1 = await wideButton('המשך לרכיבים', 'primary');
save1.appendChild(next1);
next1.layoutSizingHorizontal = 'FILL';
const draft1 = await wideButton('שמירה כטיוטה', 'quiet');
save1.appendChild(draft1);

// ── stage 3, with an error and unsaved changes ────────────────────────────
const s3 = screenFrame('טלפון · יצירה · שלב 3 · שגיאה', 402, 874, 200 + 482 * 6, 200);
page.appendChild(s3);
created.push(s3.id);
const b3 = screenBody(s3, 14);
b3.paddingBottom = 0;

const top3 = row('ראש המסך', 10);
b3.appendChild(top3); top3.layoutSizingHorizontal = 'FILL';
top3.appendChild(await txt('משני/14', '← חזרה', 'טקסט/משני'));
const t3 = await txt('כותרת/מסך', 'עריכת מתכון', 'טקסט/ראשי');
top3.appendChild(t3); fillText(t3);

const unsaved = inst('הודעה/מצב', 'סוג=אזהרה');
b3.appendChild(unsaved);
unsaved.layoutSizingHorizontal = 'FILL';
await setText(unsaved.findOne((n) => n.type === 'TEXT'), 'יש שינויים שלא נשמרו. יציאה עכשיו תאבד אותם.');

const steps3 = row('התקדמות', 6);
b3.appendChild(steps3); steps3.layoutSizingHorizontal = 'FILL';
for (let i = 4; i >= 1; i -= 1) {
  const seg = figma.createRectangle();
  seg.name = `שלב ${i}`;
  seg.resize(40, i === 3 ? 6 : 4);
  seg.cornerRadius = 3;
  seg.fills = [pf(i <= 3 ? 'פעולה/מרווה' : 'קו/עדין')];
  steps3.appendChild(seg);
  seg.layoutSizingHorizontal = 'FILL';
}
const stepLbl3 = await txt('משני/14', 'שלב 3 מתוך 4 · רכיבים', 'טקסט/משני');
b3.appendChild(stepLbl3); fillText(stepLbl3);

const card3 = surface('רכיבים', 12);
b3.appendChild(card3); card3.layoutSizingHorizontal = 'FILL';
const c3t = await txt('כותרת/כרטיס', 'רכיבים', 'טקסט/ראשי');
card3.appendChild(c3t); fillText(c3t);
const r3 = rule(); card3.appendChild(r3); r3.layoutSizingHorizontal = 'FILL';

// one good row
const okRow = row('רכיב 1', 10);
card3.appendChild(okRow); okRow.layoutSizingHorizontal = 'FILL';
const okQty = await txt('כמות/17', "500 גר'", 'טקסט/ראשי', 'LEFT');
okRow.appendChild(okQty);
const okName = await txt('גוף/16', 'קמח לחם 13% חלבון', 'טקסט/ראשי');
okRow.appendChild(okName); fillText(okName);

// the row in error — the message sits under the field that caused it
const badField = inst('טופס/שדה', 'מצב=שגיאה');
card3.appendChild(badField);
badField.layoutSizingHorizontal = 'FILL';
const bfTexts = badField.findAllWithCriteria({ types: ['TEXT'] });
await setText(bfTexts[0], 'כמות · רכיב 2 (ביצים)');
await setText(bfTexts[1], 'שלוש');
await setText(bfTexts[2], 'הכמות חייבת להיות מספר. אפשר לכתוב 275 או 5 יח\'.');

const addRow = await wideButton('+ הוספת רכיב', 'quiet');
card3.appendChild(addRow);
addRow.layoutSizingHorizontal = 'FILL';

const save3 = col('סרגל שמירה', 8);
save3.paddingTop = 12; save3.paddingBottom = 16; save3.paddingLeft = 16; save3.paddingRight = 16;
save3.fills = [pf('רקע/דף')];
save3.strokes = [pf('קו/עדין')];
save3.strokeWeight = 1;
save3.strokeTopWeight = 1; save3.strokeBottomWeight = 0; save3.strokeLeftWeight = 0; save3.strokeRightWeight = 0;
s3.appendChild(save3);
save3.layoutSizingHorizontal = 'FILL';
const whyOff = await txt('משני/14', 'לא ניתן לשמור עדיין: יש שדה אחד עם שגיאה.', 'טקסט/משני');
save3.appendChild(whyOff); fillText(whyOff);
const saveBtn = await wideButton('שמירת השינויים', 'disabled');
save3.appendChild(saveBtn);
saveBtn.layoutSizingHorizontal = 'FILL';

return { createdNodeIds: created, screens: ['שלב 1', 'שלב 3'] };
