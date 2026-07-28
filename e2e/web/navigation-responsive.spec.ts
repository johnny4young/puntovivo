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

test.describe('responsive workspace navigation', () => {
  for (const viewport of RESPONSIVE_VIEWPORTS) {
    test(`admin chooses one workspace at a time on ${viewport.name}`, async ({ page }) => {
      const tracker = attachClientIssueTracker(page);
      await page.setViewportSize(viewport);
      await loginAs(page, 'admin');

      const opener = page.getByRole('button', { name: /open navigation/i });
      await opener.click();

      const dialog = page.getByRole('dialog', {
        name: 'Task and tools navigation',
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'See what matters today' })).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'Make a sale' })).toBeVisible();
      const moreTools = dialog.getByRole('button', { name: /More tools/ });
      await expect(moreTools).toHaveAttribute('aria-expanded', 'false');
      await moreTools.click();
      await expect(
        dialog.getByRole('radiogroup', { name: 'Choose a group of tools' })
      ).toBeVisible();
      await expect(dialog.getByRole('radio', { name: 'Today and close' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await expect(dialog.getByRole('link', { name: 'Today', exact: true })).toBeVisible();
      await expect(dialog.getByRole('link', { name: 'System support' })).toBeVisible();
      await captureEvidence(page, `eng-131e-navigation-${viewport.name}-en`);

      await dialog.getByRole('radio', { name: 'Products' }).click();
      await expect(dialog.getByRole('radio', { name: 'Products' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await expect(dialog.getByRole('link', { name: 'Products', exact: true })).toBeVisible();

      await dialog.getByRole('link', { name: 'Products', exact: true }).click();
      await expect(page).toHaveURL(/\/products$/);
      await expect(page.getByRole('dialog', { name: 'Task and tools navigation' })).toHaveCount(0);

      await opener.click();
      const reopenedDialog = page.getByRole('dialog', { name: 'Task and tools navigation' });
      await reopenedDialog.getByRole('button', { name: /More tools/ }).click();
      await expect(reopenedDialog.getByRole('radio', { name: 'Products' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await reopenedDialog.getByRole('link', { name: 'Open Products overview' }).click();
      await expect(page).toHaveURL(/\/catalog$/);

      await opener.click();
      const catalogDialog = page.getByRole('dialog', { name: 'Task and tools navigation' });
      await expect(catalogDialog.getByRole('radio', { name: 'Products' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Task and tools navigation' })).toHaveCount(0);
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
      name: 'Task and tools navigation',
    });

    await expect(dialog.getByRole('link', { name: 'Make a sale' })).toBeVisible();
    await dialog.getByRole('button', { name: /More tools/ }).click();
    await expect(dialog.getByRole('radiogroup')).toHaveCount(0);
    await expect(dialog.getByRole('region', { name: 'Sell tools' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Sales' })).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'See what matters today' })).toHaveCount(0);
    await expect(dialog.getByText('Products', { exact: true })).toHaveCount(0);
    await expectNoClientIssues(tracker);
  });

  test('admin sees frequent tasks before advanced tools on Spanish desktop', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginAs(page, 'admin', { spanish: true });

    await expect(page.getByTestId('sidebar-primary-task-today')).toContainText(
      'Ver lo importante de hoy'
    );
    await expect(page.getByTestId('sidebar-primary-task-sell')).toContainText('Hacer una venta');
    const moreTools = page.getByTestId('sidebar-more-tools-toggle');
    await expect(moreTools).toHaveAttribute('aria-expanded', 'false');
    await moreTools.click();
    const operate = page.getByTestId('sidebar-workspace-operate');
    await expect(operate).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByTestId('sidebar-workspace-link-operate')).toContainText('Hoy y cierres');
    await expect(page.getByRole('link', { name: 'Hoy', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Soporte del sistema' })).toBeVisible();
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
