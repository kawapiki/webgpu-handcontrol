#!/usr/bin/env node
/**
 * Finalize the dist-lib/ tree so `cd dist-lib && npm publish` works.
 *
 * Steps:
 *   1. Copy package.lib.json → dist-lib/package.json (the publish manifest).
 *   2. Copy README.lib.md → dist-lib/README.md.
 *   3. Copy LICENSE if present.
 *
 * Run via `npm run build:lib`.
 */

import { copyFile, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist-lib');

async function copyIfExists(src, dest) {
  try {
    await access(src);
    await copyFile(src, dest);
    console.log(`finalize-lib: ${src} → ${dest}`);
  } catch {
    /* missing source, skip */
  }
}

await copyFile(resolve(root, 'package.lib.json'), resolve(dist, 'package.json'));
await copyFile(resolve(root, 'README.lib.md'),    resolve(dist, 'README.md'));
await copyIfExists(resolve(root, 'LICENSE'),       resolve(dist, 'LICENSE'));

console.log('finalize-lib: dist-lib/ is publish-ready.');
