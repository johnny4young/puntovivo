import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { seedSaleScenario } from './support/db';

test('states the page title once while keeping the heading for assistive tech', async ({
  page,
}, testInfo) => {
  const tracker = attachClientIssueTracker(page);
  const scenario = seedSaleScenario(`shell-title-${testInfo.parallelIndex}-${Date.now()}`);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, { ...scenario.admin, defaultPath: '/dashboard' });
  await page.goto('/products');

  const heading = page.getByRole('main').getByRole('heading', { level: 1, name: 'Products' });
  await expect(heading).toBeAttached();
  const box = await heading.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(1);
  await expect(page.getByTestId('header-page-heading').getByRole('heading')).toHaveText('Products');

  await expectNoClientIssues(tracker);
});
