import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator } from '@playwright/test';
import { attachClientIssueTracker, expectNoClientIssues, login } from './support/app';
import { seedSurfaceGateScenario } from './support/db';

async function expectInsideViewport(control: Locator, width: number): Promise<void> {
  await expect(control).toBeVisible();
  const box = await control.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(width);
  // Composited rectangles can report 39.999996 for a 40px CSS control after
  // resizing. Keep the exact layout-size floor, not a reduced touch budget.
  const layout = await control.evaluate(element => ({
    width: (element as HTMLElement).offsetWidth,
    height: (element as HTMLElement).offsetHeight,
  }));
  expect(layout.width).toBeGreaterThanOrEqual(40);
  expect(layout.height).toBeGreaterThanOrEqual(40);
}

for (const language of ['en', 'es'] as const) {
  test(`keeps long-name shell controls reachable at every width in ${language}`, async ({
    page,
  }, testInfo) => {
    const scenario = seedSurfaceGateScenario(
      `header-${language}-${testInfo.parallelIndex}-${Date.now()}`,
      {}
    );
    const tenantName = 'Comercializadora Latinoamericana de Productos y Servicios del Centro';
    const siteName = 'Sucursal Centro Comercial Internacional — Punto de Atención Principal';
    const userName = 'María Alejandra Rodríguez Fernández de la Torre';
    const db = new Database(path.join(process.cwd(), 'packages/server/data/local.db'));
    try {
      db.transaction(() => {
        db.prepare('UPDATE tenants SET name = ? WHERE id = ?').run(tenantName, scenario.tenantId);
        db.prepare('UPDATE sites SET name = ? WHERE id = ? AND tenant_id = ?').run(
          siteName,
          scenario.site.id,
          scenario.tenantId
        );
        db.prepare(
          "INSERT INTO sites (id, tenant_id, company_id, name, is_active, created_at, updated_at) SELECT ?, tenant_id, company_id, 'Secondary location', 1, created_at, updated_at FROM sites WHERE id = ? AND tenant_id = ?"
        ).run(`${scenario.site.id}-secondary`, scenario.site.id, scenario.tenantId);
        db.prepare('UPDATE users SET name = ? WHERE id = ? AND tenant_id = ?').run(
          userName,
          scenario.admin.id,
          scenario.tenantId
        );
      })();
    } finally {
      db.close();
    }
    await page.addInitScript(
      locale => localStorage.setItem('puntovivo-language-preference', locale),
      language
    );
    const tracker = attachClientIssueTracker(page);
    await login(
      page,
      { ...scenario.admin, defaultPath: '/company' },
      { spanish: language === 'es' }
    );
    for (const width of [1920, 1536, 1440, 1280, 1024, 768, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const header = page.locator('header').first();
      const account = header.getByRole('button', { name: new RegExp(userName) });
      await expectInsideViewport(account, width);
      const search = header.getByRole('button', {
        name:
          language === 'es'
            ? 'Abrir buscador de tareas y productos'
            : 'Open task and product search',
      });
      await expectInsideViewport(search, width);
      await account.click();
      const panel = page.locator('#header-user-menu');
      await expectInsideViewport(panel, width);
      await expect(panel.getByText(userName, { exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(panel).toBeHidden();
      await expect(account).toBeFocused();
      const site = header.locator('button[name="site"]');
      await expectInsideViewport(site, width);
      await site.click();
      await header.getByRole('option', { name: 'Secondary location', exact: true }).click();
      await expect(site).toHaveText('Secondary location');
      await site.click();
      await header.getByRole('option', { name: siteName, exact: true }).click();
      await expect(site).toHaveText(siteName);
      expect(await header.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
      const auditDir = process.env.PUNTOVIVO_AUDIT_DIR;
      if (auditDir && [1440, 768, 390].includes(width)) {
        await mkdir(auditDir, { recursive: true });
        await header.screenshot({ path: path.join(auditDir, `header-${language}-${width}.png`) });
      }
    }
    await page.reload();
    await expect(page.locator('header button[name="site"]')).toHaveText(siteName);
    const accessibility = await new AxeBuilder({ page }).include('header').analyze();
    expect(accessibility.violations).toEqual([]);
    await expectNoClientIssues(tracker);
  });
}
