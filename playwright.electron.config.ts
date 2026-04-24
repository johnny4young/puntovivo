/**
 * ENG-001 Step 3 — Playwright config for the Electron smoke suite.
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

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(
  process.cwd(),
  '.playwright-browsers'
);

export default defineConfig({
  testDir: './e2e/electron',
  fullyParallel: false,
  workers: 1,
  globalSetup: './e2e/electron/global-setup.ts',
  outputDir: 'test-results/playwright-electron',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report/electron' }],
  ],
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
  webServer: {
    command: 'npm run dev:web',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
