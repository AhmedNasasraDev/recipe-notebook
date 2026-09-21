/*
  SHARED PREAMBLE — inlined into every build script by figma/build.mjs.

  Nothing persists between `use_figma` calls, so each script carries its own
  copy of these helpers. They exist because the Figma Plugin API has a handful
  of traps that cost real calls to discover, and on a Starter plan a wasted
  call is a wasted week:

  · A colour variable that does not exist does NOT throw — the paint silently
    stays its default and renders black. `pf()` throws instead. (This is the
    exact bug that blackened the notebook badges.)
  · A TEXT set to FILL keeps its natural width unless `textAutoResize` is
    'HEIGHT' first, and then gets clipped by its parent. `fillText()` does both
    in the right order.
  · A FRAME switched to auto-layout collapses to hug; a screen has to be told
    it is FIXED and resized afterwards. `screenFrame()` does that.
  · Child x/y are relative to the parent, not the page.
  · A COMPONENT_SET does not hug its variants by itself and clips them.
  · Right-to-left is not a setting: vertical stacks align to MAX, and in a row
    the RIGHTMOST element must be the FIRST child.
*/

const PAGE = {
  foundations: '00 · יסודות ורכיבים',
  phone: '01 · מסכים · טלפון',
  wide: '02 · טאבלט, מחשב וזרימה',
};

/** Switch to one of the file's three pages (Starter allows no more). */
async function usePage(name) {
  const page = figma.root.children.find((p) => p.name === name);
  if (!page) {
    throw new Error(
      `page "${name}" not found. The file is expected to have: ${Object.values(PAGE).join(' | ')}`,
    );
  }
  await figma.setCurrentPageAsync(page);
  return page;
}

// ── tokens ────────────────────────────────────────────────────────────────
const VARS = await figma.variables.getLocalVariablesAsync();
const VAR = {};
for (const v of VARS) VAR[v.name] = v;

/** A paint bound to a colour variable — throws rather than painting black. */
function pf(name) {
  const v = VAR[name];
  if (!v) throw new Error(`missing colour variable: "${name}"`);
  return figma.variables.setBoundVariableForPaint(
    { type: 'SOLID', color: { r: 1, g: 1, b: 1 } },
    'color',
    v,
  );
}

/** Bind all four corners to a radius variable. */
function bindR(node, name) {
  const v = VAR[name];
  if (!v) throw new Error(`missing radius variable: "${name}"`);
  for (const p of ['topLeftRadius', 'topRightRadius', 'bottomLeftRadius', 'bottomRightRadius']) {
    node.setBoundVariable(p, v);
  }
}

const TEXT_STYLES = await figma.getLocalTextStylesAsync();
const STYLE = {};
for (const s of TEXT_STYLES) STYLE[s.name] = s;

const HEEBO = ['Regular', 'Medium', 'SemiBold'];
for (const style of HEEBO) await figma.loadFontAsync({ family: 'Heebo', style });

// ── text ──────────────────────────────────────────────────────────────────
/** A text node in one of the file's styles, right-aligned by default (RTL). */
async function txt(styleName, chars, colorName, align) {
  const style = STYLE[styleName];
  if (!style) throw new Error(`missing text style: "${styleName}"`);
  const t = figma.createText();
  await t.setTextStyleIdAsync(style.id);
  t.characters = chars;
  t.textAlignHorizontal = align || 'RIGHT';
  t.fills = [pf(colorName)];
  return t;
}

/** Make an already-appended text fill its parent's width without clipping. */
function fillText(t) {
  t.textAutoResize = 'HEIGHT';
  t.layoutSizingHorizontal = 'FILL';
  return t;
}

/** Overwrite an instance's text, loading whatever fonts it already uses. */
async function setText(node, chars) {
  for (const seg of node.getStyledTextSegments(['fontName'])) {
    await figma.loadFontAsync(seg.fontName);
  }
  node.characters = chars;
  return node;
}

// ── containers ────────────────────────────────────────────────────────────
/** Vertical stack, right-aligned for RTL. */
function col(name, gap, props) {
  const f = figma.createAutoLayout('VERTICAL', Object.assign({ name, itemSpacing: gap }, props || {}));
  f.counterAxisAlignItems = 'MAX';
  f.fills = [];
  return f;
}

/** Horizontal row, vertically centred. Remember: first child = rightmost. */
function row(name, gap, props) {
  const f = figma.createAutoLayout('HORIZONTAL', Object.assign({ name, itemSpacing: gap }, props || {}));
  f.counterAxisAlignItems = 'CENTER';
  f.fills = [];
  return f;
}

/** White surface card with the file's own radius and hairline. */
function surface(name, gap) {
  const f = col(name, gap == null ? 10 : gap);
  f.paddingTop = f.paddingBottom = f.paddingLeft = f.paddingRight = 16;
  f.fills = [pf('רקע/משטח')];
  f.strokes = [pf('קו/עדין')];
  f.strokeWeight = 1;
  bindR(f, 'פינה/כרטיס');
  return f;
}

/** A 1px rule that fills its parent. */
function rule() {
  const r = figma.createRectangle();
  r.name = 'קו מפריד';
  r.resize(100, 1);
  r.fills = [pf('קו/עדין')];
  return r;
}

/**
 * A device frame: fixed size, page background, vertical layout.
 * Append content, then `content.layoutSizingVertical = 'FILL'`.
 */
function screenFrame(name, w, h, x, y) {
  const f = figma.createFrame();
  f.name = name;
  f.resize(w, h);
  f.fills = [pf('רקע/דף')];
  f.layoutMode = 'VERTICAL';
  f.itemSpacing = 0;
  f.primaryAxisSizingMode = 'FIXED';
  f.counterAxisSizingMode = 'FIXED';
  f.resize(w, h);
  f.clipsContent = true;
  f.x = x;
  f.y = y;
  return f;
}

/** The scrolling content column inside a device frame. */
function screenBody(screen, gap) {
  const body = col('תוכן נגלל', gap == null ? 16 : gap);
  body.paddingTop = 20;
  body.paddingBottom = 16;
  body.paddingLeft = 16;
  body.paddingRight = 16;
  screen.appendChild(body);
  body.layoutSizingHorizontal = 'FILL';
  body.layoutSizingVertical = 'FILL';
  return body;
}

// ── components ────────────────────────────────────────────────────────────
/*
  Components live on the foundations page. `loadAsync()` loads that page's
  contents without switching to it — switching twice in one script reloads the
  file and is explicitly against the API rules.
*/
const FOUNDATIONS = figma.root.children.find((p) => p.name === PAGE.foundations);
if (!FOUNDATIONS) throw new Error(`page "${PAGE.foundations}" not found`);
await FOUNDATIONS.loadAsync();
const COMPONENTS = {};
for (const n of FOUNDATIONS.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] })) {
  if (n.parent && n.parent.type === 'COMPONENT_SET') continue; // variants are reached through their set
  COMPONENTS[n.name] = n;
}

/** An instance of a component, or of one named variant of a set. */
function inst(name, variant) {
  const node = COMPONENTS[name];
  if (!node) throw new Error(`missing component: "${name}"`);
  if (node.type === 'COMPONENT_SET') {
    if (!variant) throw new Error(`"${name}" is a set — name a variant, e.g. inst("${name}", "${node.children[0].name}")`);
    const v = node.children.find((c) => c.name === variant);
    if (!v) throw new Error(`missing variant "${variant}" in "${name}" (has: ${node.children.map((c) => c.name).join(', ')})`);
    return v.createInstance();
  }
  return node.createInstance();
}

/** An icon instance, recoloured and resized. */
function icon(name, colorName, size) {
  const i = inst(`אייקון/${name}`);
  const s = size || 24;
  i.resize(s, s);
  for (const n of i.findAll((x) => 'strokes' in x && x.strokes.length > 0)) {
    n.strokes = [pf(colorName)];
  }
  return i;
}

/** The bottom tab bar, pinned under a screen's content. */
function tabBar(screen, activeTab) {
  const bar = inst('ניווט/פס תחתון', `פעיל=${activeTab}`);
  screen.appendChild(bar);
  bar.layoutSizingHorizontal = 'FILL';
  bar.layoutSizingVertical = 'FIXED';
  return bar;
}

/** Pill button, sage-filled or outlined. Icon (if any) sits at the start. */
async function pill(label, kind, iconName) {
  const b = row(label, 6);
  b.paddingLeft = b.paddingRight = 14;
  b.primaryAxisAlignItems = 'CENTER';
  if (kind === 'primary') {
    b.fills = [pf('פעולה/מרווה')];
  } else {
    b.fills = [pf('רקע/משטח')];
    b.strokes = [pf('קו/עדין')];
    b.strokeWeight = 1;
  }
  bindR(b, 'פינה/גלולה');
  const ink = kind === 'primary' ? 'טקסט/על מרווה' : 'פעולה/מרווה כהה';
  b.appendChild(await txt('משני/14', label, ink));
  if (iconName) b.appendChild(icon(iconName, ink, 18));
  b.resize(b.width, 44);
  b.counterAxisSizingMode = 'FIXED';
  return b;
}

/** Wide action button (the one that starts the work). */
async function wideButton(label, state) {
  const b = row(label, 8);
  b.primaryAxisAlignItems = 'CENTER';
  b.paddingTop = b.paddingBottom = 12;
  if (state === 'disabled') {
    b.fills = [pf('רקע/מושבת')];
    b.strokes = [pf('קו/עדין')];
    b.strokeWeight = 1;
    b.appendChild(await txt('גוף/16 מודגש', label, 'טקסט/משני'));
  } else if (state === 'quiet') {
    b.fills = [pf('רקע/משטח')];
    b.strokes = [pf('קו/עדין')];
    b.strokeWeight = 1;
    b.appendChild(await txt('גוף/16 מודגש', label, 'טקסט/ראשי'));
  } else {
    b.fills = [pf('פעולה/מרווה')];
    b.appendChild(await txt('גוף/16 מודגש', label, 'טקסט/על מרווה'));
  }
  bindR(b, state === 'primary' ? 'פינה/גלולה' : 'פינה/פקד');
  b.resize(b.width, 54);
  b.counterAxisSizingMode = 'FIXED';
  return b;
}

/** A small tag: 'green' | 'amber' | 'red' | 'plain'. */
async function tag(label, kind) {
  const MAP = {
    green: ['רקע/בחירה', 'פעולה/מרווה כהה', null],
    amber: ['רקע/אזהרה', 'משמעות/אזהרה', null],
    red: ['רקע/שגיאה', 'משמעות/שגיאה', null],
    plain: ['רקע/משטח', 'טקסט/משני', 'קו/עדין'],
  };
  const [bg, ink, stroke] = MAP[kind || 'plain'];
  const t = row(`תג ${label}`, 0);
  t.paddingLeft = t.paddingRight = 9;
  t.paddingTop = t.paddingBottom = 4;
  t.fills = [pf(bg)];
  if (stroke) {
    t.strokes = [pf(stroke)];
    t.strokeWeight = 1;
  }
  bindR(t, 'פינה/גלולה');
  t.appendChild(await txt('מטא/12', label, ink));
  return t;
}

/** Segmented control. `options` is [label, selected] — first item is rightmost. */
async function segmented(name, options) {
  const seg = row(name, 6);
  seg.primaryAxisAlignItems = 'MAX';
  for (const [label, on] of options) {
    const s = row(label, 0);
    s.paddingLeft = s.paddingRight = 12;
    s.primaryAxisAlignItems = 'CENTER';
    s.fills = [pf(on ? 'פעולה/מרווה' : 'רקע/משטח')];
    s.strokes = [pf(on ? 'פעולה/מרווה' : 'קו/עדין')];
    s.strokeWeight = 1;
    bindR(s, 'פינה/פקד');
    s.appendChild(await txt('מטא/13', label, on ? 'טקסט/על מרווה' : 'טקסט/משני'));
    s.resize(s.width, 40);
    s.counterAxisSizingMode = 'FIXED';
    seg.appendChild(s);
  }
  return seg;
}

/** A label + value row inside a card (label right, value left). */
async function dataRow(label, value, opts) {
  const o = opts || {};
  const r = row(`${label}`, 10);
  r.paddingTop = r.paddingBottom = 6;
  const val = await txt(o.strong ? 'גוף/16 מודגש' : 'גוף/16', value, o.valueColor || 'טקסט/ראשי', 'LEFT');
  r.appendChild(val);
  const lbl = await txt('משני/14', label, 'טקסט/משני');
  r.appendChild(lbl);
  return { node: r, label: lbl, value: val };
}
