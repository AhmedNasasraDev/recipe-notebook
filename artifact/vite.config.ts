// Build config for the AUDIT VIEWER only.
//
// Separate from `apps/web/vite.config.ts` on purpose: this one builds a
// different entry (`viewer/app.html`) into `artifact/dist`, and the product's
// own build is untouched by it. `base: './'` so the published artifact can
// serve the bundle from any path.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      // The same alias the product build uses: the engine is consumed from
      // source. Without it the imports in the product's own components do not
      // resolve from this root.
      '@recipe-notebook/engine': fileURLToPath(
        new URL('../packages/engine/src/index.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('../apps/web/src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    /*
      THE FONTS TRAVEL INSIDE THE PAGE.

      The application serves its two Hebrew faces from files (better caching,
      four small requests). The ARTIFACT is a single published HTML document
      whose CSS is inlined into it, and a page that fetches four more files has
      four more ways to render in a fallback serif — which is exactly the
      problem vendoring the fonts solved. Raising the inline limit above the
      largest face (44 KB) turns them into data: URIs inside that CSS, so the
      published page is self-contained and asks the network for nothing at all.
    */
    assetsInlineLimit: 120_000,
    rollupOptions: {
      input: fileURLToPath(new URL('./app.html', import.meta.url)),
    },
  },
});
