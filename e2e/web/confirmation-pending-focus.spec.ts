import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { login } from './support/app';
import { seedReceiptPrintingScenario } from './support/db';

for (const language of ['en', 'es'] as const) {
  for (const method of ['keyboard', 'mouse'] as const) {
    test(`pending confirmation stays focused: ${language} ${method}`, async ({
      page,
      context,
    }, testInfo) => {
      const scenario = seedReceiptPrintingScenario(`pending-confirm-${Date.now()}`);
      let release!: () => void;
      let markStarted!: () => void;
      const gate = new Promise<void>(resolve => {
        release = resolve;
      });
      const started = new Promise<void>(resolve => {
        markStarted = resolve;
      });
      let requests = 0;
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.href.includes('products.delete')) {
          requests++;
          markStarted();
          await gate;
        }
        return ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
          ['blob:', 'data:', 'about:'].includes(url.protocol)
          ? route.continue()
          : route.abort('blockedbyclient');
      });
      await context.addInitScript(
        language => localStorage.setItem('puntovivo-language-preference', language),
        language
      );
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      const db = new Database(resolve('packages/server/data/local.db'));
      const snapshot = () => ({
        row: db
          .prepare('SELECT is_active, version FROM products WHERE id = ?')
          .get(scenario.product.id),
        outbox: db
          .prepare('SELECT count(*) AS n FROM sync_outbox WHERE entity_id = ?')
          .get(scenario.product.id),
      });
      const before = snapshot();
      const id = scenario.product.id.replaceAll("'", "''");
      db.exec(`CREATE TRIGGER lab_pending_confirmation_rejection BEFORE INSERT ON sync_outbox
        WHEN NEW.entity_type = 'products' AND NEW.entity_id = '${id}'
        BEGIN SELECT RAISE(ABORT, 'Synthetic pending confirmation rejection'); END`);
      try {
        await login(
          page,
          { ...scenario.admin, defaultPath: '/dashboard' },
          { spanish: language === 'es' }
        );
        await page.goto('/products');
        await page.getByTestId('data-table-search').fill(scenario.product.sku);
        const remove = page
          .getByRole('row')
          .filter({ hasText: scenario.product.sku })
          .getByRole('button', { name: language === 'en' ? 'Delete' : 'Eliminar', exact: true });
        await remove.click();
        const dialog = page.getByRole('dialog', {
          name: language === 'en' ? 'Deactivate Product' : 'Desactivar producto',
          exact: true,
        });
        const confirm = dialog.getByRole('button', {
          name: language === 'en' ? 'Deactivate' : 'Desactivar',
          exact: true,
        });
        const original = await confirm.elementHandle();
        expect(original).not.toBeNull();
        if (method === 'keyboard') {
          await confirm.focus();
          await page.keyboard.press('Enter');
        } else await confirm.click();
        await started;
        const busy = dialog.getByRole('button', {
          name: language === 'en' ? 'Loading…' : 'Cargando…',
          exact: true,
        });
        await expect(busy).toBeVisible();
        const during = {
          connected: await original!.evaluate(el => el.isConnected),
          focused: await original!.evaluate(el => el === document.activeElement),
          nativeDisabled: await original!.evaluate(el => (el as HTMLButtonElement).disabled),
          active: await page.evaluate(() => ({
            tag: document.activeElement?.tagName,
            label: document.activeElement?.getAttribute('aria-label'),
          })),
        };
        await testInfo.attach('pending-confirmation-state', {
          body: JSON.stringify(during),
          contentType: 'application/json',
        });
        // Preserve this same native focus destination; no focus call after loading starts.
        await expect(busy).toBeFocused();
        await expect(busy).toHaveAttribute('aria-disabled', 'true');
        await expect(busy).toHaveAttribute('aria-busy', 'true');
        expect(await page.locator('#root').evaluate(el => (el as HTMLElement).inert)).toBe(true);
        if (method === 'keyboard') await page.keyboard.press('Enter');
        else {
          const box = await busy.boundingBox();
          expect(box).not.toBeNull();
          // Real pointer input, without locator actionability bypass or forced focus.
          await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
        }
        release();
        await expect(
          page
            .getByRole('alert')
            .filter({
              hasText:
                language === 'en'
                  ? 'Unable to deactivate product'
                  : 'No se pudo desactivar el producto',
            })
        ).toHaveCount(1);
        expect(requests).toBe(1);
        expect(snapshot()).toEqual(before);
        await expect(confirm).toBeFocused();
        expect(await original!.evaluate(el => el === document.activeElement)).toBe(true);
        await dialog
          .getByRole('button', { name: language === 'en' ? 'Cancel' : 'Cancelar', exact: true })
          .click();
        await expect(remove).toBeFocused();
        db.exec('DROP TRIGGER lab_pending_confirmation_rejection');
        await remove.click();
        await confirm.click();
        await expect(dialog).toBeHidden();
        await expect(
          page
            .getByRole('status')
            .filter({ hasText: language === 'en' ? 'Product deactivated' : 'Producto desactivado' })
        ).toHaveCount(1);
        expect(requests).toBe(2);
        expect(snapshot().row).toMatchObject({ is_active: 0 });
        expect(snapshot().outbox).toEqual({ n: (before.outbox as { n: number }).n + 1 });
        expect(errors).toEqual([]);
      } finally {
        release();
        db.exec('DROP TRIGGER IF EXISTS lab_pending_confirmation_rejection');
        db.close();
      }
    });
  }
}
