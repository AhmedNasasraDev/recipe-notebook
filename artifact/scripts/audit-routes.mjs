// ROUTE AND LINK INVENTORY — read from the code, not from the last audit.
//
// It answers five questions mechanically, so that "nothing is missing" is a
// measurement rather than a memory:
//
//   1. every route `App.tsx` declares, and whether the viewer declares it too
//   2. every navigation target in the product — `<Link to=…>`, `navigate(…)`,
//      `<Navigate to=…>` — and whether each one MATCHES a declared route
//   3. every route, and whether anything in the product navigates to it
//      (a screen nothing links to is reachable only by URL, which is a fact
//      worth stating per route rather than a defect per se)
//   4. which screen component each route renders, from the same source
//   5. the tab bar's own entries, which are the app's top-level way in
//
// A target is matched against the route patterns the way the router does:
// `:param` eats one segment. A template literal like `/recipe/${id}` becomes
// `/recipe/:x` before matching, because what is being checked is the SHAPE of
// the URL, not the value.
//
//   node artifact/scripts/audit-routes.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, '..', '..', 'apps', 'web', 'src');
const APP = path.join(WEB, 'App.tsx');
const VIEWER = path.join(HERE, '..', 'viewer', 'app.tsx');

const read = (f) => fs.readFileSync(f, 'utf8');

const sources = [];
(function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      sources.push(full);
    }
  }
})(WEB);

/* ── 1. the declared routes, with the element each one renders ───────────── */

const routesOf = (file) => {
  const text = read(file);
  const out = [];
  // `path="…"` and the element on the same tag, whichever order they appear in.
  for (const m of text.matchAll(/<Route\b([^>]*?)\/>|<Route\b([^>]*?)>/gs)) {
    const attrs = (m[1] ?? m[2] ?? '').replace(/\s+/g, ' ');
    const p = /path="([^"]+)"/.exec(attrs)?.[1];
    if (!p) continue;
    const el = /element=\{<(\w+)/.exec(attrs)?.[1] ?? '(nested)';
    out.push({ path: p, element: el });
  }
  return out;
};

const product = routesOf(APP);
const viewer = routesOf(VIEWER);

/* ── 2. every navigation target in the product ───────────────────────────── */

/*
  A template literal reduced to the SHAPE of the URL it produces.

  Two passes, and the order matters — the first version of this had one and
  reported two product defects that were its own: `/recipe/${id}/cook${query}`
  became `/recipe/:x/cook:x`, a path that matches nothing, because the
  interpolation that holds `?mode=…` was turned into a path segment before the
  query was stripped. An interpolation that does NOT follow a slash is a
  suffix — a query string or a fragment — and is dropped; only the ones that
  fill a whole segment become `:x`.
*/
const shape = (raw) =>
  raw
    .replace(/(?<!\/)\$\{[^}]*\}/g, '')
    .replace(/\$\{[^}]*\}/g, ':x')
    .replace(/\?.*$/, '')
    .replace(/#.*$/, '');

const targets = [];
for (const file of sources) {
  const text = read(file);
  const rel = path.relative(path.join(HERE, '..', '..'), file);
  for (const re of [
    /<Link\s[^>]*?to=\{?["'`]([^"'`]+)["'`]/gs,
    /<Navigate\s[^>]*?to=["'`]([^"'`]+)["'`]/gs,
    /navigate\(\s*["'`]([^"'`]+)["'`]/gs,
    /navigate\(\s*`([^`]+)`/gs,
  ]) {
    for (const m of text.matchAll(re)) {
      const raw = m[1];
      if (!raw.startsWith('/')) continue;
      targets.push({ raw, shaped: shape(raw), file: rel });
    }
  }
}

/* ── the router's own matching, reduced to what is needed here ───────────── */

const toRegex = (pattern) =>
  new RegExp(
    `^${pattern
      .split('/')
      .map((seg) =>
        seg.startsWith(':') ? '[^/]+' : seg === '*' ? '.*' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      )
      .join('/')}$`,
  );

const concrete = product.filter((r) => r.path !== '*');

/*
  React Router v6 RANKS matches rather than taking the first: a static segment
  outscores a dynamic one, which is why `/recipe/new` goes to the editor and
  not to `/recipe/:recipeId`. Without that, this script called a working URL
  ambiguous — so it ranks too, and only a genuine tie is a problem.
*/
const score = (pattern) =>
  pattern.split('/').reduce((n, seg) => n + (seg === '' ? 0 : seg.startsWith(':') ? 1 : 10), 0);

const matches = (url) => {
  const hit = concrete.filter((r) => toRegex(r.path).test(url));
  if (hit.length < 2) return hit;
  const best = Math.max(...hit.map((r) => score(r.path)));
  const top = hit.filter((r) => score(r.path) === best);
  // One winner is how the router resolves it; two of equal rank is a real tie.
  return top.length === 1 ? top : hit;
};

/* ── report ──────────────────────────────────────────────────────────────── */

const problems = [];
const say = (s) => console.log(s);

say(`ROUTES DECLARED IN App.tsx: ${product.length}`);
for (const r of product) {
  const inViewer = viewer.find((v) => v.path === r.path);
  const mark = inViewer ? (inViewer.element === r.element ? 'ok  ' : 'DIFF') : 'MISS';
  if (mark === 'MISS') {
    problems.push(`route ${r.path} is in App.tsx and NOT in the viewer`);
  }
  if (mark === 'DIFF') {
    problems.push(
      `route ${r.path} renders ${r.element} in the product and ${inViewer.element} in the viewer`,
    );
  }
  say(`  ${mark} ${r.path.padEnd(34)} → ${r.element}`);
}

const viewerOnly = viewer.filter((v) => !product.some((r) => r.path === v.path));
say(`\nVIEWER-ONLY PATHS: ${viewerOnly.length}`);
for (const v of viewerOnly) {
  const allowed = v.path.startsWith('/__inspector/');
  if (!allowed) problems.push(`the viewer declares ${v.path}, which the product does not have`);
  say(`  ${allowed ? 'ok  ' : 'BAD '} ${v.path.padEnd(34)} → ${v.element}`);
}

/*
  The tab bar's four entries are navigation as much as any `<Link>`, and they
  are built from a table (`to: '/home'`) rather than written as literals in
  JSX — so they have to be collected here or `/home` reads as "reachable only
  by address", which is the opposite of the truth: it is a tab.
*/
const tabbarSrc = read(path.join(WEB, 'shell', 'TabBar.tsx'));
for (const m of tabbarSrc.matchAll(/to:\s*'([^']+)'/g)) {
  targets.push({ raw: m[1], shaped: shape(m[1]), file: 'apps/web/src/shell/TabBar.tsx' });
}

const seen = new Map();
for (const t of targets) {
  const key = `${t.shaped}`;
  if (!seen.has(key)) seen.set(key, { ...t, files: new Set() });
  seen.get(key).files.add(t.file);
}
say(`\nNAVIGATION TARGETS IN THE PRODUCT: ${seen.size} distinct`);
for (const [url, t] of [...seen.entries()].sort()) {
  const hit = matches(url);
  const mark = hit.length === 1 ? 'ok  ' : hit.length === 0 ? 'DEAD' : 'AMBI';
  if (hit.length === 0) {
    problems.push(`${url} is navigated to (${[...t.files][0]}) and matches NO route`);
  }
  if (hit.length > 1) {
    problems.push(`${url} matches ${hit.length} routes: ${hit.map((h) => h.path).join(', ')}`);
  }
  say(`  ${mark} ${url.padEnd(40)} ${hit.map((h) => h.element).join('/') || '—'}`);
}

say('\nIS EVERY ROUTE NAVIGATED TO FROM SOMEWHERE IN THE PRODUCT?');
for (const r of concrete) {
  const reached = [...seen.keys()].some((url) => toRegex(r.path).test(url));
  say(`  ${reached ? 'ok  ' : 'URL '} ${r.path.padEnd(34)} ${reached ? '' : 'reachable only by address'}`);
}

/* ── the tab bar, which is the app's top level ───────────────────────────── */

const tabs = [...tabbarSrc.matchAll(/to:\s*'([^']+)'/g)].map((m) => m[1]);
say(`\nTAB BAR ENTRIES: ${tabs.length}`);
for (const t of tabs) {
  const hit = matches(t);
  if (hit.length !== 1) problems.push(`tab ${t} does not match exactly one route`);
  say(`  ${hit.length === 1 ? 'ok  ' : 'BAD '} ${t.padEnd(34)} → ${hit.map((h) => h.element).join()}`);
}

say(`\n${problems.length === 0 ? 'no route problems' : `${problems.length} ROUTE PROBLEMS`}`);
for (const p of problems) say(`  · ${p}`);
process.exitCode = problems.length === 0 ? 0 : 1;
