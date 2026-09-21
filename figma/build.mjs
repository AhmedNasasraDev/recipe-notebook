/*
  Builds the ready-to-run scripts: resolves `// @include <path>` (the shared
  preamble) and writes one self-contained file per script into figma/dist/,
  because `use_figma` takes a single blob of JavaScript and nothing persists
  between calls.

    node figma/build.mjs
*/
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SRC = path.join(HERE, 'scripts');
const OUT = path.join(HERE, 'dist');
mkdirSync(OUT, { recursive: true });

const inventory = JSON.parse(readFileSync(path.join(HERE, 'lib', 'inventory.json'), 'utf8'));

const resolve = (file, seen = new Set()) => {
  if (seen.has(file)) throw new Error(`circular include: ${file}`);
  seen.add(file);
  const text = readFileSync(file, 'utf8');
  return text
    .split('\n')
    .map((line) => {
      const m = /^\s*\/\/\s*@include\s+(\S+)\s*$/.exec(line);
      if (!m) return line;
      const target = path.resolve(path.dirname(file), m[1]);
      return `// ── included: ${path.relative(HERE, target)} ───────────────────────\n${resolve(target, seen)}\n// ── end include ──────────────────────────────────────────────────`;
    })
    .join('\n');
};

const files = readdirSync(SRC).filter((f) => f.endsWith('.js')).sort();
const rows = [];
for (const f of files) {
  const code = resolve(path.join(SRC, f));
  writeFileSync(path.join(OUT, f), code, 'utf8');
  const first = code.split('\n').find((l) => /^\s{2}\d+\s·/.test(l)) || '';
  rows.push({ file: f, kb: Math.round(Buffer.byteLength(code) / 1024), title: first.trim() });
}

const order = [
  '| # | קובץ | מה הוא עושה | קריאות |',
  '|---|------|--------------|--------|',
  ...rows.map((r, i) => `| ${i + 1} | \`dist/${r.file}\` | ${r.title || '—'} | 1 |`),
];
writeFileSync(
  path.join(OUT, 'RUN_ORDER.md'),
  `# סדר הרצה

הקובץ: ${inventory.fileUrl}  ·  fileKey \`${inventory.fileKey}\`

כל שורה = קריאה אחת ל-\`use_figma\`. להריץ מלמעלה למטה: 16 (אבטיפוס) תלוי ב-02–05,
ו-01 צריך לרוץ לפני צילומי מצג כדי שהתגים לא ייראו שבורים.

${order.join('\n')}

סה"כ ${rows.length} קריאות. במסלול Professional (200 ביום) זה יום עבודה אחד.
`,
  'utf8',
);

console.log(`built ${rows.length} scripts → figma/dist`);
for (const r of rows) console.log(`  ${r.file.padEnd(34)} ${String(r.kb).padStart(3)}KB`);
