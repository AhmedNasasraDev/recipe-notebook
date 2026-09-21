// Syntax-checks a build script the way `use_figma` runs it: wrapped in an
// async function, so top-level await is legal.
import { readFileSync } from 'node:fs';
const file = process.argv[2];
const code = readFileSync(file, 'utf8');
try {
  new Function('figma', `return (async () => {\n${code}\n})()`);
  console.log(`ok   ${file}`);
} catch (e) {
  console.log(`FAIL ${file} — ${e.message}`);
  process.exitCode = 1;
}
