/**
 * ENG-134 slice B — Playwright a11y smoke for the top user-facing
 * routes. Each test logs in with the role that owns the route, waits
 * for a canonical heading to confirm the page settled, and runs
 * axe-core on the WCAG 2 A + AA ruleset with a serious-floor — the
 * same contract as the component-test helper in
 * `apps/web/src/test/a11y.ts`. The `ClientIssueTracker` from the
 * shared e2e support layer enforces the existing zero-console-error
 * invariant on top.
 *
 * ENG-134g extends the catalogue to the five module-gated surfaces
 * (`/touch`, `/kds`, `/customer-display`, `/m`, `/delivery`): the e2e
 * baseline now force-enables their modules (`ensureModulesEnabled` in
 * `e2e/shared/baseline.ts`) so axe can reach each surface. The
 * keyboard-only `/sales` end-to-end shipped as ENG-134d; the manual
 * VoiceOver / NVDA screen-reader sweep is the sole ENG-134 §3b
 * "Remaining" item.
 */
import { expect, test, type Page } from '@playwright/test';
import {
  attachClientIssueTracker,
  expectNoClientIssues,
  loginAs,
  resetSession,
  type UserKey,
} from './support/app';
import { runAxeOnPage } from './support/a11y';

interface A11yRoute {
  label: string;
  path: string;
  role: UserKey | 'anon';
  /**
   * A locator that resolves once the page has settled enough for axe
   * to scan a representative DOM. Usually a heading or a primary
   * action button. The locator is awaited with a 15 s timeout before
   * the scan runs.
   */
  settled: (page: Page) => ReturnType<Page['locator']> | ReturnType<Page['getByRole']> | ReturnType<Page['getByText']>;
}

const a11yRoutes: readonly A11yRoute[] = [
  {
    label: 'Login',
    path: '/login',
    role: 'anon',
    settled: (page) => page.getByRole('button', { name: /Enter workspace|Entrar al espacio/i }),
  },
  {
    label: 'Dashboard (admin)',
    path: '/dashboard',
    role: 'admin',
    settled: (page) => page.getByText(/Today's Sales|Ventas de hoy/i).first(),
  },
  {
    label: 'Sales (cashier)',
    path: '/sales',
    role: 'cashier',
    settled: (page) =>
      page.getByRole('heading', { name: /Charge summary|Resumen de cobro/i }),
  },
  {
    label: 'Sales (admin)',
    path: '/sales',
    role: 'admin',
    settled: (page) =>
      page.getByRole('heading', { name: /Charge summary|Resumen de cobro/i }),
  },
  {
    label: 'Inventory (admin)',
    path: '/inventory',
    role: 'admin',
    settled: (page) =>
      page.getByRole('button', { name: /Movements|By Site|Por sede/i }).first(),
  },
  {
    label: 'Customers (admin)',
    path: '/customers',
    role: 'admin',
    settled: (page) =>
      page.getByRole('button', { name: /Add Customer|Agregar cliente/i }),
  },
  {
    label: 'Products (admin)',
    path: '/products',
    role: 'admin',
    settled: (page) =>
      page.getByRole('button', { name: /Add Product|Agregar producto/i }),
  },
  {
    label: 'Purchases (admin)',
    path: '/purchases',
    role: 'admin',
    settled: (page) =>
      page
        .getByRole('button', { name: /Record purchase|Nueva compra|Add product/i })
        .first(),
  },
  {
    label: 'Orders (admin)',
    path: '/orders',
    role: 'admin',
    settled: (page) =>
      page
        .getByRole('button', { name: /Create order|Nueva orden|Add product/i })
        .first(),
  },
  {
    label: 'Quotations (admin)',
    path: '/quotations',
    role: 'admin',
    settled: (page) =>
      page.getByRole('button', { name: /New quotation|Nueva cotización/i }),
  },
  {
    label: 'Company (admin)',
    path: '/company',
    role: 'admin',
    // The page renders its title as an `<h1>` with `company.title` —
    // this is stable across tabs / sub-cards. (The previous selector
    // looked for an `<h2>` "Logo Library" inside one specific card,
    // which no longer matches the post-ENG-045 tabbed layout.)
    settled: (page) =>
      page.getByRole('main').getByRole('heading', { level: 1, name: /^Company$|^Empresa$/i }),
  },
  {
    label: 'Data import (admin)',
    path: '/data-import',
    role: 'admin',
    settled: (page) =>
      page.getByRole('main').getByRole('heading', { level: 1, name: /Import data|Importar datos/i }),
  },
  {
    label: 'Audit log (admin)',
    path: '/audit-logs',
    role: 'admin',
    settled: (page) => page.getByText(/Recent audit events|Eventos recientes/i),
  },
  {
    label: 'Day close (admin)',
    path: '/day-close',
    role: 'admin',
    settled: (page) => page.getByTestId('day-close-sales-section'),
  },
  // ENG-134g — module-gated surfaces. The e2e baseline force-enables
  // their modules (see `ensureModulesEnabled` in `e2e/shared/baseline.ts`)
  // so `SurfaceShellRoute` renders them instead of redirecting to
  // `/dashboard`. Admin reaches all of them (admin ∈ salesRoles and
  // managerOrAdminRoles). Each `settled` locator uses the surface root
  // `data-testid`, which is locale-agnostic and present across the
  // empty / loading / error states the retail seed produces.
  {
    label: 'Touch POS (admin)',
    path: '/touch',
    role: 'admin',
    settled: (page) => page.getByTestId('pos-touch-page'),
  },
  {
    label: 'Kitchen display (admin)',
    path: '/kds',
    role: 'admin',
    // KdsBoard renders per-state testids; with the retail seed (a site
    // is selected but there are no kitchen tickets) it shows the empty
    // state. Match either loaded state so axe scans the real DOM.
    settled: (page) =>
      page.locator('[data-testid="kds-board"], [data-testid="kds-empty-state"]'),
  },
  {
    label: 'Customer display (admin)',
    path: '/customer-display',
    role: 'admin',
    settled: (page) => page.getByTestId('surface-placeholder'),
  },
  {
    label: 'Mobile waiter (admin)',
    path: '/m',
    role: 'admin',
    settled: (page) => page.getByTestId('voice-ordering-screen'),
  },
  {
    label: 'Delivery (admin)',
    path: '/delivery',
    role: 'admin',
    settled: (page) => page.getByTestId('delivery-page'),
  },
];

test.describe('a11y smoke (WCAG 2 AA, serious-floor)', () => {
  for (const route of a11yRoutes) {
    test(`${route.label} has no serious axe violations`, async ({ page }) => {
      const tracker = attachClientIssueTracker(page);

      if (route.role === 'anon') {
        await resetSession(page);
        await page.goto(route.path);
      } else {
        await loginAs(page, route.role);
        if (!page.url().endsWith(route.path)) {
          await page.goto(route.path);
        }
      }

      await expect(route.settled(page)).toBeVisible({ timeout: 15_000 });

      await runAxeOnPage(page);

      await expectNoClientIssues(tracker);
    });
  }
});
