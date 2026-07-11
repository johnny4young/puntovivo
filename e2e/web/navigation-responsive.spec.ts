import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  expectNoClientIssues,
  loginAs,
} from './support/app';

const RESPONSIVE_VIEWPORTS = [
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

test.describe('responsive workspace navigation (ENG-131d)', () => {
  for (const viewport of RESPONSIVE_VIEWPORTS) {
    test(`admin chooses one workspace at a time on ${viewport.name}`, async ({ page }) => {
      const tracker = attachClientIssueTracker(page);
      await page.setViewportSize(viewport);
      await loginAs(page, 'admin');

      const opener = page.getByRole('button', { name: /open navigation/i });
      await opener.click();

      const dialog = page.getByRole('dialog', {
        name: 'Mobile workspace navigation',
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('radiogroup', { name: 'Choose a workspace' })).toBeVisible();
      await expect(dialog.getByRole('radio', { name: 'Sell' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await expect(dialog.getByRole('link', { name: 'Sales' })).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'Products' })).toHaveCount(0);

      await dialog.getByRole('radio', { name: 'Catalog' }).click();
      await expect(dialog.getByRole('radio', { name: 'Catalog' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await expect(dialog.getByRole('link', { name: 'Products' })).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'Sales' })).toHaveCount(0);

      await dialog.getByRole('link', { name: 'Products' }).click();
      await expect(page).toHaveURL(/\/products$/);
      await expect(page.getByRole('dialog', { name: 'Mobile workspace navigation' })).toHaveCount(0);

      await opener.click();
      await expect(page.getByRole('radio', { name: 'Catalog' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await page.getByRole('link', { name: 'Open Catalog overview' }).click();
      await expect(page).toHaveURL(/\/catalog$/);

      await opener.click();
      await expect(page.getByRole('radio', { name: 'Catalog' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Mobile workspace navigation' })).toHaveCount(0);
      await expect(opener).toBeFocused();

      await expect(
        page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
      ).resolves.toBe(true);
      await expectNoClientIssues(tracker);
    });
  }

  test('cashier gets the single Sell workspace on mobile', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'cashier');

    await page.getByRole('button', { name: /open navigation/i }).click();
    const dialog = page.getByRole('dialog', {
      name: 'Mobile workspace navigation',
    });

    await expect(dialog.getByRole('radiogroup')).toHaveCount(0);
    await expect(dialog.getByRole('region', { name: 'Sell routes' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Sales' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
    await expect(dialog.getByText('Catalog', { exact: true })).toHaveCount(0);
    await expectNoClientIssues(tracker);
  });
});
