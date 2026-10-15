import { expect, test } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login, resetSession } from './support/app';
import { seedReceiptPrintingScenario } from './support/db';
import { addProductToCartViaKeyboard } from './support/sales-keyboard';

for (const spanish of [false, true]) {
  test(`system auto-print opens an isolated complete receipt in ${spanish ? 'es' : 'en'}`, async ({
    page,
    context,
  }, testInfo) => {
    const scenario = seedReceiptPrintingScenario(`print-${testInfo.parallelIndex}-${Date.now()}`);
    const tracker = attachClientIssueTracker(page);
    // The real receipt window and HTML load normally; the final browser print
    // actuator is replaced so this regression never submits a physical job.
    await context.addInitScript(
      language => {
        window.localStorage.setItem('puntovivo-language-preference', language);
        window.print = () => {
          document.documentElement.dataset.syntheticPrintRequested = 'true';
        };
      },
      spanish ? 'es' : 'en'
    );
    await login(page, { ...scenario.admin, defaultPath: '/company' }, { spanish });
    await page.goto('/peripherals');
    await page
      .getByRole('button', { name: /add device|agregar dispositivo/i })
      .first()
      .click();
    const config = page.getByRole('dialog');
    await config.locator('#peripheral-display-name').fill('SYNTHETIC SYSTEM PRINTER');
    await config.locator('#peripheral-auto-print').check();
    await config.getByRole('button', { name: /^(save|guardar)$/i }).click();
    await expect(config).toBeHidden();
    await page.getByRole('button', { name: /^(edit|editar)$/i }).click();
    await expect(config.locator('#peripheral-auto-print')).toBeChecked();
    await config.getByRole('button', { name: /^(cancel|cancelar)$/i }).click();
    await resetSession(page);
    await login(page, { ...scenario.cashier, defaultPath: '/sales' }, { spanish });
    await addProductToCartViaKeyboard(page, scenario.product.sku);
    await page.keyboard.press('F2');
    const payment = page.getByRole('dialog', { name: /charge sale|cobrar venta/i });
    await expect(payment).toBeVisible();
    const receiptOpened = page.waitForEvent('popup');
    await payment.locator('#sale-payment-confirm').click();
    const receipt = await receiptOpened;
    await expect(receipt).toHaveURL(/^blob:/);
    await expect(receipt.locator('html')).toHaveAttribute('data-synthetic-print-requested', 'true');
    expect(await receipt.evaluate(() => window.opener === null)).toBe(true);
    await expect(receipt.locator('body')).toContainText(scenario.product.name);
    await receipt.emulateMedia({ media: 'print' });
    expect(
      await receipt.locator('body').evaluate(body => body.getBoundingClientRect().width)
    ).toBeLessThanOrEqual(182);
    await receipt.close();
    await expect(payment).toBeHidden();
    await expect(page.locator('body')).not.toContainText('Unable to open the print window');
    await expectNoClientIssues(tracker);
  });
}

for (const spanish of [false, true]) {
  for (const retryQueued of [true, false]) {
    test(`ESC/POS failure keeps one print surface (queued=${retryQueued}, ${spanish ? 'es' : 'en'})`, async ({
      page,
      context,
    }, testInfo) => {
      const scenario = seedReceiptPrintingScenario(
        `failure-${testInfo.parallelIndex}-${Date.now()}`
      );
      const tracker = attachClientIssueTracker(page);
      await context.addInitScript(
        language => {
          window.localStorage.setItem('puntovivo-language-preference', language);
          window.print = () => {
            throw new Error('Unexpected HTML print after ESC/POS failure');
          };
        },
        spanish ? 'es' : 'en'
      );
      await login(page, { ...scenario.admin, defaultPath: '/company' }, { spanish });
      await page.goto('/peripherals');
      await page
        .getByRole('button', { name: /add device|agregar dispositivo/i })
        .first()
        .click();
      const config = page.getByRole('dialog');
      await config.locator('#peripheral-driver').selectOption('escpos');
      // Mock transport only. Failure response below is synthetic; the real
      // durable enqueue + retry is exercised by the server integration test.
      await config
        .locator('#peripheral-config')
        .fill(JSON.stringify({ channel: 'mock', autoPrintOnComplete: true, paperWidth: '58mm' }));
      await config.getByRole('button', { name: /^(save|guardar)$/i }).click();
      await expect(config).toBeHidden();
      await resetSession(page);
      await login(page, { ...scenario.cashier, defaultPath: '/sales' }, { spanish });
      let dispatches = 0;
      let htmlRequests = 0;
      const popups: string[] = [];
      page.on('popup', popup => {
        popups.push(popup.url());
      });
      await page.route('**/api/trpc/**', async route => {
        const methods =
          decodeURIComponent(new URL(route.request().url()).pathname)
            .split('/')
            .pop()
            ?.split(',') ?? [];
        if (methods.includes('peripherals.renderReceiptHtml')) htmlRequests++;
        if (!methods.includes('peripherals.printReceipt')) return route.continue();
        dispatches++;
        expect(methods).toEqual(['peripherals.printReceipt']);
        await route.fulfill({
          json: [
            { result: { data: { status: 'fallback', error: 'DEVICE_OFFLINE', retryQueued } } },
          ],
        });
      });
      await addProductToCartViaKeyboard(page, scenario.product.sku);
      await page.keyboard.press('F2');
      const payment = page.getByRole('dialog', { name: /charge sale|cobrar venta/i });
      await payment.locator('#sale-payment-confirm').click();
      const warning = retryQueued
        ? spanish
          ? 'La impresión ESC/POS quedó en cola y se reintentará automáticamente. No imprimas otra copia.'
          : 'ESC/POS printing is queued and will retry automatically. Do not print another copy.'
        : spanish
          ? 'No se pudo confirmar la impresión ESC/POS. Revisa la impresora y la cola antes de reimprimir.'
          : 'ESC/POS printing could not be confirmed. Check the printer and queue before reprinting.';
      await expect(page.getByText(warning, { exact: true })).toBeVisible();
      await expect(payment).toBeHidden();
      await expect(page.getByRole('status').filter({ hasText: warning })).toHaveCSS('opacity', '1');
      expect(dispatches).toBe(1);
      expect(htmlRequests).toBe(0);
      expect(popups).toEqual([]);
      await page.screenshot({ path: testInfo.outputPath('escpos-warning.png') });
      await expectNoClientIssues(tracker);
    });
  }
}
