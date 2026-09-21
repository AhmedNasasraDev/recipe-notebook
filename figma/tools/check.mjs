/*
  Checks every built script WITHOUT touching Figma:

    node figma/tools/check.mjs

    1. size      — under the 50,000-character limit of use_figma's `code`
    2. syntax    — parsed the way use_figma runs it (async wrapper)
    3. forbidden — APIs that throw or are unsupported inside use_figma
    4. names     — every colour/radius variable, text style, component and
                   variant the script asks for exists in lib/inventory.json
    5. run       — executed against tools/mock-figma.mjs, collecting warnings
                   (text FILL without HEIGHT, sizing set before parenting…)

  A pass here means the script will RUN. It does not mean the result looks
  right — that is what the screenshots after the real run are for.
*/
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { makeFigma } from './mock-figma.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.join(HERE, '..');
const DIST = path.join(ROOT, 'dist');
const inventory = JSON.parse(readFileSync(path.join(ROOT, 'lib', 'inventory.json'), 'utf8'));

const FORBIDDEN = [
  [/figma\.notify\s*\(/, 'figma.notify() throws "not implemented"'],
  [/loadAllPagesAsync/, 'loadAllPagesAsync is not supported'],
  [/setPluginData/, 'setPluginData is not supported'],
  [/createImageAsync/, 'createImageAsync is not supported'],
  [/figma\.currentPage\s*=[^=]/, 'assigning figma.currentPage throws — use setCurrentPageAsync'],
  [/console\.log/, 'console.log is invisible to the caller — return instead'],
  [/\(async\s*\(\)\s*=>/, 'do not wrap in an async IIFE — the code is wrapped already'],
];

const KNOWN = {
  colour: new Set(inventory.colorVariables),
  number: new Set(inventory.numberVariables),
  style: new Set(inventory.textStyles),
  component: new Set([...inventory.components, ...Object.keys(inventory.componentSets)]),
};
const VARIANTS = inventory.componentSets;

const files = readdirSync(DIST).filter((f) => f.endsWith('.js')).sort();
let failures = 0;
let warnings = 0;

for (const file of files) {
  const code = readFileSync(path.join(DIST, file), 'utf8');
  const problems = [];
  const notes = [];

  // 1 · size
  if (code.length > 50000) problems.push(`too long for use_figma: ${code.length} characters (limit 50,000)`);

  // 2 · syntax
  try {
      new Function('figma', `return (async () => {\n${code}\n})()`);
  } catch (e) {
    problems.push(`syntax: ${e.message}`);
  }

  // 3 · forbidden APIs — skipping the preamble's own documentation of them
  const codeNoComments = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [re, why] of FORBIDDEN) {
    if (re.test(codeNoComments)) problems.push(`forbidden: ${why}`);
  }

  // 4 · names
  const collect = (re, group) => [...codeNoComments.matchAll(re)].map((m) => m[group || 1]);
  for (const name of collect(/\bpf\(\s*'([^']+)'/g)) {
    if (!KNOWN.colour.has(name)) problems.push(`unknown colour variable: "${name}"`);
  }
  for (const name of collect(/\bbindR\(\s*[^,]+,\s*'([^']+)'/g)) {
    if (!KNOWN.number.has(name)) problems.push(`unknown radius variable: "${name}"`);
  }
  for (const name of collect(/VAR\['([^']+)'\]/g)) {
    if (!KNOWN.colour.has(name) && !KNOWN.number.has(name)) problems.push(`unknown variable: "${name}"`);
  }
  for (const name of collect(/\btxt\(\s*'([^']+)'/g)) {
    if (!KNOWN.style.has(name)) problems.push(`unknown text style: "${name}"`);
  }
  /*
    A variant name can be computed (`inst('שורת/שקילה', done ? 'מסומן=כן' : …)`
    or a template literal inside the preamble), and a static check cannot
    resolve those — so only LITERAL second arguments are validated, and a
    missing second argument is only an error when there is none at all.
  */
  for (const m of codeNoComments.matchAll(/\binst\(\s*'([^']+)'\s*(,([^)]*))?\)/g)) {
    const comp = m[1];
    const hasSecond = Boolean(m[2]);
    const second = (m[3] || '').trim();
    if (!KNOWN.component.has(comp)) {
      problems.push(`unknown component: "${comp}"`);
      continue;
    }
    if (!VARIANTS[comp]) continue;
    if (!hasSecond) {
      problems.push(`"${comp}" is a set — a variant name is required`);
      continue;
    }
    const literal = /^'([^']+)'$/.exec(second);
    if (!literal) continue; // computed at runtime; the mock run covers it
    if (!VARIANTS[comp].includes(literal[1])) {
      problems.push(`unknown variant "${literal[1]}" of "${comp}"`);
    }
  }
  for (const name of collect(/\bicon\(\s*'([^']+)'/g)) {
    if (!KNOWN.component.has(`אייקון/${name}`)) problems.push(`unknown icon: "${name}"`);
  }
  for (const name of collect(/\btabBar\(\s*[A-Za-z_$][\w$]*\s*,\s*'([^']+)'\s*\)/g)) {
    if (!VARIANTS['ניווט/פס תחתון'].includes(`פעיל=${name}`)) problems.push(`unknown tab: "${name}"`);
  }

  warnings += notes.length;
  if (problems.length) {
    failures += 1;
    console.log(`FAIL ${file}`);
    for (const p of problems) console.log(`       ✗ ${p}`);
  } else {
    console.log(`ok   ${file}${notes.length ? `  (${notes.length} warnings)` : ''}`);
  }
  for (const n of [...new Set(notes)].slice(0, 6)) console.log(`       ! ${n}`);
}

console.log(`\nstatic: ${files.length - failures}/${files.length} scripts pass · ${warnings} warnings`);

/*
  5 · THE CHAINED RUN.

  One mock file, every script in order — the way they will actually run. This
  is what catches a script that depends on something an earlier one creates
  (the prototype needs the five flow screens; the tidy pass needs the library
  sections), which a per-script run would report as a phantom failure.
*/
const chainNotes = [];
const { figma } = makeFigma(inventory, (w) => chainNotes.push(w));
let chainFailures = 0;
console.log('\nchained run (one file, in order):');
for (const file of files) {
  const code = readFileSync(path.join(DIST, file), 'utf8');
  try {
      const run = new Function('figma', `return (async () => {\n${code}\n})()`);
    const result = await run(figma);
    if (!result || typeof result !== 'object') throw new Error('returns nothing — every script must return its node ids');
    const keys = Object.keys(result).join(', ');
    console.log(`  ok   ${file.padEnd(30)} → { ${keys} }`);
  } catch (e) {
    chainFailures += 1;
    console.log(`  FAIL ${file.padEnd(30)} → ${e.message}`);
  }
}
for (const n of [...new Set(chainNotes)].slice(0, 10)) console.log(`  !    ${n}`);

const pages = figma.root.children.map((p) => `${p.name}: ${p.children.length} top-level nodes`);
console.log(`\nwhat the mock file ended up holding:`);
for (const line of pages) console.log(`  ${line}`);

console.log(`\nchained: ${files.length - chainFailures}/${files.length} scripts ran`);
console.log('checked statically and against a mock — NOT against Figma.');
process.exitCode = failures || chainFailures ? 1 : 0;
