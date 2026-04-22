import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(process.cwd(), '.playwright-browsers');

export default defineConfig({
  testDir: './e2e/web',
  fullyParallel: true,
  globalSetup: './e2e/web/global-setup.ts',
  outputDir: 'test-results/playwright-web',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/web' }]],
  timeout: 60_000,
  // Under heavy local parallelism the dev server occasionally drops an
  // in-flight auth.refresh or tRPC batch, which surfaces as a one-off
  // TRPCClientError. One retry absorbs that transient state without
  // masking genuine bugs — a real failure will deterministically fail
  // again on the retry and show up as a red test.
  retries: process.env.CI ? 2 : 1,
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
      command: 'npm run dev:server',
      url: 'http://127.0.0.1:8090/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: 'npm run dev:web',
      url: 'http://localhost:3000/login',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
