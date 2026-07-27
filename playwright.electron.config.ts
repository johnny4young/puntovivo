/**
 * Step 3 — Playwright config for the Electron smoke suite.
 *
 * Launches Electron directly from `apps/desktop/.vite/build/index.cjs`
 * via the `_electron` fixture (see `e2e/electron/fixtures.ts`). The
 * webServer block serves the renderer dev bundle only; Electron still
 * embeds its own Fastify server in-process.
 *
 * Parallelism: workers=1. The Electron smoke boots the embedded
 * server against a single tmpdir DB (`test-results/electron-userdata/`);
 * two concurrent workers would race the sqlite WAL. Keep it serial.
 *
 * Prerequisite: run through `npm run test:e2e:electron`. The root
 * script builds @puntovivo/server, rebuilds the Electron main/preload
 * Vite artefacts, and then runs `scripts/ensure-electron-main-build.mjs`
 * to fail fast when a direct Playwright invocation skipped that step.
 *
 * @module playwright.electron.config
 */

import path from 'node:path';
import { defineConfig } from '@playwright/test';

// See playwright.web.config.ts: do not pass conflicting colour contracts to
// Node worker processes.
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
  process.env.FORCE_COLOR ??= '0';
}

// A packaged run drives the shipped artefact, which serves its renderer from
// the puntovivo-app:// origin baked into the bundle. The Vite dev server is
// not involved, so starting one would only add a port to collide on.
const isPackagedRun = (process.env.PUNTOVIVO_PACKAGED_APP ?? '').length > 0;

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(process.cwd(), '.playwright-browsers');

export default defineConfig({
  testDir: './e2e/electron',
  fullyParallel: false,
  workers: 1,
  globalSetup: './e2e/electron/global-setup.ts',
  outputDir: 'test-results/playwright-electron',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/electron' }]],
  // Electron launch + embedded server boot is heavier than the web
  // suite's chromium attach. Give the smoke longer.
  timeout: 120_000,
  // Retries are less useful here — if Electron fails to launch the
  // retry hits the same main-process problem. Keep 1 retry on CI to
  // absorb truly transient timing issues, 0 locally.
  retries: process.env.CI ? 1 : 0,
  expect: {
    timeout: 15_000,
  },
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: isPackagedRun
    ? undefined
    : {
        // Use the web workspace command directly instead of the root dev
        // launcher. The launcher intentionally detaches its Vite child for
        // interactive dev sessions, but Playwright needs to own the process
        // tree so the Electron smoke can exit cleanly after the test.
        command: 'pnpm --filter @puntovivo/web run dev',
        url: 'http://localhost:3000/login',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
