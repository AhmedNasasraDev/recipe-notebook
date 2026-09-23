// Builds the page that gets PUBLISHED as the artifact: the app itself.
//
// The artifact platform wraps the published file in its own
// <!doctype>/<html>/<head>/<body>, so the page cannot be a whole document —
// and the Vite build emits a whole document. This turns one into the other,
// from the build output, so the hashed asset names can never drift:
//
//   · <title> and the Google Fonts links are the product's own, copied from
//     apps/web/index.html — the §16 typefaces are part of the design.
//   · `dir="rtl"` and `lang="he"` are set on the root element, because in the
//     product those live on <html> in that same file, and the platform owns
//     <html> here.
//   · the built CSS is INLINED rather than linked: one less same-origin fetch
//     to depend on inside the artifact sandbox.
//   · the JS stays a published file, which is how a multi-file artifact works.
//
// The only thing added that the product does not have is one fixed, 11px,
// pointer-events:none badge reading "סימולציה מקומית". It takes no layout
// space and can never intercept a click, and it is there because an app whose
// writes go nowhere must say so somewhere.
//
//   node artifact/scripts/page.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));

const built = readFileSync(at('../dist/app.html'), 'utf8');
const js = built.match(/src="\.\/(assets\/[^"]+\.js)"/)?.[1];
const css = built.match(/href="\.\/(assets\/[^"]+\.css)"/)?.[1];
if (!js || !css) {
  console.error('could not find the built asset names in artifact/dist/app.html');
  process.exit(1);
}
const cssText = readFileSync(at(`../dist/${css}`), 'utf8');

/*
  NO FONT LINK ANY MORE — AND THAT IS THE POINT.

  This used to lift the <link> to fonts.googleapis.com out of the product's
  index.html and re-emit it here, with a long note about parsing it as a tag
  rather than as lines (a stray href line once became a text node in <body>,
  pushed the frame past the viewport and hid the tab bar).

  The whole class of problem is gone: the two Hebrew faces are served from the
  project, the build inlines them into the CSS below as data: URIs, and the
  published page makes no outward request at all. `probe.mjs` asserts that.
*/

const page = `<title>מחברת מתכונים</title>
<style>
/* ── the host page, not the product ──────────────────────────────
   Three rules and a badge. Everything else on this page is the product's own
   stylesheet, inlined below exactly as the build emitted it.

   "height: 100%" down the chain: the app is a one-screen application whose
   frame asks for the whole viewport and scrolls INSIDE it (AppShell's content
   area), so the chain from the viewport to #root has to have a height for the
   frame to fill.

   THERE IS NO "overflow: hidden" HERE, AND THERE MUST NOT BE.

   It was here, to keep the page around the app from scrolling — a page that
   scrolls is a page whose bottom tab bar can end up below the fold. It cost
   Ahmed the ability to cook: Cook Mode is the one screen the product renders
   OUTSIDE the AppShell (App.tsx: "§14 asks for a full screen without tabs"),
   so it is the DOCUMENT that scrolls it, and "overflow: hidden" on the
   document clipped it. Measured on the published page at 412x620: the body
   704px in a 620px viewport, the "מתחילים בהכנה" gate at 622 — off screen —
   and after a 3000px wheel the scroll offset still 0. The stage could not be
   completed at all, which no product code did: the product's own index.html
   has no such rule.

   What the rule was guarding is measured instead, per screen and per width,
   by probe-shell.mjs and responsive.mjs (the body is never taller than the
   viewport on a shell screen, and the document is never actually scrolled) —
   a measurement rather than a clamp that hides the thing it measures.

   The ":root" padding reset is a different problem, and it stays. The artifact
   skeleton pads :root by the phone's safe-area insets, and the product's frame
   asks for 100dvh INSIDE that padding, so the sum overflows the viewport by
   exactly the inset and the tab bar goes under the edge. The product's frame is
   designed to own the whole screen — on a phone it drops its own rounding and
   shadow to do exactly that — so the padding is dropped here and the frame
   gets the screen it expects. */
html, body { height: 100%; margin: 0; }
/*
  THERE IS NO BADGE HERE ANY MORE, AND NO BAND FOR ONE.

  A fixed 18px strip used to sit across the top reading "סימולציה מקומית", and
  the app frame was given the viewport MINUS 20px so a fixed overlay could not
  collide with a control. Ahmed asked for the strip removed outright, and
  explicitly: "אל תשאיר שטח ריק, ריווח או היסט שנוספו עבורם". So the inset
  went with it — #root, the outer element and the frame are all back to the
  whole viewport, which is the size the product's own frame is designed for.

  What is NOT removed with it: the simulation itself. The repository still
  reports its source as 'simulated', nothing about saving changed, and no
  replacement banner was put in its place. The page simply no longer says so.
*/
#root { height: 100%; min-height: 0; }
/*
  The ":root" padding reset is a different problem, and it stays. The artifact
  skeleton pads :root by the phone's safe-area insets, and the product's frame
  asks for 100dvh INSIDE that padding, so the sum overflows the viewport by
  exactly the inset and the tab bar goes under the edge.
*/
:root { padding: 0 !important; }

/* ── the product's built stylesheet, verbatim ─────────────────────────── */
${cssText}
</style>
<script>
  /* In the product these two attributes sit on <html> in apps/web/index.html.
     The platform owns <html> here, so they are set at boot instead. */
  document.documentElement.setAttribute('dir', 'rtl');
  document.documentElement.setAttribute('lang', 'he');
</script>
<div id="root"></div>
<script type="module" src="./${js}"></script>
`;

writeFileSync(at('../app-page.html'), page);
console.log(
  `artifact/app-page.html written — ${(page.length / 1024).toFixed(0)}KB ` +
    `(css inlined), script ./${js}`,
);
