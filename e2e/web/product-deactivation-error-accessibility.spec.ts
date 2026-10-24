import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { login } from './support/app';
import { seedReceiptPrintingScenario } from './support/db';

for (const language of ['en', 'es'] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test(`deactivation failure announces inside confirmation and preserves keyboard recovery (${language}, ${theme})`, async ({
      page,
      context,
    }, testInfo) => {
      if (theme === 'dark') await page.setViewportSize({ width: 390, height: 844 });
      const scenario = seedReceiptPrintingScenario(
        `deactivation-${testInfo.workerIndex}-${Date.now()}`
      );
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
          ['blob:', 'data:', 'about:'].includes(url.protocol)
          ? route.continue()
          : route.abort('blockedbyclient');
      });
      await context.addInitScript(
        ({ language, theme }) => {
          localStorage.setItem('puntovivo-language-preference', language);
          localStorage.setItem('puntovivo-theme-preference', theme);
        },
        { language, theme }
      );
      await page.emulateMedia({ colorScheme: theme });
      const pageErrors: string[] = [];
      const consoleErrors: { text: string; url: string }[] = [];
      const failedResponses: { url: string; status: number }[] = [];
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('console', msg => {
        if (msg.type() === 'error')
          consoleErrors.push({ text: msg.text(), url: msg.location().url });
      });
      page.on('response', response => {
        if (response.status() >= 400 && !response.url().includes('auth.refresh'))
          failedResponses.push({
            url: response.url(),
            status: response.status(),
          });
      });
      const db = new Database(resolve('packages/server/data/local.db'));
      const snapshot = () => ({
        row: db.prepare('SELECT * FROM products WHERE id = ?').get(scenario.product.id),
        outbox: db
          .prepare('SELECT * FROM sync_outbox WHERE entity_id = ? ORDER BY id')
          .all(scenario.product.id),
      });
      const before = snapshot();
      const id = scenario.product.id.replaceAll("'", "''");
      db.exec(`CREATE TRIGGER lab_reject_product_sync BEFORE INSERT ON sync_outbox
        WHEN NEW.entity_type = 'products' AND NEW.operation = 'update' AND NEW.entity_id = '${id}'
        BEGIN SELECT RAISE(ABORT, 'Synthetic outbox rejection'); END`);
      try {
        await login(
          page,
          { ...scenario.admin, defaultPath: '/dashboard' },
          { spanish: language === 'es' }
        );
        await page.goto('/products');
        expect(await page.locator('html').evaluate(el => el.classList.contains('dark'))).toBe(
          theme === 'dark'
        );
        await page
          .getByPlaceholder(language === 'en' ? 'Search products...' : 'Buscar productos...')
          .fill(scenario.product.sku);
        const row = page.getByRole('row').filter({ hasText: scenario.product.sku });
        const remove = row.getByRole('button', {
          name: language === 'en' ? 'Delete' : 'Eliminar',
          exact: true,
        });
        await remove.focus();
        await page.keyboard.press('Enter');
        const confirmation = page.getByRole('dialog', {
          name: language === 'en' ? 'Deactivate Product' : 'Desactivar producto',
          exact: true,
        });
        await expect(confirmation).toBeVisible();
        const confirm = confirmation.getByRole('button', {
          name: language === 'en' ? 'Deactivate' : 'Desactivar',
          exact: true,
        });
        await confirm.focus();
        await page.keyboard.press('Enter');
        const errorTitle =
          language === 'en' ? 'Unable to deactivate product' : 'No se pudo desactivar el producto';
        const renderedAlert = page.locator('[role="alert"]').filter({ hasText: errorTitle });
        await expect(renderedAlert).toHaveCount(1);
        const alertEvidence = {
          rendered: await renderedAlert.count(),
          accessible: await page.getByRole('alert').filter({ hasText: errorTitle }).count(),
          inertAncestor: await renderedAlert.evaluate(el => el.closest('[inert]')?.id ?? null),
          ariaHiddenAncestor: await renderedAlert.evaluate(
            el => el.closest('[aria-hidden="true"]')?.id ?? null
          ),
        };
        await expect(confirmation).toBeVisible();
        expect(snapshot()).toEqual(before);
        expect(alertEvidence.accessible).toBe(1);
        expect(alertEvidence.inertAncestor).toBeNull();
        expect(alertEvidence.ariaHiddenAncestor).toBeNull();
        expect(await page.locator('#root').getAttribute('aria-hidden')).toBe('true');
        expect(await page.locator('#root').evaluate(el => (el as HTMLElement).inert)).toBe(true);
        await expect(confirm).toBeFocused();
        const alertBounds = await page.getByRole('alert').boundingBox();
        const viewport = page.viewportSize();
        expect(alertBounds).not.toBeNull();
        expect(viewport).not.toBeNull();
        expect(alertBounds!.x).toBeGreaterThanOrEqual(0);
        expect(alertBounds!.y).toBeGreaterThanOrEqual(0);
        expect(alertBounds!.x + alertBounds!.width).toBeLessThanOrEqual(viewport!.width);
        expect(alertBounds!.y + alertBounds!.height).toBeLessThanOrEqual(viewport!.height);
        await testInfo.attach('localized-error-announcement', {
          body: await page.getByRole('alert').ariaSnapshot(),
          contentType: 'text/plain',
        });
        await page.screenshot({
          path: testInfo.outputPath('rejection.png'),
          fullPage: true,
        });
        const dismiss = page.getByRole('alert').getByRole('button', {
          name: language === 'en' ? `Dismiss ${errorTitle}` : `Descartar ${errorTitle}`,
          exact: true,
        });
        const close = confirmation.getByRole('button', {
          name: language === 'en' ? 'Close modal' : 'Cerrar modal',
          exact: true,
        });
        await dismiss.focus();
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(dismiss).toBeFocused();
        await page.keyboard.press('Enter');
        await expect(page.getByRole('alert')).toHaveCount(0);
        expect(await confirmation.evaluate(el => el.contains(document.activeElement))).toBe(true);
        await page.keyboard.press('Tab');
        await expect(close).toBeFocused();
        await confirmation
          .getByRole('button', {
            name: language === 'en' ? 'Cancel' : 'Cancelar',
            exact: true,
          })
          .focus();
        await page.keyboard.press('Enter');
        await expect(confirmation).toBeHidden();
        expect(snapshot()).toEqual(before);
        await expect(remove).toBeFocused();
        expect(await page.locator('#root').getAttribute('aria-hidden')).toBeNull();
        expect(await page.locator('#root').evaluate(el => (el as HTMLElement).inert)).toBe(false);
        db.exec('DROP TRIGGER lab_reject_product_sync');
        await remove.focus();
        await page.keyboard.press('Enter');
        await expect(confirmation).toBeVisible();
        await confirm.focus();
        await page.keyboard.press('Enter');
        await expect(confirmation).toBeHidden();
        await expect(
          page.getByRole('status').filter({
            hasText: language === 'en' ? 'Product deactivated' : 'Producto desactivado',
          })
        ).toHaveCount(1);
        expect(snapshot().row).toMatchObject({ is_active: 0 });
        expect(snapshot().outbox.length).toBe(before.outbox.length + 1);
        await page.reload();
        await expect(
          page.getByPlaceholder(language === 'en' ? 'Search products...' : 'Buscar productos...')
        ).toBeVisible();
        const reopened = new Database(resolve('packages/server/data/local.db'), { readonly: true });
        try {
          expect(
            reopened.prepare('SELECT is_active FROM products WHERE id = ?').get(scenario.product.id)
          ).toEqual({ is_active: 0 });
        } finally {
          reopened.close();
        }
        await testInfo.attach('synthetic-rejection-diagnostics', {
          body: JSON.stringify({ pageErrors, consoleErrors, failedResponses, alertEvidence }),
          contentType: 'application/json',
        });
        expect(failedResponses).toHaveLength(1);
        expect(failedResponses[0].url).toContain('products.delete');
        expect(failedResponses[0].status).toBe(500);
        // A single resource error belongs to the deliberately rejected request;
        // all other errors and all escaped promises remain failures.
        const unexpected = consoleErrors.filter(
          row =>
            !(row.url.includes('products.delete') && row.text.includes('status of 500')) &&
            !(row.text.includes('status of 401') && row.url.includes('auth.refresh'))
        );
        expect(unexpected).toEqual([]);
        expect.soft(pageErrors, 'confirmation must consume its rejection').toEqual([]);
        expect
          .soft(alertEvidence.accessible, 'localized error alert must remain in accessibility tree')
          .toBe(1);
      } finally {
        db.exec('DROP TRIGGER IF EXISTS lab_reject_product_sync');
        db.close();
      }
    });
  }
}
