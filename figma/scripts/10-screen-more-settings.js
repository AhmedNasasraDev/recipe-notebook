/*
  10 · PHONE · "עוד" AND SETTINGS  (402×874, phone slots 10 and 11)

  "עוד" is four wide cards, not a list of links: icon, title, one line that says
  what the screen is for, and a chevron that points the way it points in Hebrew.
  The account state is secondary text at the bottom — it is a fact, not a
  navigation target. Groups and study stay on the tab bar, one level away.

  Settings is two decisions a kitchen actually makes: how much detail to show,
  and which units to measure in. Each option says what it changes.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.phone);
const created = [];

// ── "עוד" ────────────────────────────────────────────────────────────────
const more = screenFrame('טלפון · עוד', 402, 874, 200 + 482 * 10, 200);
page.appendChild(more);
created.push(more.id);
const mb = screenBody(more, 14);

const mTitle = await txt('כותרת/מסך', 'עוד', 'טקסט/ראשי');
mb.appendChild(mTitle); fillText(mTitle);
const mSub = await txt('משני/14', 'כל הכלים למחברת שלך', 'טקסט/משני');
mb.appendChild(mSub); fillText(mSub);

const CARDS = [
  ['חומרי גלם', 'חומרי גלם ומחירים', 'ניהול חומרי גלם ועדכון מחירים'],
  ['תכנון', 'תכנון ייצור ורכש', 'תכנון כמויות ורשימת קניות'],
  ['כלים', 'כלי המדידה שלי', 'מידות והמרות לפי הכלים שלך'],
  ['הגדרות', 'הגדרות', 'פרופיל, שפה והעדפות'],
];
for (const [ico, title, desc] of CARDS) {
  const c = row(`כרטיס · ${title}`, 12);
  c.paddingTop = c.paddingBottom = 16; c.paddingLeft = c.paddingRight = 16;
  c.fills = [pf('רקע/משטח')];
  c.strokes = [pf('קו/עדין')];
  c.strokeWeight = 1;
  bindR(c, 'פינה/כרטיס גדול');
  c.appendChild(icon('חץ קדימה', 'טקסט/משני', 20));
  const t = col('כותרת ותיאור', 2);
  const tt = await txt('גוף/16 מודגש', title, 'טקסט/ראשי');
  t.appendChild(tt);
  const td = await txt('משני/14', desc, 'טקסט/משני');
  t.appendChild(td);
  c.appendChild(t);
  const glyph = row('אייקון', 0);
  glyph.primaryAxisAlignItems = 'CENTER';
  glyph.resize(44, 44);
  glyph.primaryAxisSizingMode = 'FIXED';
  glyph.counterAxisSizingMode = 'FIXED';
  glyph.fills = [pf('רקע/בחירה')];
  bindR(glyph, 'פינה/כרטיס');
  glyph.appendChild(icon(ico, 'פעולה/מרווה כהה', 22));
  c.appendChild(glyph);
  mb.appendChild(c);
  c.layoutSizingHorizontal = 'FILL';
  t.layoutSizingHorizontal = 'FILL';
  fillText(tt); fillText(td);
}
const account = await txt('משני/14', 'לא מחוברים לחשבון. אפשר לעבוד מקומית — סנכרון בין מכשירים דורש חיבור.', 'טקסט/משני');
mb.appendChild(account); fillText(account);
tabBar(more, 'עוד');

// ── settings ─────────────────────────────────────────────────────────────
const set = screenFrame('טלפון · הגדרות', 402, 874, 200 + 482 * 11, 200);
page.appendChild(set);
created.push(set.id);
const sb = screenBody(set, 14);

const sTop = row('ראש המסך', 10);
sb.appendChild(sTop); sTop.layoutSizingHorizontal = 'FILL';
sTop.appendChild(await txt('משני/14', '← עוד', 'טקסט/משני'));
const sTitle = await txt('כותרת/מסך', 'הגדרות', 'טקסט/ראשי');
sTop.appendChild(sTitle); fillText(sTitle);

// profile
const prof = surface('הפרופיל שלי', 10);
sb.appendChild(prof); prof.layoutSizingHorizontal = 'FILL';
const pRow = row('שם ותמונה', 12);
prof.appendChild(pRow); pRow.layoutSizingHorizontal = 'FILL';
const pCol = col('שם', 2);
const pName = await txt('גוף/16 מודגש', 'שף לדוגמה', 'טקסט/ראשי');
pCol.appendChild(pName);
const pNote = await txt('מטא/13', 'השם שמוצג לחברי הקבוצות שלך', 'טקסט/משני');
pCol.appendChild(pNote);
pRow.appendChild(pCol);
const avatar = row('תמונה', 0);
avatar.primaryAxisAlignItems = 'CENTER';
avatar.resize(48, 48);
avatar.primaryAxisSizingMode = 'FIXED';
avatar.counterAxisSizingMode = 'FIXED';
avatar.fills = [pf('רקע/בחירה')];
bindR(avatar, 'פינה/גלולה');
avatar.appendChild(await txt('גוף/16 מודגש', 'של', 'פעולה/מרווה כהה', 'CENTER'));
pRow.appendChild(avatar);
pCol.layoutSizingHorizontal = 'FILL';
fillText(pName); fillText(pNote);

// display mode
const disp = surface('העדפות תצוגה', 10);
sb.appendChild(disp); disp.layoutSizingHorizontal = 'FILL';
const dT = await txt('כותרת/כרטיס', 'העדפות תצוגה', 'טקסט/ראשי');
disp.appendChild(dT); fillText(dT);
const dR = rule(); disp.appendChild(dR); dR.layoutSizingHorizontal = 'FILL';
for (const [name, desc, on] of [
  ['ביתי', 'כוסות, כפות ומידות בית', false],
  ['מקצועי', 'גרמים, תשואה, פחת, עלויות ותמחור', true],
  ['לימוד', 'מצב לימוד: הסברים ליד כל שדה', false],
]) {
  const opt = row(`אפשרות · ${name}`, 12);
  opt.paddingTop = opt.paddingBottom = 12; opt.paddingLeft = opt.paddingRight = 12;
  opt.fills = [pf(on ? 'רקע/בחירה' : 'רקע/משטח')];
  opt.strokes = [pf(on ? 'פעולה/מרווה' : 'קו/עדין')];
  opt.strokeWeight = 1;
  bindR(opt, 'פינה/כרטיס');
  const c = col('שם ותיאור', 2);
  const n = await txt('גוף/16 מודגש', name, on ? 'פעולה/מרווה כהה' : 'טקסט/ראשי');
  c.appendChild(n);
  const d = await txt('מטא/13', desc, on ? 'פעולה/מרווה כהה' : 'טקסט/משני');
  c.appendChild(d);
  opt.appendChild(c);
  if (on) opt.appendChild(icon('סימון', 'פעולה/מרווה כהה', 20));
  disp.appendChild(opt);
  opt.layoutSizingHorizontal = 'FILL';
  c.layoutSizingHorizontal = 'FILL';
  fillText(n); fillText(d);
}

// units
const units = surface('יחידות מדידה', 10);
sb.appendChild(units); units.layoutSizingHorizontal = 'FILL';
const uT = await txt('כותרת/כרטיס', 'יחידות מדידה', 'טקסט/ראשי');
units.appendChild(uT); fillText(uT);
const uR = rule(); units.appendChild(uR); uR.layoutSizingHorizontal = 'FILL';
for (const [label, options] of [
  ['משקל', [['גרמים', true], ['ק"ג', false], ['אונקיות', false]]],
  ['נפח', [['מ"ל', true], ['ליטר', false], ['כוסות', false]]],
  ['חום', [['°C', true], ['°F', false]]],
]) {
  const c = col(label, 6);
  const l = await txt('מטא/13', label, 'טקסט/משני');
  c.appendChild(l);
  const seg = await segmented(`בחירת ${label}`, options);
  c.appendChild(seg);
  units.appendChild(c);
  c.layoutSizingHorizontal = 'FILL';
  fillText(l);
  seg.layoutSizingHorizontal = 'FILL';
}
const uNote = await txt('מטא/13', 'היחידות משנות תצוגה בלבד. המתכון נשמר במידות שבהן נכתב.', 'טקסט/משני');
units.appendChild(uNote); fillText(uNote);

tabBar(set, 'עוד');
return { createdNodeIds: created, screens: ['עוד', 'הגדרות'] };
