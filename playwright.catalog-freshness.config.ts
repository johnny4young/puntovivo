import { defineConfig } from '@playwright/test';
import base from './playwright.web.config';
export default defineConfig({
  ...base,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  globalSetup: undefined,
  testMatch: ['catalog-freshness.probe.ts'],
  outputDir: process.env.LAB_BROWSER_OUTPUT,
  reporter: [['list'], ['json', { outputFile: process.env.LAB_BROWSER_JSON }]],
  webServer: base.webServer.map((server, index) =>
    index === 0
      ? { ...server, command: 'node e2e/web/support/catalog-freshness-server.mjs' }
      : server
  ),
  use: { ...base.use, video: 'off', trace: 'retain-on-failure' },
});
