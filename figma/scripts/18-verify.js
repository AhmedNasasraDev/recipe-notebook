/*
  18 · VERIFY  (read-only)

  Reports what is actually in the file: pages, frames per page, how many nodes
  each screen has, whether any text is clipped by its parent, and whether any
  fill is unbound black (the failure that blackened the badges). Returns a
  structured report — no screenshots, so it costs one call.
*/
// @include ../lib/preamble.js

const report = { pages: [], suspiciousText: [], unboundBlack: [], flowStartingPoints: [] };

for (const p of figma.root.children) {
  await p.loadAsync();
  const frames = p.children.filter((c) => c.type === 'FRAME' || c.type === 'SECTION');
  report.pages.push({
    name: p.name,
    frames: frames.map((f) => ({ name: f.name, type: f.type, w: Math.round(f.width), h: Math.round(f.height) })),
    components: p.findAllWithCriteria({ types: ['COMPONENT', 'COMPONENT_SET'] }).filter((n) => !(n.parent && n.parent.type === 'COMPONENT_SET')).length,
  });
  if (p.flowStartingPoints && p.flowStartingPoints.length) {
    report.flowStartingPoints.push({ page: p.name, flows: p.flowStartingPoints.map((f) => f.name) });
  }
  // a text wider than its parent will be clipped
  for (const t of p.findAllWithCriteria({ types: ['TEXT'] })) {
    const parent = t.parent;
    if (!parent || !('width' in parent)) continue;
    if (t.width > parent.width + 1) {
      report.suspiciousText.push({ page: p.name, text: t.characters.slice(0, 24), w: Math.round(t.width), parent: Math.round(parent.width) });
    }
  }
  // an unbound pure-black fill is almost certainly a failed variable lookup
  for (const n of p.findAll((x) => 'fills' in x && Array.isArray(x.fills))) {
    for (const f of n.fills) {
      if (f.type !== 'SOLID' || !f.color) continue;
      const bound = f.boundVariables && f.boundVariables.color;
      if (!bound && f.color.r < 0.06 && f.color.g < 0.06 && f.color.b < 0.06) {
        report.unboundBlack.push({ page: p.name, node: n.name });
      }
    }
  }
}
report.suspiciousText = report.suspiciousText.slice(0, 20);
report.unboundBlack = report.unboundBlack.slice(0, 20);
return report;
