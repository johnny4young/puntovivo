import { expect, test } from '@playwright/test';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { login } from './support/app';
import { seedReceiptPrintingScenario } from './support/db';

for (const language of ['en', 'es'] as const) {
  test(`virtual product opener survives rerender and falls back only after eviction (${language})`, async ({
    page,
    context,
  }, testInfo) => {
    const scenario = seedReceiptPrintingScenario(`focus-${testInfo.workerIndex}-${Date.now()}`);
    const db = new Database(resolve('packages/server/data/local.db'));
    // All rows belong to this fresh synthetic tenant; no fiscal operation or external provider.
    try {
      const insert = db.prepare(`INSERT INTO products
        (id, tenant_id, name, sku, price, cost, is_active, created_at, updated_at)
        VALUES (?, ?, ?, ?, 12500, 7500, 1, ?, ?)`);
      db.transaction(() => {
        for (let i = 0; i < 45; i++) {
          const stamp = new Date(Date.now() + i * 1000).toISOString();
          insert.run(
            randomUUID(),
            scenario.tenantId,
            `Synthetic focus ${i}`,
            `FOCUS-${i}`,
            stamp,
            stamp
          );
        }
      })();
    } finally {
      db.close();
    }
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
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
    await login(
      page,
      { ...scenario.admin, defaultPath: '/dashboard' },
      { spanish: language === 'es' }
    );
    await page.goto('/products');
    const scroll = page.locator('.data-table-scroll');
    await expect(scroll).toHaveAttribute('data-virtualised', 'true');
    const row = page.locator('tbody tr[data-row-id]').first();
    const id = await row.getAttribute('data-row-id');
    expect(id).toBeTruthy();
    const remove = row.getByRole('button', {
      name: language === 'en' ? 'Delete' : 'Eliminar',
      exact: true,
    });
    const original = await remove.elementHandle();
    expect(original).not.toBeNull();
    await remove.click();
    const dialog = page.getByRole('dialog', {
      name: language === 'en' ? 'Deactivate Product' : 'Desactivar producto',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    expect(await original!.evaluate(el => el.isConnected)).toBe(true);
    expect(await page.locator('#root').evaluate(el => (el as HTMLElement).inert)).toBe(true);
    await dialog
      .getByRole('button', { name: language === 'en' ? 'Cancel' : 'Cancelar', exact: true })
      .click();
    await expect(remove).toBeFocused();
    expect(await original!.evaluate(el => el === document.activeElement)).toBe(true);
    // A background virtual-window update can legitimately unmount the opener.
    // Simulate that update without removing inert or moving focus into the background.
    await remove.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await scroll.evaluate(el => {
      el.scrollTop = el.scrollHeight;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(() => original!.evaluate(el => el.isConnected)).toBe(false);
    await dialog
      .getByRole('button', { name: language === 'en' ? 'Cancel' : 'Cancelar', exact: true })
      .focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('data-table-search')).toBeFocused();
    expect(await page.locator('#root').evaluate(el => (el as HTMLElement).inert)).toBe(false);
    expect(errors).toEqual([]);
    await testInfo.attach('focus-result', {
      body: JSON.stringify({
        language,
        virtual: true,
        sameOriginalNodeBeforeEviction: true,
        removedOriginalNodeAfterEviction: true,
        fallback: 'product-search',
        pageErrors: errors,
      }),
      contentType: 'application/json',
    });
  });
}

for (const language of ['en', 'es'] as const) {
  test(`mouse rejection, cancel and retry preserve the original product control (${language})`, async ({
    page,
    context,
  }) => {
    const scenario = seedReceiptPrintingScenario(`mouse-focus-${Date.now()}`);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
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
        .prepare('SELECT is_active, sync_version FROM products WHERE id = ?')
        .get(scenario.product.id),
      outbox: db
        .prepare('SELECT count(*) AS n FROM sync_outbox WHERE entity_id = ?')
        .get(scenario.product.id),
    });
    const before = snapshot();
    const id = scenario.product.id.replaceAll("'", "''");
    db.exec(`CREATE TRIGGER lab_mouse_focus_rejection BEFORE INSERT ON sync_outbox
      WHEN NEW.entity_type = 'products' AND NEW.entity_id = '${id}'
      BEGIN SELECT RAISE(ABORT, 'Synthetic mouse recovery rejection'); END`);
    try {
      await login(
        page,
        { ...scenario.admin, defaultPath: '/dashboard' },
        { spanish: language === 'es' }
      );
      await page.goto('/products');
      await page.getByTestId('data-table-search').fill(scenario.product.sku);
      const row = page.getByRole('row').filter({ hasText: scenario.product.sku });
      const remove = row.getByRole('button', {
        name: language === 'en' ? 'Delete' : 'Eliminar',
        exact: true,
      });
      const opener = await remove.elementHandle();
      expect(opener).not.toBeNull();
      await remove.click();
      const dialog = page.getByRole('dialog', {
        name: language === 'en' ? 'Deactivate Product' : 'Desactivar producto',
        exact: true,
      });
      const confirm = dialog.getByRole('button', {
        name: language === 'en' ? 'Deactivate' : 'Desactivar',
        exact: true,
      });
      await confirm.click();
      await expect(
        page.getByRole('alert').filter({
          hasText:
            language === 'en'
              ? 'Unable to deactivate product'
              : 'No se pudo desactivar el producto',
        })
      ).toHaveCount(1);
      expect(await opener!.evaluate(el => el.isConnected)).toBe(true);
      expect(await page.locator('#root').evaluate(el => (el as HTMLElement).inert)).toBe(true);
      expect(snapshot()).toEqual(before);
      await dialog
        .getByRole('button', { name: language === 'en' ? 'Cancel' : 'Cancelar', exact: true })
        .click();
      await expect(remove).toBeFocused();
      expect(await opener!.evaluate(el => el === document.activeElement)).toBe(true);
      db.exec('DROP TRIGGER lab_mouse_focus_rejection');
      await remove.click();
      await confirm.click();
      await expect(dialog).toBeHidden();
      await expect(
        page
          .getByRole('status')
          .filter({ hasText: language === 'en' ? 'Product deactivated' : 'Producto desactivado' })
      ).toHaveCount(1);
      expect(snapshot().row).toMatchObject({ is_active: 0 });
      expect(snapshot().outbox).toEqual({ n: (before.outbox as { n: number }).n + 1 });
      expect(errors).toEqual([]);
    } finally {
      db.exec('DROP TRIGGER IF EXISTS lab_mouse_focus_rejection');
      db.close();
    }
  });
}
