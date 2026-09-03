import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  ensureLanguage,
  expectNoClientIssues,
  loginAs,
  openUserMenu,
} from './support/app';
import { attachTaskMeasurementTracker, expectTaskMeasurement } from './support/task-measurement';

const adminRoutes = [
  {
    label: 'See what matters today',
    path: '/dashboard',
    assertion: async page => page.getByText(/Today's Sales|Ventas de hoy/i).first(),
  },
  {
    label: 'Make a sale',
    path: '/sales',
    assertion: async page =>
      page.getByRole('heading', {
        name: /Charge summary|Resumen de cobro/i,
      }),
  },
  {
    label: 'Team schedule',
    path: '/schedule',
    assertion: async page => page.getByTestId('team-schedule-page'),
  },
  {
    label: 'Review stock',
    path: '/inventory',
    assertion: async page =>
      page.getByRole('button', { name: /Movements|By Site|Por sede/i }).first(),
  },
  {
    label: 'Orders',
    path: '/orders',
    assertion: async page =>
      page.getByRole('button', { name: /Create order|Nueva orden|Add product/i }).first(),
  },
  {
    label: 'Purchases',
    path: '/purchases',
    assertion: async page =>
      page.getByRole('button', { name: /Record purchase|Nueva compra|Add product/i }).first(),
  },
  {
    label: 'Quotations',
    path: '/quotations',
    assertion: async page => page.getByRole('button', { name: /New quotation|Nueva cotización/i }),
  },
  {
    label: 'Customers',
    path: '/customers',
    assertion: async page => page.getByRole('button', { name: /Add Customer|Agregar cliente/i }),
  },
  {
    label: 'Add or find products',
    path: '/products',
    assertion: async page => page.getByRole('button', { name: /Add Product|Agregar producto/i }),
  },
  {
    label: 'Providers',
    path: '/providers',
    assertion: async page => page.getByRole('button', { name: /Add Provider|Agregar proveedor/i }),
  },
  {
    label: 'Categories',
    path: '/categories',
    assertion: async page => page.getByRole('button', { name: /Add Category|Agregar categoría/i }),
  },
  {
    label: 'Locations',
    path: '/locations',
    assertion: async page => page.getByRole('button', { name: /Add Location|Agregar ubicación/i }),
  },
  {
    label: 'Set up the business',
    path: '/company',
    assertion: async page =>
      page.getByRole('heading', {
        name: /Prepare the business without getting lost|Prepara el negocio sin perderte/i,
      }),
  },
  {
    label: 'Visual system',
    path: '/design-system',
    assertion: async page => page.getByTestId('design-system-page'),
  },
  {
    label: 'Import data',
    path: '/data-import',
    assertion: async page =>
      page
        .getByRole('main')
        .getByRole('heading', { level: 1, name: /Import data|Importar datos/i }),
  },
  {
    label: 'Sites',
    path: '/sites',
    assertion: async page => page.getByRole('button', { name: /Add Site|Agregar sede/i }),
  },
  {
    label: 'Sequentials',
    path: '/sequentials',
    assertion: async page =>
      page.getByRole('button', { name: /Configure numbering|Configurar numeración/i }),
  },
  {
    label: 'Geography',
    path: '/geography',
    assertion: async page =>
      page.getByRole('main').getByRole('heading', {
        level: 1,
        name: /Countries, regions, and cities|Países, regiones y ciudades/i,
      }),
  },
  {
    label: 'Customer Catalogs',
    path: '/customer-catalogs',
    assertion: async page =>
      page
        .getByRole('main')
        .getByRole('heading', { name: /Fiscal and commercial data|Datos fiscales y comerciales/i }),
  },
  {
    label: 'Units',
    path: '/units',
    assertion: async page => page.getByRole('button', { name: /Add Unit|Agregar unidad/i }),
  },
  {
    label: 'VAT Rates',
    path: '/vat-rates',
    assertion: async page => page.getByRole('button', { name: /Add VAT Rate|Agregar tarifa IVA/i }),
  },
  {
    label: 'Users',
    path: '/users',
    assertion: async page => page.getByRole('button', { name: /Add User|Agregar usuario/i }),
  },
  {
    label: 'Audit log',
    path: '/audit-logs',
    assertion: async page => page.getByText(/Recent audit events|Eventos recientes/i),
  },
] as const;

const routeWorkspaceLabels = new Map<string, string>([
  ['Team schedule', 'Today and close'],
  ['Orders', 'Orders and purchases'],
  ['Purchases', 'Orders and purchases'],
  ['Quotations', 'Orders and purchases'],
  ['Customers', 'Customers'],
  ['Providers', 'Products'],
  ['Categories', 'Products'],
  ['Locations', 'Products'],
  ['Geography', 'Products'],
  ['Customer Catalogs', 'Products'],
  ['Units', 'Products'],
  ['VAT Rates', 'Products'],
  ['Audit log', 'Billing and control'],
  ['Visual system', 'Manage business'],
  ['Import data', 'Manage business'],
  ['Sites', 'Manage business'],
  ['Sequentials', 'Manage business'],
  ['Users', 'Manage business'],
]);

const routeDirectoryIds = new Map<string, string>([
  ['Orders', 'procurement'],
  ['Purchases', 'procurement'],
  ['Quotations', 'procurement'],
  ['Providers', 'catalog'],
  ['Categories', 'catalog'],
  ['Locations', 'catalog'],
  ['Geography', 'catalog'],
  ['Customer Catalogs', 'catalog'],
  ['Units', 'catalog'],
  ['VAT Rates', 'catalog'],
  ['Audit log', 'finance'],
  ['Visual system', 'setup'],
  ['Import data', 'setup'],
  ['Sites', 'setup'],
  ['Sequentials', 'setup'],
  ['Users', 'setup'],
]);

const primaryTaskIds = new Map<string, string>([
  ['See what matters today', 'today'],
  ['Make a sale', 'sell'],
  ['Review stock', 'inventory'],
  ['Add or find products', 'products'],
  ['Set up the business', 'businessSetup'],
]);

async function revealSidebarLink(page: Page, label: string, path: string, workspaceLabel?: string) {
  const primaryTaskId = primaryTaskIds.get(label);
  let link = primaryTaskId
    ? page.getByTestId(`sidebar-primary-task-${primaryTaskId}`)
    : page.getByRole('link', { name: label, exact: true });
  if (!(await link.isVisible().catch(() => false)) && workspaceLabel) {
    const moreTools = page.getByTestId('sidebar-more-tools-toggle');
    if ((await moreTools.getAttribute('aria-expanded')) === 'false') {
      await moreTools.click();
    }
    const escapedLabel = workspaceLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!(await link.isVisible().catch(() => false))) {
      const workspaceToggle = page.getByRole('button', {
        name: new RegExp(`^(?:Expand|Collapse|Expandir|Contraer) ${escapedLabel}$`, 'i'),
      });
      if ((await workspaceToggle.getAttribute('aria-expanded')) === 'false') {
        await workspaceToggle.click();
      }
    }
    const directoryId = routeDirectoryIds.get(label);
    if (!(await link.isVisible().catch(() => false)) && directoryId) {
      await page.getByTestId(`sidebar-workspace-directory-${directoryId}`).click();
      link = page.getByTestId(`workspace-landing-${directoryId}`).locator(`a[href="${path}"]`);
    }
  }
  await expect(link).toBeVisible();
  return link;
}

test.describe('web smoke', () => {
  test('login explains access with business language instead of tenancy jargon', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await page.goto('/login');

    await expect(page.getByText('Secure operation across sites')).toBeVisible();
    await expect(
      page.getByText(
        'Use your workstation credentials to access sales, inventory, purchasing, and settings for your business.'
      )
    ).toBeVisible();
    await expect(page.getByText(/tenant/i)).toHaveCount(0);

    await expectNoClientIssues(tracker);
  });

  test('admin can navigate every sidebar module without client errors', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'admin');

    for (const route of adminRoutes) {
      const link = await revealSidebarLink(
        page,
        route.label,
        route.path,
        routeWorkspaceLabels.get(route.label)
      );
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${route.path}$`));
      await expect(await route.assertion(page)).toBeVisible();
    }

    await openUserMenu(page);
    await expect(page.getByRole('button', { name: 'Change password' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();

    await expectNoClientIssues(tracker);
  });

  test('company setup keeps the novice path focused and advanced settings reachable', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'admin');
    await page.goto('/company');

    await expect(page.getByTestId('company-readiness-card')).toBeVisible();
    const guidedSteps = ['businessType', 'business', 'selling', 'fiscal', 'payments', 'devices'];
    await expect(page.locator('[data-testid^="company-guided-step-"]')).toHaveCount(
      guidedSteps.length
    );
    for (const step of guidedSteps) {
      await expect(page.getByTestId(`company-guided-step-${step}`)).toBeVisible();
    }
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '6');
    await expect(page.getByTestId('company-advanced-toggle')).toHaveAttribute(
      'aria-expanded',
      'false'
    );
    await expect(page.getByTestId('company-tab-ai')).toHaveCount(0);

    await page.getByTestId('company-guided-step-devices').click();
    await expect(page).toHaveURL(/\/company\?step=devices$/);
    await expect(page.getByTestId('company-guided-detail-devices')).toBeVisible();

    await page.getByTestId('company-advanced-toggle').click();
    await expect(page.getByTestId('company-advanced-settings')).toBeVisible();
    await page.getByTestId('company-tab-locale').click();
    await expect(page).toHaveURL(/\/company\?tab=locale$/);

    await page.goto('/company?tab=ai');
    await expect(page.getByTestId('company-advanced-settings')).toBeVisible();
    await expect(page.getByTestId('company-tab-ai')).toHaveAttribute('aria-current', 'page');

    await expectNoClientIssues(tracker);
  });

  test('seeded customer catalogs follow the active language without changing their codes', async ({
    page,
  }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'admin');
    await page.goto('/customer-catalogs');

    await expect(page.getByRole('heading', { name: 'Fiscal and commercial data' })).toBeVisible();
    await expect(page.getByText('Citizenship ID', { exact: true })).toBeVisible();
    await expect(page.getByText('CC', { exact: true })).toBeVisible();
    await expect(page.getByText('Cédula de ciudadanía', { exact: true })).toHaveCount(0);

    await page.getByRole('tab', { name: 'Person', exact: true }).click();
    await expect(page.getByText('Individual', { exact: true })).toBeVisible();

    await ensureLanguage(page, 'es');
    await expect(page.getByRole('heading', { name: 'Datos fiscales y comerciales' })).toBeVisible();
    await page.getByRole('tab', { name: 'Identificación', exact: true }).click();
    await expect(page.getByText('Cédula de ciudadanía', { exact: true })).toBeVisible();
    await expect(page.getByText('CC', { exact: true })).toBeVisible();
    await expect(page.getByText('Citizenship ID', { exact: true })).toHaveCount(0);

    await expectNoClientIssues(tracker);
  });

  test('admin shell supports multi-site selection and responsive tablet layout', async ({
    page,
  }) => {
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
    await expect(page.getByTestId('mobile-primary-task-today')).toContainText(
      'See what matters today'
    );

    await expectNoClientIssues(tracker);
  });

  test('manager route gating matches role rules', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);

    await loginAs(page, 'manager');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('sidebar-primary-task-today')).toContainText(
      'See what matters today'
    );
    await expect(page.getByTestId('sidebar-primary-task-dayClose')).toContainText('Close the day');
    await expect(page.getByTestId('sidebar-primary-task-businessSetup')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Company' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Visual system' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Import data' })).toHaveCount(0);
    const moreTools = page.getByTestId('sidebar-more-tools-toggle');
    await expect(moreTools).toHaveAttribute('aria-expanded', 'false');
    await moreTools.click();
    await revealSidebarLink(page, 'Team schedule', 'Today and close');
    await page.goto('/day-close');
    await expect(page.getByTestId('day-close-report-page')).toBeVisible();
    await page.goto('/schedule');
    await expect(page.getByTestId('team-schedule-page')).toBeVisible();
    await page.goto('/company');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/design-system');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/data-import');
    await expect(page).toHaveURL(/\/dashboard$/);

    // /audit-logs is guarded by `adminOnlyRoles`. A manager
    // hitting it directly must redirect out; the sidebar entry also
    // stays hidden.
    await expect(page.getByRole('link', { name: 'Audit log' })).toHaveCount(0);
    await page.goto('/audit-logs');
    await expect(page).toHaveURL(/\/dashboard$/);

    await expectNoClientIssues(tracker);
  });

  test('manager publishes, edits, cancels, and reloads a team schedule', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);
    await loginAs(page, 'manager');
    await page.goto('/schedule');
    await expect(page.getByTestId('team-schedule-page')).toBeVisible();

    const activeShiftCard = page
      .locator('[data-testid^="scheduled-shift-"]')
      .filter({ hasText: 'E2E Cashier' })
      .filter({ hasNotText: /Cancelled|Cancelado/i })
      .first();

    // A retry can inherit the row published by its first attempt. Reuse the
    // active shift instead of colliding with the database overlap invariant.
    if (!(await activeShiftCard.isVisible())) {
      await page
        .getByRole('button', { name: /Add shift|Agregar turno/i })
        .first()
        .click();
      const createDialog = page.getByRole('dialog');
      const employeeSelect = createDialog.getByLabel(/Employee|Empleado/i);
      const cashierOptionValue = await employeeSelect
        .locator('option', { hasText: /^E2E Cashier · / })
        .first()
        .getAttribute('value');
      expect(cashierOptionValue).not.toBeNull();
      await employeeSelect.selectOption(cashierOptionValue!);
      await createDialog.getByLabel(/Start time|Hora de inicio/i).fill('06:30');
      await createDialog.getByLabel(/End time|Hora de fin/i).fill('14:30');
      await createDialog.getByLabel(/Notes|Notas/i).fill('E2E opening coverage');
      await createDialog.getByRole('button', { name: /Save shift|Guardar turno/i }).click();
    }

    await expect(activeShiftCard).toContainText(/E2E (opening|updated) coverage/);
    await activeShiftCard
      .getByRole('button', { name: /Edit E2E Cashier|Editar turno de E2E Cashier/i })
      .click();
    const editDialog = page.getByRole('dialog');
    await editDialog.getByLabel(/End time|Hora de fin/i).fill('15:00');
    await editDialog.getByLabel(/Notes|Notas/i).fill('E2E updated coverage');
    await editDialog.getByRole('button', { name: /Save shift|Guardar turno/i }).click();
    await expect(activeShiftCard).toContainText('E2E updated coverage');

    await activeShiftCard
      .getByRole('button', { name: /Cancel E2E Cashier|Cancelar turno de E2E Cashier/i })
      .click();
    const cancelDialog = page.getByRole('dialog');
    await cancelDialog.getByRole('button', { name: /Cancel shift|Cancelar turno/i }).click();
    await expect(activeShiftCard).toHaveCount(0);

    await page.getByLabel(/Show cancelled shifts|Mostrar turnos cancelados/i).check();
    const cancelledShiftCard = page
      .locator('[data-testid^="scheduled-shift-"]')
      .filter({ hasText: 'E2E updated coverage' })
      .first();
    await expect(cancelledShiftCard).toContainText(/Cancelled|Cancelado/i);
    await page.reload();
    await page.getByLabel(/Show cancelled shifts|Mostrar turnos cancelados/i).check();
    await expect(cancelledShiftCard).toContainText(/Cancelled|Cancelado/i);

    await expectNoClientIssues(tracker);
  });

  test(
    'manager signs and reloads immutable day-close evidence',
    { tag: '@critical' },
    async ({ page }) => {
      const tracker = attachClientIssueTracker(page);
      const taskMeasurements = attachTaskMeasurementTracker(page);
      const dateEntropy = randomUUID().replaceAll('-', '');
      const year = 1970 + (Number.parseInt(dateEntropy.slice(0, 2), 16) % 30);
      const month = 1 + (Number.parseInt(dateEntropy.slice(2, 4), 16) % 12);
      const day = 1 + (Number.parseInt(dateEntropy.slice(4, 6), 16) % 28);
      const closeDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const decoyDate = `${year}-${String(month).padStart(2, '0')}-${String(day === 1 ? 2 : 1).padStart(2, '0')}`;
      await loginAs(page, 'manager');
      await page.goto('/day-close');
      await expect(page).toHaveURL(/\/day-close$/);

      const dateInput = page.getByLabel(/^(Business day|Día comercial)$/i);
      const evidence = page.getByTestId('day-close-signed-evidence');
      const unsignedCard = page.getByTestId('day-close-signoff-card');
      await expect(dateInput).toBeVisible();
      const decoySignoffResponse = page.waitForResponse(
        response =>
          response.request().method() === 'GET' &&
          response.url().includes('reports.dayClose.signoff') &&
          decodeURIComponent(response.url()).includes(`\"date\":\"${decoyDate}\"`) &&
          response.ok(),
        { timeout: 15_000 }
      );
      await dateInput.fill(decoyDate);
      // Wait until React has committed the decoy selection and its read-side
      // request before navigating back. Consecutive fills can otherwise be
      // coalesced into one render and do not exercise a real backtrack.
      await decoySignoffResponse;
      await dateInput.fill(closeDate);
      await expect(unsignedCard).toBeVisible();
      await expect(page.getByTestId('day-close-readiness')).toContainText(
        /ready for manager review|listo para revisión/i
      );
      const reviewCheckbox = page.getByRole('checkbox', { name: /I reviewed|Revisé/i });
      await expect(reviewCheckbox).toBeVisible();
      await reviewCheckbox.check();
      await page.getByRole('button', { name: /Sign day close|Firmar cierre/i }).click();
      await expect(page.getByRole('dialog')).toContainText(/irreversible/i);
      await page.getByRole('button', { name: /Sign and freeze|Firmar y proteger/i }).click();

      await expect(evidence).toContainText(/E2E Manager/);
      await expect(page.getByTestId('day-close-signoff-hash')).toHaveText(/^[a-f0-9]{64}$/);
      await expect(page.getByRole('checkbox')).toHaveCount(0);
      const downloadPromise = page.waitForEvent('download');
      await page.getByTestId('day-close-pdf-download').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(
        new RegExp(`^puntovivo-cierre-${closeDate}-[a-f0-9]{8}\\.pdf$`)
      );
      const downloadPath = await download.path();
      expect(downloadPath).not.toBeNull();
      const pdf = await readFile(downloadPath!);
      expect(pdf.subarray(0, 8).toString()).toBe('%PDF-1.3');
      expect(pdf.subarray(-5).toString()).toBe('%%EOF');

      await page.reload();
      await dateInput.fill(closeDate);
      await expect(evidence).toContainText(/E2E Manager/);
      await expect(page.getByTestId('day-close-signoff-hash')).toHaveText(/^[a-f0-9]{64}$/);
      await expect(page.getByTestId('day-close-pdf-download')).toBeEnabled();
      await expect(page.getByRole('checkbox')).toHaveCount(0);

      await expectTaskMeasurement(taskMeasurements, {
        task: 'close_day',
        route: '/day-close',
        outcome: 'success',
        backtrackCount: 1,
        validationErrorCount: 0,
      });

      await expectNoClientIssues(tracker);
      taskMeasurements.detach();
    }
  );

  test('cashier route gating matches role rules', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);

    await loginAs(page, 'cashier');
    await expect(page).toHaveURL(/\/sales$/);
    await expect(page.getByTestId('sidebar-primary-task-sell')).toContainText('Make a sale');
    await expect(page.getByTestId('sidebar-primary-task-inventory')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-primary-task-dayClose')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Team schedule|Horario del equipo/i })).toHaveCount(
      0
    );
    await page.goto('/day-close');
    await expect(page).toHaveURL(/\/sales$/);
    await page.goto('/schedule');
    await expect(page).toHaveURL(/\/sales$/);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/sales$/);

    await expectNoClientIssues(tracker);
  });

  test('viewer route gating matches role rules', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);

    await loginAs(page, 'viewer');
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('sidebar-primary-task-today')).toContainText(
      'See what matters today'
    );
    await expect(page.getByTestId('sidebar-primary-task-sell')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-primary-task-dayClose')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Team schedule|Horario del equipo/i })).toHaveCount(
      0
    );
    await page.goto('/day-close');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/schedule');
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.goto('/sales');
    await expect(page).toHaveURL(/\/dashboard$/);

    await expectNoClientIssues(tracker);
  });

  test('spanish preference localizes the main navigation and dashboard shell', async ({ page }) => {
    const tracker = attachClientIssueTracker(page);

    await page.addInitScript(() => {
      window.localStorage.setItem('puntovivo-language-preference', 'es');
    });
    await page.goto('/login');
    await expect(page.getByText('Operación segura entre sedes')).toBeVisible();
    await expect(
      page.getByText(
        'Usa tus credenciales de puesto de trabajo para acceder a ventas, inventario, compras y configuración de tu negocio.'
      )
    ).toBeVisible();
    await expect(page.getByText(/tenant/i)).toHaveCount(0);

    await loginAs(page, 'admin', { spanish: true });
    await ensureLanguage(page, 'es');

    await expect(page.getByTestId('sidebar-primary-task-today')).toContainText(
      'Ver lo importante de hoy'
    );
    await expect(page.getByTestId('sidebar-primary-task-sell')).toContainText('Hacer una venta');
    await expect(page.getByTestId('sidebar-primary-task-inventory')).toContainText(
      'Revisar existencias'
    );
    await expect(page.getByText('Ventas de hoy')).toBeVisible();
    await expect(page.getByText('todas las sedes')).toBeVisible();
    await expect(page.getByText(/tenant activo/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Ingresos 30 días' })).toBeVisible();

    await expectNoClientIssues(tracker);
  });
});
