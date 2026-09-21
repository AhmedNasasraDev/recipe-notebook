/*
  11 · PHONE · HOME  (402×874, phone slot 12)

  What a cook needs on opening, in that order: carry on where they stopped,
  find something, start something new. Recents and favourites are the two lists
  that answer "what was I doing"; the categories are a grid, not a menu.
*/
// @include ../lib/preamble.js

const page = await usePage(PAGE.phone);
const screen = screenFrame('טלפון · בית', 402, 874, 200 + 482 * 12, 200);
page.appendChild(screen);
const body = screenBody(screen, 16);

const hi = col('פתיחה', 4);
body.appendChild(hi); hi.layoutSizingHorizontal = 'FILL';
const h1 = await txt('כותרת/מסך', 'בוקר טוב, שף', 'טקסט/ראשי');
hi.appendChild(h1); fillText(h1);
const h2 = await txt('משני/14', 'חמישי · יום ייצור · 3 מוצרים בתוכנית', 'טקסט/משני');
hi.appendChild(h2); fillText(h2);

// search
const sBox = row('חיפוש', 8);
sBox.paddingLeft = sBox.paddingRight = 12;
sBox.fills = [pf('רקע/משטח')];
sBox.strokes = [pf('קו/עדין')];
sBox.strokeWeight = 1;
bindR(sBox, 'פינה/פקד');
body.appendChild(sBox);
sBox.layoutSizingHorizontal = 'FILL';
const sPh = await txt('גוף/16', 'חיפוש מתכון, תג או רכיב', 'טקסט/משני');
sBox.appendChild(sPh);
sBox.appendChild(icon('חיפוש', 'טקסט/משני', 20));
sBox.resize(sBox.width, 48);
sBox.counterAxisSizingMode = 'FIXED';
fillText(sPh);

// resume
const resume = surface('המשך מאיפה שהפסקת', 10);
body.appendChild(resume); resume.layoutSizingHorizontal = 'FILL';
const rT = await txt('מטא/13', 'המשך מאיפה שהפסקת', 'טקסט/משני');
resume.appendChild(rT); fillText(rT);
const rName = await txt('כותרת/כרטיס', 'בריוש נאנטר', 'טקסט/ראשי');
resume.appendChild(rName); fillText(rName);
const rState = await txt('משני/14', 'מצב הכנה · שלב 3 מתוך 6 · טיימר פועל 04:12', 'פעולה/מרווה כהה');
resume.appendChild(rState); fillText(rState);
const rBtn = await wideButton('חזרה למצב הכנה', 'primary');
resume.appendChild(rBtn);
rBtn.layoutSizingHorizontal = 'FILL';

const newBtn = await wideButton('מתכון חדש', 'quiet');
body.appendChild(newBtn);
newBtn.layoutSizingHorizontal = 'FILL';

// favourites
const favT = await txt('כותרת/כרטיס', 'מועדפים', 'טקסט/ראשי');
body.appendChild(favT); fillText(favT);
const favs = col('רשימת מועדפים', 10);
body.appendChild(favs); favs.layoutSizingHorizontal = 'FILL';
for (const [name, meta] of [
  ['קרואסון חמאה', "בצקים · 33 יח' · 44 שע'"],
  ['קרם פטיסייר וניל', 'קרמים · 1.49 ק"ג · 15 דק\''],
]) {
  const c = inst('כרטיס/מתכון');
  favs.appendChild(c);
  c.layoutSizingHorizontal = 'FILL';
  const texts = c.findAllWithCriteria({ types: ['TEXT'] });
  await setText(texts[0], name);
  await setText(texts[1], meta);
  const tagRow = c.findOne((n) => n.name === 'תגים');
  if (tagRow) tagRow.visible = false;
}

// categories
const catT = await txt('כותרת/כרטיס', 'קטגוריות', 'טקסט/ראשי');
body.appendChild(catT); fillText(catT);
const grid = row('אריחי קטגוריות', 10);
grid.layoutWrap = 'WRAP';
grid.counterAxisSpacing = 10;
body.appendChild(grid);
grid.layoutSizingHorizontal = 'FILL';
for (const [name, count] of [['בצקים', '3'], ['קרמים ומילויים', '1'], ['גנאשים ורטבים', '1'], ['לחמים', '0']]) {
  const tile = col(`אריח · ${name}`, 4);
  tile.paddingTop = tile.paddingBottom = 14; tile.paddingLeft = tile.paddingRight = 14;
  tile.fills = [pf('רקע/משטח')];
  tile.strokes = [pf('קו/עדין')];
  tile.strokeWeight = 1;
  bindR(tile, 'פינה/כרטיס');
  const n = await txt('גוף/16 מודגש', name, 'טקסט/ראשי');
  tile.appendChild(n);
  const cnt = await txt('מטא/13', `${count} מתכונים`, 'טקסט/משני');
  tile.appendChild(cnt);
  tile.resize(166, 76);
  tile.primaryAxisSizingMode = 'FIXED';
  tile.counterAxisSizingMode = 'FIXED';
  grid.appendChild(tile);
  fillText(n); fillText(cnt);
}

tabBar(screen, 'בית');
return { createdNodeIds: [screen.id], screen: screen.name };
