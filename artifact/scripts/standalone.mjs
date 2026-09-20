/*
  Folds the demo build into ONE html file that can be downloaded, opened from
  disk and passed on.

    node artifact/scripts/standalone.mjs

  WHY A SINGLE FILE, AND WHAT THAT COSTS

  A page opened as `file://…` has no server to fetch a sibling from, and
  browsers treat local files as opaque origins — a separate `assets/…js` is a
  second request that several of them refuse outright. So the stylesheet (with
  the two Hebrew faces already inlined as data: URIs by the build) and the one
  script are read off disk and written into the document itself. The cost is
  size: about 1 MB, all of it text, which downloads once and then runs with no
  network at all.

  WHAT THIS REFUSES TO SHIP

  A file meant to be passed around must not carry credentials. The build
  already defines both Supabase variables as empty, and this checks the OUTPUT:
  a project URL, a JWT, a publishable or secret key, or the name of the
  project's own Supabase ref stops the pack. It also refuses if the page still
  references a file it would have to fetch.
*/

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const DIST = at('../dist-demo');
const OUT = at('../dist-demo/recipe-notebook-demo.html');

const html = readFileSync(path.join(DIST, 'demo.html'), 'utf8');

const cssHref = html.match(/href="\.\/(assets\/[^"]+\.css)"/)?.[1];
const jsSrc = html.match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1];
if (!cssHref || !jsSrc) {
  console.error('the built page does not look like the demo build (no css/js asset found)');
  process.exit(1);
}

const css = readFileSync(path.join(DIST, cssHref), 'utf8');
const js = readFileSync(path.join(DIST, jsSrc), 'utf8');

/*
  `</script>` inside the bundle would end the tag it is sitting in — the one
  escape a page like this actually needs. The same for `<!--`, which starts an
  HTML comment inside a classic script.
*/
const inlineSafe = (code) =>
  code.replaceAll('</script', '<\\/script').replaceAll('<!--', '<\\!--');

/*
  The checks below run on the DOCUMENT, not on the inlined blobs: a minified
  bundle legitimately contains strings that look like `src="…"`, and checking
  them would report the page's own code as a missing file. So the shell is
  measured first, and only then is the code poured in.
*/
const shell = html
  .replace(new RegExp(`\\s*<link[^>]+href="\\./${cssHref}"[^>]*>`), '')
  .replace(new RegExp(`\\s*<script[^>]+src="\\./${jsSrc}"[^>]*></script>`), '');

const left = [...shell.matchAll(/(?:src|href)="(?!data:|#|https:\/\/)([^"]+)"/g)].map((m) => m[1]);
if (left.length > 0) {
  console.error(`refusing to pack: the page would still fetch ${left.join(', ')}`);
  process.exit(1);
}

/*
  THE REPLACEMENTS ARE FUNCTIONS, NOT STRINGS.

  `String.replace` reads `$&`, `$'` and `` $` `` inside a REPLACEMENT STRING as
  references to the match — and a minified bundle is full of `$` sequences, so
  passing the code as a string quietly spliced pieces of the <script> tag into
  the middle of it (measured: five copies of the tag inside the code, and the
  page died on "Invalid or unexpected token"). A function replacer is taken
  literally.
*/
let out = html
  .replace(new RegExp(`\\s*<link[^>]+href="\\./${cssHref}"[^>]*>`), () => `\n    <style>${css}</style>`)
  .replace(
    new RegExp(`\\s*<script[^>]+src="\\./${jsSrc}"[^>]*></script>`),
    () => `\n    <script type="module">${inlineSafe(js)}</script>`,
  );

// ── what must not be in it ────────────────────────────────────────────────
const forbidden = [
  [/https:\/\/[a-z0-9]{16,}\.supabase\.co/i, 'a Supabase project URL'],
  [/sb_(publishable|secret)_[A-Za-z0-9_-]{10,}/, 'a Supabase key'],
  [/eyJhbGciOi[A-Za-z0-9._-]{30,}/, 'a JWT'],
  [/qxdpsomelzpvphkhkqrw/i, "the project's own Supabase ref"],
  /*
    The fixture's acting account is neutral by default (`SELF_NAME` in
    viewer/fixtures.ts) and only the audit viewer renames it to the owner's.
    This is what keeps that true of a file meant to be passed around.
  */
  [/אחמד/, "the owner's own name"],
];
for (const [re, what] of forbidden) {
  const hit = re.exec(out);
  if (hit) {
    console.error(`refusing to pack: the output contains ${what} (${hit[0].slice(0, 24)}…)`);
    process.exit(1);
  }
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, out, 'utf8');
/*
  The same bytes under two names. `recipe-notebook-demo.html` is what a person
  downloads and recognises in their files; `index.html` is what a static host
  serves at the root of a URL, which is how the demo has to be opened on most
  phones (a downloaded .html often cannot be opened from local storage there).
*/
const INDEX = path.join(path.dirname(OUT), 'index.html');
writeFileSync(INDEX, out, 'utf8');

/*
  The build's own output goes away once it is folded in: what is left in
  `dist-demo` is the two identical documents and nothing else, so the directory
  can be handed to a static host as it stands — and nobody can open the
  half-page that still points at `./assets/…`.
*/
rmSync(path.join(DIST, 'demo.html'), { force: true });
rmSync(path.join(DIST, 'assets'), { recursive: true, force: true });

const kb = (n) => `${Math.round(n / 1024)}KB`;
console.log(
  `${path.relative(process.cwd(), OUT)} + index.html written — ${kb(Buffer.byteLength(out))} ` +
    `(css ${kb(css.length)} with the fonts inside, js ${kb(js.length)}), 0 files to fetch`,
);
