#!/usr/bin/env node
/**
 * ENG-001 Step 3 — guard that fails fast when the Electron smoke tries
 * to run without the Vite main-process build in place.
 *
 * The Electron smoke suite (`playwright.electron.config.ts`) launches
 * `apps/desktop/.vite/build/index.cjs`. `npm run test:e2e:electron`
 * rebuilds these artefacts through
 * `npm run build:main --workspace=@puntovivo/desktop` before invoking
 * Playwright. This script remains as the fast failure path for direct
 * Playwright invocations or stale local workflows that skipped the
 * build step.
 *
 * @module scripts/ensure-electron-main-build
 */

import { existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
// Main process lands at `.vite/build/index.cjs`; preload lands at
// `.vite/preload/index.cjs` (sibling, not under build/). The main
// process references it as `join(__dirname, '../preload/index.cjs')`
// so both must agree on this layout.
const mainEntry = join(repoRoot, 'apps/desktop/.vite/build/index.cjs');
const preloadEntry = join(repoRoot, 'apps/desktop/.vite/preload/index.cjs');
const migrationsJournal = join(
  repoRoot,
  'apps/desktop/.vite/build/migrations/meta/_journal.json'
);

const missing = [];
if (!existsSync(mainEntry)) missing.push(relative(repoRoot, mainEntry));
if (!existsSync(preloadEntry)) missing.push(relative(repoRoot, preloadEntry));
if (!existsSync(migrationsJournal)) {
  missing.push(relative(repoRoot, migrationsJournal));
}

if (missing.length === 0) {
  process.exit(0);
}

const lines = [
  '',
  'ENG-001 Step 3 — Electron smoke aborted.',
  '',
  `  Missing build artefacts:`,
  ...missing.map(path => `    - ${path}`),
  '',
  '  Rebuild the Electron main + preload bundles with:',
  '',
  '    npm run build:main --workspace=@puntovivo/desktop',
  '',
  '  Then re-run: npm run test:e2e:electron',
  '',
];

process.stderr.write(lines.join('\n'));
process.exit(1);
