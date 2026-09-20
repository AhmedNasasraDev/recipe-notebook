// Build config for the SHAREABLE DEMO only.
//
// Separate from both `apps/web/vite.config.ts` (the product) and
// `./vite.config.ts` (the audit viewer): this one builds `demo.html` into
// `artifact/dist-demo`, which `scripts/standalone.mjs` then folds into a single
// HTML file. The product's build is untouched by it.
//
// TWO THINGS THIS CONFIG IS RESPONSIBLE FOR
//
//   1. NOTHING IS FETCHED AT RUNTIME. The fonts are inlined as data: URIs (the
//      inline limit is above the largest face) and the script is folded into
//      the page afterwards, because a file opened from `file://` has no server
//      to fetch a sibling from and, in several browsers, is not allowed to.
//   2. NO CREDENTIALS. `envDir` points at this directory, which has no `.env`
//      of any kind, and the two Supabase variables are defined as empty
//      strings so that even a stray env file cannot put a project URL or a key
//      into a file that is meant to be passed around. `standalone.mjs` checks
//      the built output as well.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': '""',
    'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
  },
  resolve: {
    alias: {
      '@recipe-notebook/engine': fileURLToPath(
        new URL('../packages/engine/src/index.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('../apps/web/src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist-demo',
    emptyOutDir: true,
    assetsInlineLimit: 120_000,
    // One chunk: a single file cannot load a second one from `file://`.
    modulePreload: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./demo.html', import.meta.url)),
      output: { inlineDynamicImports: true },
    },
  },
});
