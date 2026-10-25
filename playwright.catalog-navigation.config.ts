import { defineConfig } from '@playwright/test';
import base from './playwright.web.config';
export default defineConfig({
  ...base,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: undefined,
  testMatch: ['catalog-navigation.probe.ts'],
  timeout: 120_000,
  outputDir: process.env.LAB_BROWSER_OUTPUT,
  reporter: [['list'], ['json', { outputFile: process.env.LAB_BROWSER_JSON }]],
  webServer: base.webServer.map((server, index) =>
    index === 0
      ? { ...server, command: 'node e2e/web/support/catalog-freshness-server.mjs' }
      : {
          ...server,
          command:
            'pnpm --filter @puntovivo/web exec vite preview --host 127.0.0.1 --port 5173 --strictPort',
        }
  ),
  use: { ...base.use, video: 'off', trace: 'retain-on-failure' },
});
