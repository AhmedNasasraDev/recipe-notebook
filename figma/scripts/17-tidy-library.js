/*
  17 · TIDY THE FOUNDATIONS PAGE

  Lays the four library sections out on one grid, adds the palette and type
  specimen a reviewer looks for first, and writes a description on every
  component so the reason for each decision travels with the file rather than
  living in a chat log.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.foundations);

// ── palette + type specimen ──────────────────────────────────────────────
const cover = figma.createSection();
cover.name = 'פלטה וטיפוגרפיה';
cover.x = 200;
cover.y = -520;
cover.resizeWithoutConstraints(1006, 460);
cover.fills = [pf('רקע/דף')];
page.appendChild(cover);

const coverTitle = await txt('כותרת/מסך', 'מחברת מתכונים · שפה חזותית', 'טקסט/ראשי');
cover.appendChild(coverTitle);
coverTitle.x = 48; coverTitle.y = 40;

const swatches = row('פלטה', 12);
swatches.name = 'פלטה';
cover.appendChild(swatches);
swatches.x = 48; swatches.y = 110;
for (const [name, label] of [
  ['רקע/דף', 'רקע · F7F5EF'],
  ['רקע/משטח', 'משטח · FFFEFA'],
  ['פעולה/מרווה', 'פעולה · 496451'],
  ['טקסט/ראשי', 'טקסט · 292D29'],
  ['קו/עדין', 'קו · DED8CC'],
  ['רקע/בחירה', 'בחירה · E7EDE4'],
]) {
  const sw = col(label, 8);
  sw.counterAxisAlignItems = 'MIN';
  const chip = figma.createRectangle();
  chip.name = name;
  chip.resize(140, 88);
  chip.fills = [pf(name)];
  chip.strokes = [pf('קו/עדין')];
  chip.strokeWeight = 1;
  chip.cornerRadius = 14;
  sw.appendChild(chip);
  const l = await txt('מטא/12', label, 'טקסט/משני', 'LEFT');
  sw.appendChild(l);
  swatches.appendChild(sw);
}

const specimen = col('טיפוגרפיה', 10);
cover.appendChild(specimen);
specimen.x = 48; specimen.y = 260;
specimen.resize(900, specimen.height);
specimen.layoutSizingHorizontal = 'FIXED';
for (const [style, sample] of [
  ['כותרת/מתכון', 'בריוש נאנטר · כותרת מתכון 27'],
  ['כותרת/מסך', 'מחברת מתכונים · כותרת מסך 24'],
  ['הכנה/הוראה', 'מוסיפים חמאה קרה בהדרגה · הוראת הכנה 25'],
  ['גוף/16', 'קמח לחם 13% חלבון · גוף 16'],
  ['כמות/17', "500 גר' · 1.15 ק\"ג · כמות 17 (משקל 600)"],
  ['משני/14', "12 יחידות · 85 גר' ליחידה · משני 14"],
]) {
  const t = await txt(style, sample, 'טקסט/ראשי');
  specimen.appendChild(t);
  fillText(t);
}
const fontNote = await txt('מטא/13', 'Heebo בלבד, שלושה משקלים: 400 לגוף, 500 לכמויות, 600 לכותרות ולפעולות. בלי ריווח אותיות בעברית.', 'טקסט/משני');
specimen.appendChild(fontNote);
fillText(fontNote);

// ── line the sections up on one grid ─────────────────────────────────────
const LAYOUT = [
  ['אייקונים', 200, 200],
  ['רכיבים · פעולות', 200, 560],
  ['רכיבים · מבנה ורשימות', 200, 1040],
  ['רכיבים · ניווט וטפסים', 1280, 560],
];
const moved = [];
for (const [name, x, y] of LAYOUT) {
  const s = page.findOne((n) => n.type === 'SECTION' && n.name === name);
  if (!s) continue;
  s.x = x;
  s.y = y;
  moved.push(s.id);
}

// ── descriptions: why each component is the way it is ────────────────────
const DESCRIPTIONS = {
  'כפתור/ראשי': 'הפעולה הראשית. במצב מושבת: מילוי ניטרלי ודיו משני (4.71:1) — לא שקיפות, שמורידה את הכיתוב ל-2.9:1 ומטה. ליד כפתור מושבת תמיד מופיעה שורה שמסבירה מה חסם אותו.',
  'כפתור/משני': 'פעולה חלופית באותו גובה מטרה (44px) — מסגרת עדינה על משטח לבן.',
  'שבב/סינון': 'סינון קטגוריה. הנבחר ממולא במרווה ולא רק צבוע, כדי שהסימון לא יסתמך על צבע בלבד.',
  'תג/מקור נתון': 'מאיפה הנתון: מדויק, מהמערכת או הערכה. שלושה צבעי משמעות, נפרדים מצבע הפעולה.',
  'כרטיס/סעיף': 'מכל לסעיף: כותרת, קו מפריד ותוכן. משטח לבן על רקע הדף, פינה 14, קו עדין.',
  'שורת/רכיב': 'שורת רכיב: שם בימין, כמות בשמאל. ההצמדה חד-משמעית גם כששם נשבר לשתי שורות.',
  'שורת/שקילה': 'שורת מיז-אן-פלאס: תיבה 28px בתוך שורה של 64px, כי מסמנים אותה בידיים רטובות. סומן = רקע ומסגרת מרווה, לא רק וי.',
  'כרטיס/מתכון': 'כרטיס במחברת: שם, שורת מטא (קטגוריה · תפוקה · זמן) ותגים. התג הימני נושא את המשמעות: ירוק למתכון בסיס, כתום לנוסחה מאושרת.',
  'ניווט/פס תחתון': 'ארבעה אייקונים בלי כיתוב גלוי. היעד הפעיל מסומן ברקע מעוגל וגם בקו עבה יותר. לכל כפתור aria-label בעברית ואזור לחיצה 48×48.',
  'טופס/שדה': 'תווית גלויה מעל השדה, טקסט 16px, והשגיאה מתחת לשדה שגרם לה — לא באנר כללי בראש המסך.',
  'הודעה/מצב': 'נשמר · שינוי שלא נשמר · כשל. שלושת המצבים שמסך עריכה חייב לדעת להגיד.',
};
const described = [];
for (const n of page.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] })) {
  const text = DESCRIPTIONS[n.name];
  if (!text) continue;
  if (n.parent && n.parent.type === 'COMPONENT_SET') continue;
  n.description = text;
  described.push(n.name);
}

return { createdNodeIds: [cover.id], mutatedNodeIds: moved, described };
