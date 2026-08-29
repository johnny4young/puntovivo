import { expect, test } from '@playwright/test';

import { attachClientIssueTracker, expectNoClientIssues, loginAs } from './support/app';

test.describe('keyboard shortcut contract', () => {
  test('manager navigation and shortcut sheet stay scoped, visible, and accessible', async ({
    page,
  }, testInfo) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'manager');

    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('sidebar-primary-task-today')).toHaveAttribute(
      'aria-keyshortcuts',
      'Alt+1'
    );

    await page.keyboard.press('Alt+2');
    await expect(page).toHaveURL(/\/sales$/);

    const search = page.locator('#sales-product-search-input');
    await expect(search).toBeVisible();
    await expect(search).toHaveAttribute('aria-keyshortcuts', 'Alt+P');

    // Editable fields own the keyboard. The global sheet must not stack while
    // the cashier is typing, but it becomes available immediately after blur.
    await search.focus();
    await page.keyboard.press('Alt+/');
    await expect(page.getByTestId('shortcuts-sheet')).toHaveCount(0);
    await search.evaluate(element => (element as HTMLElement).blur());

    await page.keyboard.press('Alt+/');
    const sheet = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByText('Go to dashboard', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Go to purchases', { exact: true })).toBeVisible();
    await expect(sheet.getByText('Charge', { exact: true })).toBeVisible();
    await sheet.screenshot({ path: testInfo.outputPath('shortcuts-sheet.png') });

    await page.keyboard.press('Alt+/');
    await expect(sheet).toBeHidden();
    await expectNoClientIssues(tracker);
  });
});
