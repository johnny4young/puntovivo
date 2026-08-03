#!/usr/bin/env node

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(repoRoot, 'apps', 'web');

// Vite preserves an externally supplied NODE_ENV. A developer shell running
// the local stack commonly exports development, which otherwise makes
// `vite build` emit a larger development-flavoured artifact and produces a
// false platform-dependent bundle-budget failure. Set the production contract
// before Vite is loaded so build output matches CI on every supported OS.
process.env.NODE_ENV = 'production';

const { build } = await import('vite');

await build({
  root: webRoot,
  mode: 'production',
});
