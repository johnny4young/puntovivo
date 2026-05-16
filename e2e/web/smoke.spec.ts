import { expect, test } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  loginAs,
  openUserMenu,
} from './support/app';

const setupRouteLabels = new Set([
  'Providers',
  'Categories',
  'Locations',
  'Company',
  'Sites',
  'Sequentials',
  'Geography',
  'Customer Catalogs',
  'Units',
  'VAT Rates',
  'Users',
  'Audit log',
]);

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
    // The Company page renders "Logo library" as the page h1 AND "Logo Library"
    // as the h2 of the library card; pin the assertion to the h2 level to
    // avoid a strict-mode collision on casing.
    assertion: async (page) => page.getByRole('heading', { level: 2, name: /^Logo Library$|^Biblioteca de logos$/i }),
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

test.describe('web smoke', () => {
  test('admin can navigate every sidebar module without client errors', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'admin');

    for (const route of adminRoutes) {
      if (setupRouteLabels.has(route.label)) {
        const setupLink = page.getByRole('link', { name: route.label });
        if ((await setupLink.count()) === 0) {
          await page.getByRole('button', { name: 'Setup' }).click();
          await expect(setupLink).toBeVisible();
        }
      }

      await page.getByRole('link', { name: route.label }).click();
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
    await page.goto('/company');
    await expect(page).toHaveURL(/\/dashboard$/);

    // AUDIT-09: /audit-logs is guarded by `adminOnlyRoles`. A manager
    // hitting it directly must redirect out; the sidebar entry also
    // stays hidden.
    await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    await page.goto('/audit-logs');
    await expect(page).toHaveURL(/\/dashboard$/);

    await expectNoClientIssues(tracker);
  });

  test('cashier route gating matches role rules', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);

    await loginAs(page, 'cashier');
    await expect(page).toHaveURL(/\/sales$/);
    await expect(page.getByRole('link', { name: 'Sales' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Inventory' })).toHaveCount(0);
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
    await page.goto('/sales');
    await expect(page).toHaveURL(/\/dashboard$/);

    await expectNoClientIssues(tracker);
  });

  test('spanish preference localizes the main navigation and dashboard shell', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'admin', { spanish: true });
    await ensureLanguage(page, 'es');

    await expect(page.getByRole('link', { name: 'Panel' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ventas' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Inventario' })).toBeVisible();
    await expect(page.getByText('Ventas de hoy')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ingresos 30 días' })).toBeVisible();

    await expectNoClientIssues(tracker);
  });
});
