/**
 * Library build for the future `@kawapiki/handcontrol` npm package.
 * Run `npm run build:lib` — emits ESM JS + .d.ts to dist-lib/.
 *
 * The published surface is `src/control/index.ts` plus its transitive
 * dependencies (gestures, filters, tracking, util, config types).
 * The Three.js / Tweakpane / scene / debug code is the demo app and is
 * NOT bundled.
 *
 * `@mediapipe/tasks-vision` is externalized — consumers install it
 * themselves so we don't bake a 30+ MB WASM-bearing dep into the lib.
 */

import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // The demo app's public/ assets (demo-page.html etc.) belong to the app,
  // not the lib. Disable public-dir copying for this build.
  publicDir: false,
  build: {
    lib: {
      entry: resolve(__dirname, 'src/control/index.ts'),
      name: 'HandControl',
      formats: ['es'],
      fileName: () => 'handcontrol.js',
    },
    rollupOptions: {
      external: ['@mediapipe/tasks-vision'],
    },
    sourcemap: true,
    outDir: 'dist-lib',
    emptyOutDir: true,
    target: 'es2022',
  },
});
