import { expect, test, type Page } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { runAxeOnPage } from './support/a11y';
import { getProviderPayableTotals } from './support/db';
import {
  readPickerInvoiceEvidence,
  seedProviderPurchasePickerScenario,
} from './support/provider-purchase-picker-fixture';

const copy = {
  en: {
    providerSearch: 'Search providers...',
    open: 'Open account for',
    title: 'Supplier account',
    invoice: 'Register invoice',
    purchase: 'Completed purchase',
    amount: 'Amount',
    search: 'Search by purchase number',
    next: 'Next page',
    previous: 'Previous page',
    document: 'Supplier document number',
    save: 'Save invoice',
    empty: 'No uninvoiced purchases match this search.',
    one: '1 available purchase',
    range: (start: number, end: number) => `Showing ${start}-${end} of 101`,
  },
  es: {
    providerSearch: 'Buscar proveedores...',
    open: 'Abrir la cuenta de',
    title: 'Cuenta del proveedor',
    invoice: 'Registrar factura',
    purchase: 'Compra completada',
    amount: 'Monto',
    search: 'Buscar por número de compra',
    next: 'Página siguiente',
    previous: 'Página anterior',
    document: 'Número del documento del proveedor',
    save: 'Guardar factura',
    empty: 'No hay compras sin facturar que coincidan con la búsqueda.',
    one: '1 compra disponible',
    range: (start: number, end: number) => `Mostrando ${start}-${end} de 101`,
  },
} as const;

async function openAccount(page: Page, name: string, language: keyof typeof copy) {
  const labels = copy[language];
  await page.goto('/provider-payables');
  await page.getByPlaceholder(labels.providerSearch).fill(name);
  const row = page.locator('tr', { hasText: name }).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `${labels.open} ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `${labels.title} · ${name}` });
  await expect(dialog.getByTestId('provider-payables-overview')).toBeVisible();
  return dialog;
}

for (const language of ['en', 'es'] as const) {
  test(`manager links the 101st uninvoiced purchase without invoicing newer documents (${language})`, async ({
    page,
  }, info) => {
    const labels = copy[language];
    const tracker = attachClientIssueTracker(page);
    const scenario = seedProviderPurchasePickerScenario(
      `picker-${language}-${info.parallelIndex}-${Date.now()}`
    );
    await login(
      page,
      { ...scenario.manager, defaultPath: '/dashboard' },
      { spanish: language === 'es' }
    );
    let dialog = await openAccount(page, scenario.provider.name, language);
    await dialog.getByRole('button', { name: labels.invoice, exact: true }).click();
    await expect(dialog.getByText(labels.range(1, 25), { exact: true })).toBeVisible();
    await expect(dialog.locator(`option[value="${scenario.purchase.id}"]`)).toHaveCount(0);
    for (let pageNumber = 2; pageNumber <= 5; pageNumber += 1) {
      await dialog.getByRole('button', { name: labels.next, exact: true }).click();
      await expect(
        dialog.getByText(labels.range((pageNumber - 1) * 25 + 1, Math.min(pageNumber * 25, 101)), {
          exact: true,
        })
      ).toBeVisible();
    }
    await dialog
      .getByRole('combobox', { name: labels.purchase, exact: true })
      .selectOption(scenario.purchase.id);
    await expect(dialog.getByLabel(labels.amount, { exact: true })).toHaveValue(
      String(scenario.purchase.total)
    );
    await dialog.getByRole('button', { name: labels.previous, exact: true }).click();
    await expect(dialog.getByText(labels.range(76, 100), { exact: true })).toBeVisible();
    await expect(dialog.getByRole('combobox', { name: labels.purchase, exact: true })).toHaveValue(
      scenario.purchase.id
    );

    // A fresh server search, not merely the retained selected option, must
    // locate the formerly omitted purchase with one eligible result.
    const searched = page.waitForResponse(
      response =>
        response.url().includes('providerPayables.availablePurchases') &&
        decodeURIComponent(response.url()).includes(scenario.purchase.purchaseNumber) &&
        response.status() === 200
    );
    await dialog.getByLabel(labels.search, { exact: true }).fill(scenario.purchase.purchaseNumber);
    await searched;
    await expect(dialog.getByText(labels.one, { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: labels.next, exact: true })).toHaveCount(0);
    await expect(dialog.getByRole('combobox', { name: labels.purchase, exact: true })).toHaveValue(
      scenario.purchase.id
    );
    await expect(dialog.getByLabel(labels.amount, { exact: true })).toHaveValue(
      String(scenario.purchase.total)
    );
    await runAxeOnPage(page);
    const screenshot = info.outputPath(`provider-purchase-picker-${language}.png`);
    await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled' });
    await info.attach(`provider-purchase-picker-${language}`, {
      path: screenshot,
      contentType: 'image/png',
    });
    const documentNumber = `FAC-PICKER-${language}-${Date.now()}`;
    await dialog.getByLabel(labels.document, { exact: true }).fill(documentNumber);
    await dialog.getByRole('button', { name: labels.save, exact: true }).click();
    await expect(dialog.getByTestId('provider-payable-form')).toHaveCount(0);
    const expectedInvoice = {
      purchaseId: scenario.purchase.id,
      siteId: scenario.sites[0]!.id,
      documentNumber,
      amount: scenario.purchase.total,
    };
    await expect
      .poll(() =>
        readPickerInvoiceEvidence(scenario.tenantId, scenario.provider.id, scenario.purchase.id)
      )
      .toEqual([expect.objectContaining(expectedInvoice)]);
    expect(getProviderPayableTotals(scenario.provider.id)).toMatchObject({
      invoices: scenario.purchase.total,
      balance: scenario.purchase.total,
    });

    await page.reload();
    dialog = await openAccount(page, scenario.provider.name, language);
    await expect(dialog.getByText(documentNumber, { exact: true }).first()).toBeVisible();
    await dialog.getByRole('button', { name: labels.invoice, exact: true }).click();
    await dialog.getByLabel(labels.search, { exact: true }).fill(scenario.purchase.purchaseNumber);
    await expect(dialog.getByText(labels.empty, { exact: true })).toBeVisible();
    await expect(dialog.locator(`option[value="${scenario.purchase.id}"]`)).toHaveCount(0);
    await expectNoClientIssues(tracker);
  });
}
