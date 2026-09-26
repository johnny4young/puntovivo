import { defineConfig } from '@playwright/test';
import webConfig from './playwright.web.config.js';

// Keep the parallel lane's report and failure artefacts when the complete
// command runs its heavy lane in a second Playwright process.
export default defineConfig(webConfig, {
  outputDir: 'test-results/playwright-web-heavy',
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/web-heavy' }]],
});
