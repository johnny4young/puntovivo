import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  loginAs,
  openUserMenu,
} from './support/app';

const adminRoutes = [
  {
    label: 'Dashboard',
    path: '/dashboard',
    assertion: async (page) =>
      page.getByText(/Today's Sales|Ventas de hoy/i).first(),
  },
  {
    label: 'Sales',
    path: '/sales',
    assertion: async (page) =>
      page.getByRole('heading', {
        name: /Charge summary|Resumen de cobro/i,
      }),
  },
  {
    label: 'Inventory',
    path: '/inventory',
    assertion: async (page) => page.getByRole('button', { name: /Movements|By Site|Por sede/i }).first(),
  },
  { label: 'Orders', path: '/orders', assertion: async (page) => page.getByRole('button', { name: /Create order|Nueva orden|Add product/i }).first() },
  { label: 'Purchases', path: '/purchases', assertion: async (page) => page.getByRole('button', { name: /Record purchase|Nueva compra|Add product/i }).first() },
  { label: 'Quotations', path: '/quotations', assertion: async (page) => page.getByRole('button', { name: /New quotation|Nueva cotización/i }) },
  { label: 'Customers', path: '/customers', assertion: async (page) => page.getByRole('button', { name: /Add Customer|Agregar cliente/i }) },
  { label: 'Products', path: '/products', assertion: async (page) => page.getByRole('button', { name: /Add Product|Agregar producto/i }) },
  { label: 'Providers', path: '/providers', assertion: async (page) => page.getByRole('button', { name: /Add Provider|Agregar proveedor/i }) },
  { label: 'Categories', path: '/categories', assertion: async (page) => page.getByRole('button', { name: /Add Category|Agregar categoría/i }) },
  { label: 'Locations', path: '/locations', assertion: async (page) => page.getByRole('button', { name: /Add Location|Agregar ubicación/i }) },
  {
    label: 'Company',
    path: '/company',
    assertion: async (page) =>
      page.getByRole('heading', {
        name: /Ready to open|Listo para abrir|Setup readiness|Configuración inicial/i,
      }),
  },
  {
    label: 'Import data',
    path: '/data-import',
    assertion: async (page) =>
      page.getByRole('main').getByRole('heading', { level: 1, name: /Import data|Importar datos/i }),
  },
  { label: 'Sites', path: '/sites', assertion: async (page) => page.getByRole('button', { name: /Add Site|Agregar sede/i }) },
  {
    label: 'Sequentials',
    path: '/sequentials',
    assertion: async (page) => page.getByRole('button', { name: /Add Sequential|Crear consecutivo/i }),
  },
  { label: 'Geography', path: '/geography', assertion: async (page) => page.getByRole('main').getByRole('heading', { name: /Geography|Geografía/i }) },
  {
    label: 'Customer Catalogs',
    path: '/customer-catalogs',
    assertion: async (page) => page.getByRole('main').getByRole('heading', { name: /Customer Catalogs|Catálogos de clientes/i }),
  },
  { label: 'Units', path: '/units', assertion: async (page) => page.getByRole('button', { name: /Add Unit|Agregar unidad/i }) },
  { label: 'VAT Rates', path: '/vat-rates', assertion: async (page) => page.getByRole('button', { name: /Add VAT Rate|Agregar tarifa IVA/i }) },
  { label: 'Users', path: '/users', assertion: async (page) => page.getByRole('button', { name: /Add User|Agregar usuario/i }) },
  { label: 'Audit log', path: '/audit-logs', assertion: async (page) => page.getByText(/Recent audit events|Eventos recientes/i) },
] as const;

const routeWorkspaceLabels = new Map<string, string>([
  ['Sales', 'Sell'],
  ['Inventory', 'Inventory'],
  ['Orders', 'Procurement'],
  ['Purchases', 'Procurement'],
  ['Quotations', 'Procurement'],
  ['Customers', 'Customers'],
  ['Products', 'Catalog'],
  ['Providers', 'Catalog'],
  ['Categories', 'Catalog'],
  ['Locations', 'Catalog'],
  ['Geography', 'Catalog'],
  ['Customer Catalogs', 'Catalog'],
  ['Units', 'Catalog'],
  ['VAT Rates', 'Catalog'],
  ['Audit log', 'Finance'],
  ['Company', 'Setup'],
  ['Import data', 'Setup'],
  ['Sites', 'Setup'],
  ['Sequentials', 'Setup'],
  ['Users', 'Setup'],
]);

async function revealSidebarLink(page: Page, label: string, workspaceLabel?: string) {
  const link = page.getByRole('link', { name: label });
  if ((await link.count()) === 0 && workspaceLabel) {
    const escapedLabel = workspaceLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    await page
      .getByRole('button', {
        name: new RegExp(
          `^(?:Expand|Collapse|Expandir|Contraer) ${escapedLabel}$`,
          'i'
        ),
      })
      .click();
  }
  await expect(link).toBeVisible();
  return link;
}

test.describe('web smoke', () => {
  test('admin can navigate every sidebar module without client errors', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'admin');

    for (const route of adminRoutes) {
      const link = await revealSidebarLink(page, route.label, routeWorkspaceLabels.get(route.label));
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${route.path}$`));
      await expect(await route.assertion(page)).toBeVisible();
    }

    await openUserMenu(page);
    await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await expectNoClientIssues(tracker);
  });

  test('admin shell supports multi-site selection and responsive tablet layout', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'responsive smoke uses a single stable browser target');

    const tracker = attachClientIssueTracker(page);
    await page.setViewportSize({ width: 820, height: 1180 });
    await loginAs(page, 'admin');

    await expect(
      page.locator('header').getByRole('button', { name: /Branch Site|Main Site|E2E Branch Site/ })
    ).toBeEnabled();
    await expect(
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).resolves.toBe(true);

    await page.getByRole('button', { name: /open navigation/i }).click();
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();

    await expectNoClientIssues(tracker);
  });

  test('manager route gating matches role rules', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);

    await loginAs(page, 'manager');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Company' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Import data' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Day close|Cierre del día/i })).toBeVisible();
    await page.goto('/day-close');
    await expect(page.getByTestId('day-close-report-page')).toBeVisible();
    await page.goto('/company');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/data-import');
    await expect(page).toHaveURL(/\/dashboard$/);

    // AUDIT-09: /audit-logs is guarded by `adminOnlyRoles`. A manager
    // hitting it directly must redirect out; the sidebar entry also
    // stays hidden.
    await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    await page.goto('/audit-logs');
    await expect(page).toHaveURL(/\/dashboard$/);

    await expectNoClientIssues(tracker);
  });

  test('manager signs and reloads immutable day-close evidence', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'manager');
    await page.goto('/day-close');

    const dateInput = page.getByLabel(/^(Business day|Día comercial)$/i);
    const evidence = page.getByTestId('day-close-signed-evidence');
    const unsignedCard = page.getByTestId('day-close-signoff-card');
    await dateInput.fill('2000-01-01');
    await expect(unsignedCard.or(evidence)).toBeVisible();

    // A retry can inherit evidence written by the first attempt. Keep the
    // smoke idempotent while the clean first attempt still exercises the
    // complete irreversible confirmation path.
    if (await unsignedCard.isVisible()) {
      await expect(page.getByTestId('day-close-readiness')).toContainText(
        /ready for manager review|listo para revisión/i
      );
      await page.getByRole('checkbox', { name: /I reviewed|Revisé/i }).check();
      await page.getByRole('button', { name: /Sign day close|Firmar cierre/i }).click();
      await expect(page.getByRole('dialog')).toContainText(/irreversible/i);
      await page.getByRole('button', { name: /Sign and freeze|Firmar y proteger/i }).click();
    }

    await expect(evidence).toContainText(/E2E Manager/);
    await expect(page.getByTestId('day-close-signoff-hash')).toHaveText(/^[a-f0-9]{64}$/);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('day-close-pdf-download').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(
      /^puntovivo-cierre-2000-01-01-[a-f0-9]{8}\.pdf$/
    );
    const downloadPath = await download.path();
    expect(downloadPath).not.toBeNull();
    const pdf = await readFile(downloadPath!);
    expect(pdf.subarray(0, 8).toString()).toBe('%PDF-1.3');
    expect(pdf.subarray(-5).toString()).toBe('%%EOF');

    await page.reload();
    await dateInput.fill('2000-01-01');
    await expect(evidence).toContainText(/E2E Manager/);
    await expect(page.getByTestId('day-close-signoff-hash')).toHaveText(/^[a-f0-9]{64}$/);
    await expect(page.getByTestId('day-close-pdf-download')).toBeEnabled();
    await expect(page.getByRole('checkbox')).toHaveCount(0);

    await expectNoClientIssues(tracker);
  });

  test('cashier route gating matches role rules', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);

    await loginAs(page, 'cashier');
    await expect(page).toHaveURL(/\/sales$/);
    await expect(page.getByRole('link', { name: 'Sales', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Inventory' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Day close|Cierre del día/i })).toHaveCount(0);
    await page.goto('/day-close');
    await expect(page).toHaveURL(/\/sales$/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sales$/);

    await expectNoClientIssues(tracker);
  });

  test('viewer route gating matches role rules', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);

    await loginAs(page, 'viewer');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sales' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Day close|Cierre del día/i })).toHaveCount(0);
    await page.goto('/day-close');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/sales');
    await expect(page).toHaveURL(/\/dashboard$/);

    await expectNoClientIssues(tracker);
  });

  test('spanish preference localizes the main navigation and dashboard shell', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'admin', { spanish: true });
    await ensureLanguage(page, 'es');

    await expect(page.getByRole('link', { name: 'Panel' })).toBeVisible();
    await revealSidebarLink(page, 'Ventas', 'Vender');
    await revealSidebarLink(page, 'Inventario', 'Inventario');
    await expect(page.getByText('Ventas de hoy')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ingresos 30 días' })).toBeVisible();

    await expectNoClientIssues(tracker);
  });
});
