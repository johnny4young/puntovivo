import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  login,
} from './support/app';
import { seedVerticalReadinessScenario } from './support/db';

async function captureEvidence(page: import('@playwright/test').Page): Promise<void> {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    path: path.join(auditDir, 'vertical-readiness-pharmacy-en.png'),
    fullPage: true,
  });
}

test.describe('vertical readiness', () => {
  test('renders tenant evidence and deep-links pharmacy recovery without blocking checkout', async ({
    page,
  }, testInfo) => {
    const scenario = seedVerticalReadinessScenario(
      `vertical-readiness-${testInfo.parallelIndex}-${Date.now()}`
    );
    const tracker = attachClientIssueTracker(page);
    await login(page, {
      email: scenario.admin.email,
      password: scenario.admin.password,
      defaultPath: '/company',
    });
    await ensureLanguage(page, 'en');
    await page.goto('/company?tab=readiness');

    const card = page.getByTestId('vertical-readiness-card');
    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card.getByText('Pharmacy operating checklist')).toBeVisible();
    await expect(card.getByTestId('vertical-readiness-catalog')).toContainText('Ready');
    await expect(card.getByTestId('vertical-readiness-lotTracking')).toContainText('Ready');
    await expect(card.getByTestId('vertical-readiness-pharmacyPolicy')).toContainText('Review');
    await expect(card.getByTestId('vertical-readiness-customerDisplay')).toContainText('Optional');
    await expect(card).toContainText('They do not certify legal compliance');
    await captureEvidence(page);

    await card.getByTestId('vertical-readiness-action-pharmacyPolicy').click();
    await expect(page).toHaveURL(/\/inventory\?view=pharmacy$/);
    await expect(page.getByRole('heading', { name: 'Pharmacy safety operations' })).toBeVisible({
      timeout: 15_000,
    });
    await expectNoClientIssues(tracker);
  });
});
