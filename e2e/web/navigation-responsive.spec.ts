import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, loginAs } from './support/app';

async function captureEvidence(page: import('@playwright/test').Page, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await page.screenshot({
    animations: 'disabled',
    path: path.join(auditDir, `${name}.png`),
  });
}

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
      await expect(dialog.getByRole('radio', { name: 'Operate' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await expect(dialog.getByRole('link', { name: 'Dashboard' })).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'Operations' })).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'Products' })).toHaveCount(0);
      await captureEvidence(page, `eng-131e-navigation-${viewport.name}-en`);

      await dialog.getByRole('radio', { name: 'Catalog' }).click();
      await expect(dialog.getByRole('radio', { name: 'Catalog' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await expect(dialog.getByRole('link', { name: 'Products' })).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'Sales' })).toHaveCount(0);

      await dialog.getByRole('link', { name: 'Products' }).click();
      await expect(page).toHaveURL(/\/products$/);
      await expect(page.getByRole('dialog', { name: 'Mobile workspace navigation' })).toHaveCount(
        0
      );

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
      await expect(page.getByRole('dialog', { name: 'Mobile workspace navigation' })).toHaveCount(
        0
      );
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

  test('admin sees Dashboard folded into Operate on Spanish desktop', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'admin', { spanish: true });

    const operate = page.getByTestId('sidebar-workspace-operate');
    await expect(operate).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('sidebar-workspace-link-operate')).toContainText('Operar');
    await expect(page.getByRole('link', { name: 'Panel' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Operaciones' })).toBeVisible();
    await captureEvidence(page, 'eng-131e-navigation-desktop-es');
    await expectNoClientIssues(tracker);
  });

  test('keeps existing child URLs canonical instead of redirecting them', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'admin');

    await page.goto('/products');
    await expect(page).toHaveURL(/\/products$/);
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Products', exact: true })
    ).toBeVisible();

    await page.goto('/orders');
    await expect(page).toHaveURL(/\/orders$/);
    await expect(
      page.getByRole('main').getByRole('heading', { name: 'Purchase Orders', exact: true })
    ).toBeVisible();
    await expectNoClientIssues(tracker);
  });
});
