/*
  03 · PHONE · CHANGING THE BATCH  (402×874, phone slot 2)

  A bottom sheet over the recipe, because changing how much to make is a
  decision taken WHILE reading the recipe — not a place you navigate to. Three
  ways in (multiplier, units, target weight) and a fourth that reads the
  ingredient centre; whichever is chosen, the sheet states the resulting batch
  in words before anything is applied, and says plainly that the stored recipe
  does not change.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.phone);
const screen = screenFrame('טלפון · שינוי כמות', 402, 874, 200 + 482 * 2, 200);
page.appendChild(screen);

// dimmed recipe behind the sheet
const behind = col('המתכון שמאחור', 10);
behind.paddingTop = 20; behind.paddingBottom = 16; behind.paddingLeft = 16; behind.paddingRight = 16;
screen.appendChild(behind);
behind.layoutSizingHorizontal = 'FILL';
behind.layoutSizingVertical = 'FILL';
const bTitle = await txt('כותרת/מתכון', 'בריוש נאנטר', 'טקסט/ראשי');
behind.appendChild(bTitle); fillText(bTitle);
const bMeta = await txt('משני/14', "12 יחידות · 85 גר' ליחידה", 'טקסט/משני');
behind.appendChild(bMeta); fillText(bMeta);
for (let i = 0; i < 4; i += 1) {
  const ghost = surface(`שורה מעומעמת ${i + 1}`, 6);
  ghost.opacity = 0.45;
  const g1 = await txt('גוף/16', ['קמח לחם 13% חלבון', 'ביצים', 'חלב 3%', 'סוכר'][i], 'טקסט/ראשי');
  ghost.appendChild(g1);
  behind.appendChild(ghost);
  ghost.layoutSizingHorizontal = 'FILL';
  fillText(g1);
}

// the sheet
const sheet = col('גלילון · כמה להכין?', 14);
sheet.paddingTop = 20; sheet.paddingBottom = 24; sheet.paddingLeft = 16; sheet.paddingRight = 16;
sheet.fills = [pf('רקע/דף')];
sheet.strokes = [pf('קו/עדין')];
sheet.strokeWeight = 1;
for (const p of ['topLeftRadius', 'topRightRadius']) sheet.setBoundVariable(p, VAR['פינה/גלילון']);
sheet.effects = [{ type: 'DROP_SHADOW', color: { r: 0.16, g: 0.18, b: 0.16, a: 0.18 }, offset: { x: 0, y: -8 }, radius: 24, spread: 0, visible: true, blendMode: 'NORMAL' }];
screen.appendChild(sheet);
sheet.layoutSizingHorizontal = 'FILL';

const grab = figma.createRectangle();
grab.name = 'ידית';
grab.resize(44, 4);
grab.fills = [pf('קו/עדין')];
grab.cornerRadius = 2;
sheet.appendChild(grab);
sheet.counterAxisAlignItems = 'MAX';

const sTitle = await txt('כותרת/מסך', 'כמה להכין?', 'טקסט/ראשי');
sheet.appendChild(sTitle); fillText(sTitle);
const sLead = await txt('משני/14', 'בחרו איך לקבוע את הכמות. החישוב מתעדכן מיד, והמתכון המקורי נשאר כפי שהוא.', 'טקסט/משני');
sheet.appendChild(sLead); fillText(sLead);

const modes = await segmented('מצבי כמות', [['כמו במתכון', false], ['יחידות', true], ['משקל', false], ['לפי מלאי', false]]);
sheet.appendChild(modes); modes.layoutSizingHorizontal = 'FILL';

// the field for the chosen mode
const field = col('מספר יחידות', 4);
sheet.appendChild(field); field.layoutSizingHorizontal = 'FILL';
const fLbl = await txt('מטא/13', 'מספר יחידות', 'טקסט/משני');
field.appendChild(fLbl); fillText(fLbl);
const fBox = row('שדה', 10);
fBox.paddingLeft = fBox.paddingRight = 12;
fBox.fills = [pf('רקע/משטח')];
fBox.strokes = [pf('פעולה/מרווה')];
fBox.strokeWeight = 1.6;
bindR(fBox, 'פינה/פקד');
const fUnit = await txt('משני/14', "יח'", 'טקסט/משני', 'LEFT');
fBox.appendChild(fUnit);
const fVal = await txt('גוף/17', '24', 'טקסט/ראשי');
fBox.appendChild(fVal);
field.appendChild(fBox);
fBox.layoutSizingHorizontal = 'FILL';
fBox.resize(fBox.width, 52);
fBox.counterAxisSizingMode = 'FIXED';
fillText(fVal);

// what that means, stated before it is applied
const result = surface('התוצאה', 8);
sheet.appendChild(result); result.layoutSizingHorizontal = 'FILL';
const rTitle = await txt('מטא/13', 'הכמות שנבחרה', 'טקסט/משני');
result.appendChild(rTitle); fillText(rTitle);
const rVal = await txt('כותרת/כרטיס', '24 יחידות · 2.30 ק"ג', 'טקסט/ראשי');
result.appendChild(rVal); fillText(rVal);
const rWas = await txt('משני/14', 'במקום 12 יחידות · 1.15 ק"ג  (מכפיל ×2)', 'טקסט/משני');
result.appendChild(rWas); fillText(rWas);
const rNote = await txt('מטא/13', 'הכמויות בשלבי ההכנה ובמיז-אן-פלאס יתעדכנו לפי הבחירה הזאת.', 'טקסט/משני');
result.appendChild(rNote); fillText(rNote);

const actions = row('פעולות הגלילון', 10);
sheet.appendChild(actions); actions.layoutSizingHorizontal = 'FILL';
const cancel = await wideButton('ביטול', 'quiet');
actions.appendChild(cancel);
const apply = await wideButton('עדכון הכמויות', 'primary');
actions.appendChild(apply);
apply.layoutSizingHorizontal = 'FILL';

return { createdNodeIds: [screen.id], screen: screen.name };
