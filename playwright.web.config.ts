import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

// Playwright controls worker colour through FORCE_COLOR. Preserve an
// operator's NO_COLOR preference without passing both variables to Node,
// which otherwise prints a warning from every affected worker.
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
  process.env.FORCE_COLOR ??= '0';
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(process.cwd(), '.playwright-browsers');
process.env.PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS ??= '15000';

const webServerEnv = Object.fromEntries(
  Object.entries({
    ...process.env,
    PUNTOVIVO_E2E: '1',
    PUNTOVIVO_GLOBAL_RATE_LIMIT_MAX: '10000',
  }).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
);

export default defineConfig({
  testDir: './e2e/web',
  fullyParallel: true,
  // The suite shares one SQLite-backed server and exercises Argon2-backed
  // staff-PIN decisions. Playwright's host-derived default (7 workers on the
  // current 14-core dev machine) can starve auth refresh and queue
  // invalidation long enough to create false retries. Four workers preserves
  // parallel coverage without oversubscribing that shared operational state.
  workers: 4,
  globalSetup: './e2e/web/global-setup.ts',
  outputDir: 'test-results/playwright-web',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/web' }]],
  timeout: 60_000,
  // Retries hide operational contention as a green run. Keep the evidence
  // single-attempt: a transient auth, SQLite, or renderer failure is still a
  // defect in the shared-store execution contract and must remain visible.
  retries: 0,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
  webServer: [
    {
      command: 'node scripts/dev-launcher.mjs server',
      env: webServerEnv,
      url: 'http://127.0.0.1:8090/api/health',
      reuseExistingServer: !process.env.CI,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2_000 },
      timeout: 120_000,
    },
    {
      command: 'node scripts/dev-launcher.mjs web',
      url: 'http://localhost:3000/login',
      reuseExistingServer: !process.env.CI,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2_000 },
      timeout: 120_000,
    },
  ],
});
