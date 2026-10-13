import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { assertWebE2eEnvCanUsePlaintextFixture } from './scripts/web-e2e-env.mjs';
import {
  DEFAULT_E2E_API_ORIGIN,
  resolveE2eApiOrigin,
  resolveE2eWebOrigin,
} from './e2e/web/support/api-origin.ts';

// Playwright controls worker colour through FORCE_COLOR. Preserve an
// operator's NO_COLOR preference without passing both variables to Node,
// which otherwise prints a warning from every affected worker.
if (process.env.NO_COLOR !== undefined) {
  delete process.env.NO_COLOR;
  process.env.FORCE_COLOR ??= '0';
}

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(process.cwd(), '.playwright-browsers');
process.env.PUNTOVIVO_SQLITE_BUSY_TIMEOUT_MS ??= '15000';
assertWebE2eEnvCanUsePlaintextFixture(process.cwd());
// Playwright merges each webServer.env with the runner's environment. Omitting
// this key from the child override alone would still inherit it and make the
// suite-owned plaintext fixture unreadable. Clear only the test runner copy.
delete process.env.PUNTOVIVO_DB_KEY;
const apiOrigin = resolveE2eApiOrigin(process.env.PUNTOVIVO_E2E_API_ORIGIN, DEFAULT_E2E_API_ORIGIN);
const apiPort = new URL(apiOrigin).port;
// SameSite=Strict refresh cookies survive full navigation only when both
// loopback origins use the same hostname. Never weaken the cookie policy.
const webOrigin = resolveE2eWebOrigin(apiOrigin);
const webHost = new URL(webOrigin).hostname;
// Direct probes, renderer and owned backend must target the same listener.
process.env.PUNTOVIVO_E2E_API_ORIGIN = apiOrigin;
const e2eDbPath = path.resolve(process.cwd(), 'packages/server/data/local.db');

const webServerEnv = Object.fromEntries(
  Object.entries({
    ...process.env,
    // The fixture opens this exact plaintext DB directly. Never inherit a
    // shared-dev DATABASE_URL into the suite.
    DATABASE_URL: e2eDbPath,
    // The standalone dev launcher does not override an inherited production
    // marker. Keep this suite's plaintext fixture explicitly in development
    // without weakening the server's production SQLCipher requirement.
    NODE_ENV: 'development',
    PUNTOVIVO_RUNTIME_ENV: 'development',
    // An operator's Hub/LAN environment must not turn the test-owned server
    // into a site hub or bind it beyond loopback.
    PUNTOVIVO_AUTHORITY_MODE: 'device_local',
    PUNTOVIVO_BIND_HOST: '127.0.0.1',
    PUNTOVIVO_BIND_PORT: apiPort,
    PUNTOVIVO_E2E: '1',
    // Only the isolated test server needs this key; its plaintext DB is opened by the harness.
    PUNTOVIVO_EXTERNAL_ORDER_KEY: randomBytes(32).toString('hex'),
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
    baseURL: webOrigin,
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
      // Direct workspace commands do not sweep a sibling task's listeners.
      // Fail closed on a port collision rather than borrowing its backend:
      // run without a file watcher so EADDRINUSE exits the command instead
      // of leaving a live watcher while the health probe reaches another
      // listener on the same port.
      command: 'pnpm --filter @puntovivo/server run dev:once',
      env: webServerEnv,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2_000 },
      timeout: 120_000,
    },
    {
      // The normal dev port 3000 can belong to another Git worktree. Use a
      // dedicated Vite origin whose owner Playwright must start itself.
      command: `pnpm --filter @puntovivo/web exec vite --host ${webHost} --port 5173 --strictPort`,
      env: {
        VITE_API_URL: apiOrigin,
        NODE_ENV: 'development',
        PUNTOVIVO_RUNTIME_ENV: 'development',
      },
      url: `${webOrigin}/login`,
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 2_000 },
      timeout: 120_000,
    },
  ],
});
