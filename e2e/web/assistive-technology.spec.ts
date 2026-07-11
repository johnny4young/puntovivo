import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login, loginAs } from './support/app';
import { seedSaleScenario } from './support/db';
import { addProductToCartViaKeyboard, expectSearchInputFocused } from './support/sales-keyboard';

const MOBILE_VIEWPORT = { width: 390, height: 844 };

async function captureAuditEvidence(page: Page, target: Locator, name: string) {
  const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
  if (!auditDir) return;
  await mkdir(auditDir, { recursive: true });
  await writeFile(path.join(auditDir, `${name}.aria.yml`), await target.ariaSnapshot());
  await page.screenshot({ path: path.join(auditDir, `${name}.png`) });
}

async function hasIsolatedAncestor(locator: Locator): Promise<boolean> {
  return locator.evaluate(element => {
    let current: HTMLElement | null = element as HTMLElement;
    while (current && current !== document.body) {
      if (current.inert && current.getAttribute('aria-hidden') === 'true') return true;
      current = current.parentElement;
    }
    return false;
  });
}

test.describe('assistive-technology sweep (ENG-134h)', () => {
  test('admin mobile workspace dialog isolates the page and exposes one labelled model', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize(MOBILE_VIEWPORT);
    await loginAs(page, 'admin', { spanish: true });
    await page.goto('/company?tab=readiness');

    const opener = page.getByRole('button', { name: 'Abrir navegación' });
    await opener.click();
    const dialog = page.getByRole('dialog', {
      name: 'Navegación móvil por espacios de trabajo',
    });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole('radiogroup', { name: 'Elige un espacio de trabajo' })
    ).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Configuración' })).toBeChecked();
    const main = page.locator('main');
    expect(await hasIsolatedAncestor(main)).toBe(true);
    await expect
      .poll(() => dialog.evaluate(element => element.contains(document.activeElement)))
      .toBe(true);

    const sell = dialog.getByRole('radio', { name: 'Vender' });
    await sell.focus();
    await sell.press('ArrowRight');
    await expect(dialog.getByRole('radio', { name: 'Operar' })).toBeChecked();

    await captureAuditEvidence(page, dialog, 'admin-mobile-workspace-dialog-es');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    expect(await hasIsolatedAncestor(main)).toBe(false);
    await expectNoClientIssues(tracker);
  });

  test('cashier payment drawer exposes concise live regions and matching mobile focus order', async ({
    page,
  }, testInfo: TestInfo) => {
    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize(MOBILE_VIEWPORT);
    const scenario = seedSaleScenario(`assistive-payment-${testInfo.parallelIndex}-${Date.now()}`);
    await login(page, {
      email: scenario.cashier.email,
      password: scenario.cashier.password,
      defaultPath: '/sales',
    });
    await addProductToCartViaKeyboard(page, scenario.product.sku);
    await page.keyboard.press('F1');

    const dialog = page.getByRole('dialog', { name: 'Charge Sale' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('status', { name: 'Sale total' })).toContainText('$12,500.00');
    await expect(dialog.getByRole('group', { name: 'Payment method' })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: 'Payment method' })).toHaveCount(0);
    await expect(dialog.getByTestId('sale-payment-method-select')).toBeHidden();
    await expect(page.locator('#root')).toHaveAttribute('aria-hidden', 'true');
    expect(await page.locator('#root').evaluate(element => (element as HTMLElement).inert)).toBe(
      true
    );

    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    const confirm = dialog.getByRole('button', { name: 'Confirm Sale' });
    const [cancelBox, confirmBox] = await Promise.all([
      cancel.boundingBox(),
      confirm.boundingBox(),
    ]);
    expect(cancelBox).not.toBeNull();
    expect(confirmBox).not.toBeNull();
    expect(cancelBox!.y).toBeLessThan(confirmBox!.y);

    await captureAuditEvidence(page, dialog, 'cashier-mobile-payment-drawer-en');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expectSearchInputFocused(page);
    await expect(page.locator('#root')).not.toHaveAttribute('aria-hidden');
    expect(await page.locator('#root').evaluate(element => (element as HTMLElement).inert)).toBe(
      false
    );
    await expectNoClientIssues(tracker);
  });
});
