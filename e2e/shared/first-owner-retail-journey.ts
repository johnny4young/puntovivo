import { expect, type Page } from '@playwright/test';

/** Same operator path in real web and sandboxed Electron; navigation is target-specific. */
interface FirstOwnerRetailJourney {
  page: Page;
  language: 'en' | 'es';
  goTo: (route: string) => Promise<void>;
  setupToken?: string;
  screenshot: (name: string) => Promise<void>;
}

/** No seed, direct mutation or SQL shortcut: all business state starts with the owner UI. */
export async function runFirstOwnerRetailJourney({
  page,
  language,
  goTo,
  setupToken,
  screenshot,
}: FirstOwnerRetailJourney): Promise<void> {
  const copy = (en: string, es: string) => (language === 'es' ? es : en);
  // Let the initial health/CSRF bootstrap finish before deliberately reloading
  // for a locale change; an aborted first boot is a different recovery scenario.
  await expect(page.locator('#setup-businessName')).toBeVisible();
  await page.evaluate(
    locale => localStorage.setItem('puntovivo-language-preference', locale),
    language
  );
  await page.reload();
  await expect(page.locator('#setup-businessName')).toBeVisible();
  await page.locator('#setup-businessName').fill('Owner-operated Retail');
  await page.locator('#setup-siteName').fill('Owner Store');
  await page.locator('#setup-countryCode').selectOption('CO');
  await page.locator('#setup-presetId').selectOption('retail');
  await page.getByRole('button', { name: copy('Continue', 'Continuar'), exact: true }).click();
  await page.locator('#setup-ownerName').fill('Retail Owner');
  await page.locator('#setup-email').fill('retail-owner@example.com');
  await page.locator('#setup-password').fill('OwnerPassword42!');
  await page.locator('#setup-confirmPassword').fill('OwnerPassword42!');
  if (setupToken) await page.locator('#setup-token').fill(setupToken);
  else await expect(page.locator('#setup-token')).toHaveCount(0);
  await page
    .getByRole('button', {
      name: copy('Create my workspace', 'Crear mi espacio de trabajo'),
      exact: true,
    })
    .click();
  await expect(page.getByRole('button', { name: /Retail Owner/ })).toBeVisible({ timeout: 30_000 });

  // Synthetic legal/contact details are explicit operator input, not an
  // invented seed or a claim of fiscal-provider registration/certification.
  await goTo('/company?tab=general');
  await expect(page.locator('#company-name')).toHaveValue('Owner-operated Retail');
  await page.locator('#company-tax-id').fill('900123456-7');
  await page.locator('#company-address').fill('Synthetic test shop, Bogota');
  const companyForm = page.locator('form').filter({ has: page.locator('#company-name') });
  await companyForm.getByRole('button', { name: /save|guardar/i }).click();
  await expect(
    page
      .getByRole('status')
      .getByText(copy('Company settings saved', 'Configuración de empresa guardada'), {
        exact: true,
      })
  ).toBeVisible();
  await page.reload();
  await expect(page.locator('#company-tax-id')).toHaveValue('900123456-7');

  await goTo('/vat-rates');
  await page
    .getByRole('button', { name: copy('Add VAT Rate', 'Agregar tarifa de IVA'), exact: true })
    .click();
  const taxDialog = page.getByRole('dialog', {
    name: copy('Create VAT Rate', 'Crear tarifa de IVA'),
    exact: true,
  });
  await taxDialog.locator('#vat-rate-name').fill('Owner IVA 19%');
  await taxDialog.locator('#vat-rate-value').fill('19');
  await taxDialog.locator('#vat-rate-kind').selectOption('iva');
  await taxDialog
    .getByRole('button', { name: copy('Create VAT Rate', 'Crear tarifa de IVA'), exact: true })
    .click();
  await expect(taxDialog).toBeHidden();

  await goTo('/sequentials');
  for (const [documentType, prefix] of [
    ['sale', 'OWN-'],
    ['purchase', 'BUY-'],
    ['order', 'ORD-'],
    ['quotation', 'QUO-'],
  ]) {
    await page
      .getByRole('button', {
        name: copy('Configure numbering', 'Configurar numeración'),
        exact: true,
      })
      .click();
    const sequence = page.getByRole('dialog', {
      name: copy('Configure numbering', 'Configurar numeración'),
      exact: true,
    });
    await sequence.locator('#sequential-site').selectOption({ label: 'Owner Store' });
    await sequence.locator('#sequential-document-type').selectOption(documentType!);
    await sequence.locator('#sequential-prefix').fill(prefix!);
    await sequence
      .getByRole('button', { name: copy('Create sequence', 'Crear consecutivo'), exact: true })
      .click();
    await expect(sequence).toBeHidden();
    if (documentType === 'sale') {
      // Purchase/order/quotation setup is still pending, but the global
      // overview must not misrepresent it as a prohibition on every sale.
      await expect(
        page.getByText(
          copy(
            'Business setup: 2 required items still need attention.',
            'Configuración del negocio: quedan 2 requisitos pendientes.'
          ),
          { exact: true }
        )
      ).toBeVisible();
    }
  }

  await goTo('/data-import');
  await page
    .getByRole('radio', {
      name: copy(/Real business data/.source, /Datos reales del negocio/.source),
      exact: false,
    })
    .click();
  await page.locator('#data-import-file').setInputFiles({
    name: 'owner-products.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(
      'Name,SKU,Price,Cost,Opening stock,Minimum stock,Tax rate\nOwner Notebook,OWNER-NOTEBOOK,11900,6000,5,1,19'
    ),
  });
  await page
    .getByRole('button', {
      name: copy('Validate and preview', 'Validar y previsualizar'),
      exact: true,
    })
    .click();
  await expect(page.getByTestId('data-import-summary-ready')).toContainText('1');
  await expect(page.getByTestId('data-import-summary-invalid')).toContainText('0');
  await page
    .getByLabel(
      copy(
        'I confirm that this file contains real business data',
        'Confirmo que este archivo contiene datos reales del negocio'
      ),
      { exact: false }
    )
    .check();
  await page.getByRole('button', { name: /^(Import 1 ready row|Importar 1 fila lista)$/ }).click();
  await expect(page.getByTestId('data-import-report-stockInitialized')).toContainText('1');
  await screenshot('import-complete');

  await goTo('/sales');
  await expect(
    page.getByText(copy('Business setup:', 'Configuración del negocio:'), { exact: false })
  ).toBeHidden();
  await page
    .getByRole('button', { name: /^(Open cash session|Abrir caja)$/i })
    .first()
    .click();
  const cash = page.getByRole('dialog', { name: /^(Open cash session|Abrir caja)$/i });
  await cash.locator('#cash-session-register').fill('Owner Register');
  await cash.locator('#cash-session-opening-float').fill('0');
  await cash.getByRole('button', { name: /^(Open session|Abrir caja)$/i }).click();
  await expect(cash).toBeHidden();
  const search = page.locator('#sales-product-search-input');
  await search.fill('OWNER-NOTEBOOK');
  await search.press('Enter');
  const products = page.getByRole('dialog', { name: /^(Add product|Agregar producto)$/i });
  await products.getByTestId('product-search-row-OWNER-NOTEBOOK').click();
  await products.getByRole('button', { name: /^(Add to cart|Agregar al carrito)$/i }).click();
  await expect(page.getByTestId('sale-cart-item-OWNER-NOTEBOOK')).toBeVisible();
  await page
    .getByRole('button', { name: /^(Charge sale|Cobrar venta)$/i })
    .first()
    .click();
  const payment = page.getByTestId('sale-payment-drawer');
  await expect(payment).toBeVisible();
  await payment.locator('#sale-payment-confirm').click();
  await expect(payment).toBeHidden({ timeout: 15_000 });
  await page.reload();
  // The last-sale shortcut is session-local. History is the durable operator
  // surface after a reload and must resolve the exact persisted ticket.
  await page.getByTestId('sales-open-history').click();
  const history = page.getByTestId('sales-history-drawer');
  await history.getByPlaceholder(/Search by invoice|Buscar por factura/i).fill('OWN-000001');
  await history
    .getByRole('button', { name: copy('View OWN-000001', 'Ver OWN-000001'), exact: true })
    .click();
  const receipt = page.getByRole('dialog', { name: /OWN-000001/ });
  await expect(receipt).toContainText('Owner Notebook');
  const soldRow = receipt.getByRole('row').filter({ hasText: 'OWNER-NOTEBOOK' });
  await expect(soldRow.getByRole('cell').nth(3)).toHaveText(/\$\s*1[.,]900/);
  await expect(soldRow.getByRole('cell').nth(4)).toHaveText(/\$\s*11[.,]900/);
  await screenshot('first-sale-reloaded');
  await receipt
    .getByRole('button', { name: /^(Close|Cerrar)$/i })
    .first()
    .click();
  await history.getByRole('button', { name: /^(Close modal|Cerrar modal)$/i }).click();
  await expect(history).toBeHidden();

  await page
    .getByRole('button', { name: /^(Close cash session|Cerrar caja)$/i })
    .first()
    .click();
  const close = page.getByRole('dialog', { name: /^(Close cash session|Cerrar caja)$/i });
  await close.locator('#cash-session-closing-count').fill('11900');
  for (const [index, quantity] of [
    [3, 1],
    [6, 1],
    [7, 1],
    [8, 2],
  ]) {
    await close.locator(`#cash-session-close-count-${index}`).fill(String(quantity));
  }
  await close.getByRole('button', { name: /^(Close session|Cerrar caja)$/i }).click();
  await expect(close).toBeHidden();
  const dayClose = page.getByRole('dialog', { name: /^(Day closed|Día cerrado)$/i });
  await expect(dayClose.getByTestId('day-close-summary')).toBeVisible();
  await dayClose.getByRole('button', { name: /^(Done|Terminar)$/i }).click();
  await goTo('/inventory');
  await page.getByRole('button', { name: /^(Stock Query|Consulta de stock)$/i }).click();
  await page
    .getByPlaceholder(/Search stock by product|Buscar stock por producto/i)
    .fill('Owner Notebook');
  const stock = page.locator('tr').filter({ hasText: 'Owner Notebook' });
  await expect(stock).toBeVisible();
  await expect(stock.getByText('4', { exact: true })).toBeVisible();
  await screenshot('stock-reconciled');
  await page.reload();
  await page.getByRole('button', { name: /^(Stock Query|Consulta de stock)$/i }).click();
  await expect(stock.getByText('4', { exact: true })).toBeVisible();
}
