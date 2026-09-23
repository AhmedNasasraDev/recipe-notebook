/*
  12 · PHONE · THE FIVE STATES  (states row, y=1180)

  Five frames in a row, because these are the screens a design usually skips
  and a kitchen meets on its first morning:
    1. loading — the shape of the content, not a spinner in the void
    2. empty notebook — one sentence and one way forward
    3. error — what failed, what is kept, and one retry
    4. saved — a quiet confirmation that does not block the next action
    5. unsaved changes — a decision, with the recipe named in it
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.phone);
const Y = 1180;
const X0 = 200;
const PITCH = 482;
const created = [];

// 1 · loading
const load = screenFrame('מצב · טעינה', 402, 874, X0, Y);
page.appendChild(load); created.push(load.id);
const lb = screenBody(load, 14);
const lTitle = await txt('כותרת/מסך', 'מחברת מתכונים', 'טקסט/ראשי');
lb.appendChild(lTitle); fillText(lTitle);
const lNote = await txt('משני/14', 'טוען את המחברת…', 'טקסט/משני');
lb.appendChild(lNote); fillText(lNote);
for (let i = 0; i < 4; i += 1) {
  const sk = col(`שלד ${i + 1}`, 8);
  sk.paddingTop = sk.paddingBottom = 16; sk.paddingLeft = sk.paddingRight = 16;
  sk.fills = [pf('רקע/משטח')];
  sk.strokes = [pf('קו/עדין')];
  sk.strokeWeight = 1;
  bindR(sk, 'פינה/כרטיס');
  for (const w of [0.55, 0.85]) {
    const bar = figma.createRectangle();
    bar.name = 'שלד שורה';
    bar.resize(338 * w, w === 0.55 ? 18 : 12);
    bar.cornerRadius = 6;
    bar.fills = [pf('רקע/מושבת')];
    sk.appendChild(bar);
  }
  lb.appendChild(sk);
  sk.layoutSizingHorizontal = 'FILL';
}
tabBar(load, 'מחברת');

// 2 · empty
const empty = screenFrame('מצב · מחברת ריקה', 402, 874, X0 + PITCH, Y);
page.appendChild(empty); created.push(empty.id);
const eb = screenBody(empty, 16);
const eTitle = await txt('כותרת/מסך', 'מחברת מתכונים', 'טקסט/ראשי');
eb.appendChild(eTitle); fillText(eTitle);
const box = col('מצב ריק', 10);
box.paddingTop = 28; box.paddingBottom = 28; box.paddingLeft = 20; box.paddingRight = 20;
box.counterAxisAlignItems = 'CENTER';
box.fills = [pf('רקע/משטח')];
box.strokes = [pf('קו/עדין')];
box.strokeWeight = 1;
box.dashPattern = [6, 5];
bindR(box, 'פינה/כרטיס גדול');
eb.appendChild(box);
box.layoutSizingHorizontal = 'FILL';
box.appendChild(icon('מחברת', 'טקסט/משני', 32));
const eH = await txt('כותרת/כרטיס', 'המחברת עוד ריקה', 'טקסט/ראשי', 'CENTER');
box.appendChild(eH); fillText(eH);
const eB = await txt('משני/14', 'אפשר להתחיל ממתכון חדש, או להדביק מתכון מטקסט וליישר אותו לשדות.', 'טקסט/משני', 'CENTER');
box.appendChild(eB); fillText(eB);
const eBtn = await wideButton('מתכון חדש', 'primary');
box.appendChild(eBtn);
const eAlt = await txt('משני/14', 'הדבקת מתכון מטקסט', 'פעולה/מרווה כהה', 'CENTER');
box.appendChild(eAlt); fillText(eAlt);
tabBar(empty, 'מחברת');

// 3 · error
const err = screenFrame('מצב · שגיאת שמירה', 402, 874, X0 + PITCH * 2, Y);
page.appendChild(err); created.push(err.id);
const rb = screenBody(err, 14);
const rTop = row('ראש המסך', 10);
rb.appendChild(rTop); rTop.layoutSizingHorizontal = 'FILL';
rTop.appendChild(await txt('משני/14', '← חזרה', 'טקסט/משני'));
const rTitle = await txt('כותרת/מסך', 'עריכת מתכון', 'טקסט/ראשי');
rTop.appendChild(rTitle); fillText(rTitle);
const banner = inst('הודעה/מצב', 'סוג=שגיאה');
rb.appendChild(banner);
banner.layoutSizingHorizontal = 'FILL';
await setText(banner.findOne((n) => n.type === 'TEXT'), 'השמירה נכשלה — אין חיבור כרגע. מה שהקלדתם נשמר במכשיר ולא אבד.');
const errCard = surface('מה עושים', 10);
rb.appendChild(errCard); errCard.layoutSizingHorizontal = 'FILL';
const ecT = await txt('כותרת/כרטיס', 'הטיוטה שמורה במכשיר', 'טקסט/ראשי');
errCard.appendChild(ecT); fillText(ecT);
const ecB = await txt('משני/14', 'אפשר לנסות לשמור שוב עכשיו, או להמשיך לעבוד ולשמור כשהחיבור יחזור. שום שדה לא נוקה.', 'טקסט/משני');
errCard.appendChild(ecB); fillText(ecB);
const retry = await wideButton('נסיון שמירה נוסף', 'primary');
errCard.appendChild(retry);
retry.layoutSizingHorizontal = 'FILL';
const keep = await wideButton('להמשיך לעבוד', 'quiet');
errCard.appendChild(keep);
keep.layoutSizingHorizontal = 'FILL';

// 4 · saved
const saved = screenFrame('מצב · נשמר', 402, 874, X0 + PITCH * 3, Y);
page.appendChild(saved); created.push(saved.id);
const sb = screenBody(saved, 14);
const svTop = await txt('כותרת/מתכון', 'בריוש שוקולד', 'טקסט/ראשי');
sb.appendChild(svTop); fillText(svTop);
const svMeta = await txt('משני/14', "12 יחידות · 105 גר' ליחידה", 'טקסט/משני');
sb.appendChild(svMeta); fillText(svMeta);
const okBanner = inst('הודעה/מצב', 'סוג=נשמר');
sb.appendChild(okBanner);
okBanner.layoutSizingHorizontal = 'FILL';
await setText(okBanner.findOne((n) => n.type === 'TEXT'), 'המתכון נשמר · גרסה V3 · לפני רגע');
for (let i = 0; i < 3; i += 1) {
  const c = surface(`סעיף ${i + 1}`, 8);
  const t = await txt('גוף/16', ['רכיבים · 7 שורות', 'שלבים · 6 שלבים', 'פרטים מקצועיים · פוד קוסט, תשואה, גרסאות'][i], 'טקסט/ראשי');
  c.appendChild(t);
  sb.appendChild(c);
  c.layoutSizingHorizontal = 'FILL';
  fillText(t);
}
tabBar(saved, 'מחברת');

// 5 · unsaved changes
const unsaved = screenFrame('מצב · שינויים שלא נשמרו', 402, 874, X0 + PITCH * 4, Y);
page.appendChild(unsaved); created.push(unsaved.id);
const ub = screenBody(unsaved, 14);
ub.opacity = 1;
const uTitle = await txt('כותרת/מסך', 'עריכת מתכון', 'טקסט/ראשי');
ub.appendChild(uTitle); fillText(uTitle);
for (let i = 0; i < 3; i += 1) {
  const ghost = surface(`שדה מעומעם ${i + 1}`, 8);
  ghost.opacity = 0.4;
  const t = await txt('גוף/16', ['שם המתכון · בריוש שוקולד', 'רכיבים · 7 שורות', 'שלבים · 6 שלבים'][i], 'טקסט/ראשי');
  ghost.appendChild(t);
  ub.appendChild(ghost);
  ghost.layoutSizingHorizontal = 'FILL';
  fillText(t);
}
const dialog = col('דיאלוג · יציאה', 12);
dialog.paddingTop = 20; dialog.paddingBottom = 20; dialog.paddingLeft = 16; dialog.paddingRight = 16;
dialog.fills = [pf('רקע/משטח')];
dialog.strokes = [pf('קו/עדין')];
dialog.strokeWeight = 1;
bindR(dialog, 'פינה/כרטיס גדול');
dialog.effects = [{ type: 'DROP_SHADOW', color: { r: 0.16, g: 0.18, b: 0.16, a: 0.2 }, offset: { x: 0, y: 10 }, radius: 28, spread: 0, visible: true, blendMode: 'NORMAL' }];
ub.appendChild(dialog);
dialog.layoutSizingHorizontal = 'FILL';
const dT = await txt('כותרת/כרטיס', 'לצאת בלי לשמור?', 'טקסט/ראשי');
dialog.appendChild(dT); fillText(dT);
const dB = await txt('גוף/16', 'לבריוש שוקולד יש שינויים שלא נשמרו: שם, שני רכיבים ושלב אחד. יציאה עכשיו תאבד אותם.', 'טקסט/ראשי');
dialog.appendChild(dB); fillText(dB);
const dActions = row('פעולות הדיאלוג', 10);
dialog.appendChild(dActions); dActions.layoutSizingHorizontal = 'FILL';
const dStay = await wideButton('חזרה לעריכה', 'quiet');
dActions.appendChild(dStay);
const dSave = await wideButton('שמירה ויציאה', 'primary');
dActions.appendChild(dSave);
dSave.layoutSizingHorizontal = 'FILL';
const dDiscard = await txt('משני/14', 'יציאה בלי לשמור', 'משמעות/שגיאה', 'CENTER');
dialog.appendChild(dDiscard); fillText(dDiscard);

return { createdNodeIds: created, states: 5 };
