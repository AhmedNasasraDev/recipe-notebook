/*
  A small stand-in for the Figma Plugin API — enough to RUN the build scripts
  outside Figma and catch the mistakes that cost a call to discover:

    · a colour/radius variable or text style that does not exist
    · a component or variant that does not exist
    · FILL set on a text that was not told to auto-resize its height first
    · FILL or HUG set on a node that has no parent yet
    · a forbidden API (figma.notify, loadAllPagesAsync, createImageAsync,
      setPluginData, assigning figma.currentPage)

  It does NOT lay anything out, so it proves a script RUNS — not that the
  result looks right. Looking is what screenshots after the real run are for.
*/

let seq = 0;
const nextId = () => `${++seq}:${seq}`;

class Node {
  constructor(type, name) {
    this.id = nextId();
    this.type = type;
    this.name = name || type;
    this.children = [];
    this.parent = null;
    this.width = 100;
    this.height = 100;
    this.x = 0;
    this.y = 0;
    this.fills = [];
    this.strokes = [];
    this.strokeWeight = 0;
    this.visible = true;
    this.opacity = 1;
    this.effects = [];
    this.reactions = [];
    this.boundVars = {};
    this.layoutMode = 'NONE';
    this.layoutSizingHorizontal = 'FIXED';
    this.layoutSizingVertical = 'FIXED';
    this.clipsContent = true;
    this.description = '';
  }

  appendChild(node) {
    if (!node) throw new Error(`${this.name}: appendChild(undefined)`);
    node.parent = this;
    this.children.push(node);
    return node;
  }

  insertChild(i, node) { return this.appendChild(node); }

  resize(w, h) { this.width = w; this.height = h; this.layoutSizingHorizontal = 'FIXED'; this.layoutSizingVertical = 'FIXED'; }
  resizeWithoutConstraints(w, h) { this.width = w; this.height = h; }

  setBoundVariable(prop, variable) {
    if (!variable) throw new Error(`${this.name}: setBoundVariable("${prop}") got no variable`);
    this.boundVars[prop] = variable.id;
  }

  async setReactionsAsync(reactions) {
    for (const r of reactions) {
      for (const a of r.actions || []) {
        if (a.type === 'NODE' && !a.destinationId) throw new Error(`${this.name}: reaction without a destination`);
      }
    }
    this.reactions = reactions;
  }

  findOne(fn) { return this.findAll(fn)[0] || null; }

  findAll(fn) {
    const out = [];
    const walk = (n) => {
      for (const c of n.children) {
        if (!fn || fn(c)) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  findAllWithCriteria({ types }) { return this.findAll((n) => types.includes(n.type)); }

  query() { return { first: () => null, length: 0, toArray: () => [] }; }
  set(props) { Object.assign(this, props); return this; }
  async screenshot() { return null; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); }
  createInstance() {
    const i = deepClone(this, 'INSTANCE');
    i.mainComponent = this;
    return i;
  }
}

const deepClone = (node, asType) => {
  const c = new Node(asType || node.type, node.name);
  c.width = node.width;
  c.height = node.height;
  c.layoutMode = node.layoutMode;
  if (node.type === 'TEXT') {
    c.characters = node.characters;
    c.fontName = node.fontName;
    c.textAutoResize = node.textAutoResize;
    c.getStyledTextSegments = node.getStyledTextSegments;
    c.setTextStyleIdAsync = node.setTextStyleIdAsync;
  }
  for (const child of node.children) c.appendChild(deepClone(child));
  return c;
};

export function makeFigma(inventory, warn) {
  const guard = (node, prop, value) => {
    if ((prop === 'layoutSizingHorizontal' || prop === 'layoutSizingVertical') && value !== 'FIXED') {
      if (!node.parent) warn(`${node.name}: ${prop}="${value}" before the node has a parent`);
      else if (node.type === 'TEXT' && prop === 'layoutSizingHorizontal' && value === 'FILL' && node.textAutoResize !== 'HEIGHT') {
        warn(`${node.name}: text set to FILL without textAutoResize="HEIGHT" (use fillText())`);
      }
    }
  };

  const wrap = (node) =>
    new Proxy(node, {
      set(target, prop, value) {
        guard(target, prop, value);
        target[prop] = value;
        return true;
      },
      get(target, prop) {
        const v = target[prop];
        if (typeof v === 'function') return v.bind(target);
        return v;
      },
    });

  const mkText = () => {
    const t = new Node('TEXT', 'טקסט');
    t.characters = '';
    t.textAutoResize = 'WIDTH_AND_HEIGHT';
    t.textAlignHorizontal = 'LEFT';
    t.fontName = { family: 'Heebo', style: 'Regular' };
    t.setTextStyleIdAsync = async (id) => {
      if (!id) throw new Error('setTextStyleIdAsync got no style id');
      t.styleId = id;
    };
    t.getStyledTextSegments = () => [{ fontName: t.fontName }];
    return wrap(t);
  };

  const pages = inventory.pages.map((name) => {
    const p = new Node('PAGE', name);
    p.loadAsync = async () => true;
    p.flowStartingPoints = [];
    return p;
  });

  // the components the real file already holds
  const foundations = pages[0];
  for (const name of inventory.components) {
    const c = new Node('COMPONENT', name);
    if (name === 'כרטיס/מתכון') {
      c.appendChild(mkText());
      c.appendChild(mkText());
      const tags = new Node('FRAME', 'תגים');
      for (let i = 0; i < 3; i += 1) {
        const chip = new Node('FRAME', `תג ${i}`);
        chip.appendChild(mkText());
        tags.appendChild(chip);
      }
      c.appendChild(tags);
    }
    if (name === 'שורת/רכיב') {
      c.appendChild(mkText());
      const col = new Node('FRAME', 'שם והערה');
      col.appendChild(mkText());
      col.appendChild(mkText());
      c.appendChild(col);
    }
    foundations.appendChild(c);
  }
  for (const [setName, variants] of Object.entries(inventory.componentSets)) {
    const set = new Node('COMPONENT_SET', setName);
    for (const v of variants) {
      const comp = new Node('COMPONENT', v);
      if (setName === 'שורת/שקילה' || setName === 'הודעה/מצב' || setName === 'שבב/סינון' || setName === 'תג/מקור נתון') {
        comp.appendChild(mkText());
        if (setName === 'שורת/שקילה') comp.appendChild(mkText());
      }
      if (setName === 'טופס/שדה') {
        comp.appendChild(mkText());
        comp.appendChild(mkText());
        comp.appendChild(mkText());
      }
      set.appendChild(comp);
    }
    foundations.appendChild(set);
  }

  // existing screens, so scripts that look for them (01, 16) can run
  for (const [pageName, frames] of Object.entries(inventory.existingScreens || {})) {
    const page = pages.find((p) => p.name === pageName);
    for (const frameName of frames) {
      const f = new Node('FRAME', frameName);
      const list = new Node('FRAME', 'רשימת מתכונים');
      for (let i = 0; i < 4; i += 1) {
        const card = new Node('INSTANCE', `כרטיס ${i}`);
        const tags = new Node('FRAME', 'תגים');
        for (let k = 0; k < 3; k += 1) {
          const chip = new Node('FRAME', `תג ${k}`);
          chip.appendChild(mkText());
          tags.appendChild(chip);
        }
        card.appendChild(tags);
        list.appendChild(card);
      }
      f.appendChild(list);
      page.appendChild(f);
    }
  }

  const variables = [...inventory.colorVariables, ...inventory.numberVariables].map((name) => ({
    id: `VariableID:${name}`,
    name,
    scopes: [],
    setValueForMode() {},
  }));
  const styles = inventory.textStyles.map((name) => ({ id: `S:${name}`, name }));

  let current = pages[0];
  const figma = {
    root: { children: pages },
    get currentPage() { return current; },
    set currentPage(_p) { throw new Error('assigning figma.currentPage is not supported — use setCurrentPageAsync'); },
    async setCurrentPageAsync(p) { current = p; return p; },
    async loadFontAsync(font) {
      if (font.family !== 'Heebo') warn(`loading a font that is not Heebo: ${font.family} ${font.style}`);
      return true;
    },
    async listAvailableFontsAsync() { return [{ fontName: { family: 'Heebo', style: 'Regular' } }]; },
    async getLocalTextStylesAsync() { return styles; },
    async getNodeByIdAsync(id) { return pages.flatMap((p) => [p, ...p.findAll(() => true)]).find((n) => n.id === id) || null; },
    createFrame() { return wrap(new Node('FRAME')); },
    createRectangle() { return wrap(new Node('RECTANGLE')); },
    createSection() { return wrap(new Node('SECTION')); },
    createComponent() { return wrap(new Node('COMPONENT')); },
    createPage() { throw new Error('figma.createPage: the Starter plan allows 3 pages — do not create more'); },
    createText: mkText,
    createAutoLayout(dir, props) {
      const p = typeof dir === 'object' ? dir : props || {};
      const f = new Node('FRAME', p.name);
      f.layoutMode = typeof dir === 'string' ? dir : 'HORIZONTAL';
      Object.assign(f, p);
      return wrap(f);
    },
    createNodeFromSvg(svg) {
      if (!/^<svg/.test(svg.trim())) throw new Error('createNodeFromSvg needs an <svg> string');
      const f = new Node('FRAME', 'svg');
      f.appendChild(new Node('VECTOR', 'path'));
      return wrap(f);
    },
    combineAsVariants(components, parent) {
      const set = new Node('COMPONENT_SET', 'set');
      for (const c of components) set.appendChild(c);
      parent.appendChild(set);
      return wrap(set);
    },
    group(nodes, parent) { const g = new Node('GROUP'); for (const n of nodes) g.appendChild(n); parent.appendChild(g); return wrap(g); },
    notify() { throw new Error('figma.notify is not implemented in use_figma — never call it'); },
    variables: {
      async getLocalVariablesAsync() { return variables; },
      async getLocalVariableCollectionsAsync() { return [{ id: 'c1', name: 'צבע', modes: [{ modeId: 'm1', name: 'Mode 1' }], variableIds: [] }]; },
      createVariable(name) { return { id: `VariableID:${name}`, name, scopes: [], setValueForMode() {} }; },
      createVariableCollection(name) { return { id: `col:${name}`, name, modes: [{ modeId: 'm1', name: 'Mode 1' }] }; },
      setBoundVariableForPaint(paint, field, variable) {
        if (!variable) throw new Error('setBoundVariableForPaint got no variable');
        return Object.assign({}, paint, { boundVariables: { [field]: { id: variable.id } } });
      },
    },
  };
  return { figma, pages };
}
