import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { useHeaderTitle } from '../useHeaderTitle';

function wrapperFor(pathname: string) {
  return function RouterWrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[pathname]}>{children}</MemoryRouter>;
  };
}

describe('useHeaderTitle', () => {
  it('maps workspace landing routes to their own header keys', () => {
    const cases = [
      ['/catalog', 'nav:header.catalog.title'],
      ['/procurement', 'nav:header.procurement.title'],
      ['/provider-payables', 'nav:items.providerPayables'],
      ['/finance', 'nav:header.finance.title'],
      ['/setup', 'nav:header.setup.title'],
      ['/design-system', 'nav:header.designSystem.title'],
      ['/data-import', 'nav:header.dataImport.title'],
      ['/day-close', 'nav:header.dayClose.title'],
      ['/schedule', 'nav:header.schedule.title'],
      ['/my-schedule', 'nav:header.mySchedule.title'],
    ] as const;

    for (const [pathname, titleKey] of cases) {
      const { result } = renderHook(() => useHeaderTitle(), {
        wrapper: wrapperFor(pathname),
      });
      expect(result.current.titleKey).toBe(titleKey);
    }
  });
});

// Literal pre-refactor contract, including the provider-payables alias.
const ROUTE_KEY_CASES = [
  ['/dashboard', 'nav:header.dashboard.kicker', 'nav:header.dashboard.title'],
  ['/co-pilot', 'nav:header.copilot.kicker', 'nav:header.copilot.title'],
  ['/settings/ai', 'nav:header.aiConfig.kicker', 'nav:header.aiConfig.title'],
  ['/sales', 'nav:header.sales.kicker', 'nav:header.sales.title'],
  ['/inventory', 'nav:header.inventory.kicker', 'nav:header.inventory.title'],
  ['/operations', 'nav:header.operations.kicker', 'nav:header.operations.title'],
  ['/day-close', 'nav:header.dayClose.kicker', 'nav:header.dayClose.title'],
  ['/my-schedule', 'nav:header.mySchedule.kicker', 'nav:header.mySchedule.title'],
  ['/schedule', 'nav:header.schedule.kicker', 'nav:header.schedule.title'],
  ['/catalog', 'nav:header.catalog.kicker', 'nav:header.catalog.title'],
  ['/procurement', 'nav:header.procurement.kicker', 'nav:header.procurement.title'],
  ['/finance', 'nav:header.finance.kicker', 'nav:header.finance.title'],
  ['/setup', 'nav:header.setup.kicker', 'nav:header.setup.title'],
  ['/orders', 'nav:header.orders.kicker', 'nav:header.orders.title'],
  ['/purchases', 'nav:header.purchases.kicker', 'nav:header.purchases.title'],
  ['/provider-payables', 'nav:header.procurement.kicker', 'nav:items.providerPayables'],
  ['/quotations', 'nav:header.quotations.kicker', 'nav:header.quotations.title'],
  ['/reservations', 'nav:header.reservations.kicker', 'nav:header.reservations.title'],
  ['/external-orders', 'nav:header.externalOrders.kicker', 'nav:header.externalOrders.title'],
  ['/delivery', 'nav:header.delivery.kicker', 'nav:header.delivery.title'],
  ['/customers', 'nav:header.customers.kicker', 'nav:header.customers.title'],
  ['/products', 'nav:header.products.kicker', 'nav:header.products.title'],
  ['/providers', 'nav:header.providers.kicker', 'nav:header.providers.title'],
  ['/categories', 'nav:header.categories.kicker', 'nav:header.categories.title'],
  ['/customer-catalogs', 'nav:header.customerCatalogs.kicker', 'nav:header.customerCatalogs.title'],
  ['/units', 'nav:header.units.kicker', 'nav:header.units.title'],
  ['/vat-rates', 'nav:header.vatRates.kicker', 'nav:header.vatRates.title'],
  ['/locations', 'nav:header.locations.kicker', 'nav:header.locations.title'],
  ['/geography', 'nav:header.geography.kicker', 'nav:header.geography.title'],
  [
    '/restaurants/modifiers',
    'nav:header.restaurantModifiers.kicker',
    'nav:header.restaurantModifiers.title',
  ],
  [
    '/restaurants/tables',
    'nav:header.restaurantTables.kicker',
    'nav:header.restaurantTables.title',
  ],
  ['/users', 'nav:header.users.kicker', 'nav:header.users.title'],
  ['/receipt-templates', 'nav:header.receiptTemplates.kicker', 'nav:header.receiptTemplates.title'],
  ['/peripherals', 'nav:header.peripherals.kicker', 'nav:header.peripherals.title'],
  ['/audit-logs', 'nav:header.auditLogs.kicker', 'nav:header.auditLogs.title'],
  ['/fiscal-documents', 'nav:header.fiscalDocuments.kicker', 'nav:header.fiscalDocuments.title'],
  ['/fiscal-reports', 'nav:header.fiscalReports.kicker', 'nav:header.fiscalReports.title'],
  ['/profitability', 'nav:header.profitability.kicker', 'nav:header.profitability.title'],
  ['/accounting-export', 'nav:header.accountingExport.kicker', 'nav:header.accountingExport.title'],
  ['/company', 'nav:header.company.kicker', 'nav:header.company.title'],
  ['/design-system', 'nav:header.designSystem.kicker', 'nav:header.designSystem.title'],
  ['/data-import', 'nav:header.dataImport.kicker', 'nav:header.dataImport.title'],
  ['/sites', 'nav:header.sites.kicker', 'nav:header.sites.title'],
  ['/sequentials', 'nav:header.sequentials.kicker', 'nav:header.sequentials.title'],
] as const;

describe('header registry representation parity', () => {
  it.each(ROUTE_KEY_CASES)(
    'preserves both header keys for %s and its nested/query routes',
    (route, kickerKey, titleKey) => {
      for (const path of [route, `${route}/detail`, `${route}?tab=history`]) {
        const view = renderHook(() => useHeaderTitle(), { wrapper: wrapperFor(path) });
        expect(view.result.current).toEqual({ kickerKey, titleKey });
        view.unmount();
      }
    }
  );
  it.each(['/sales-other', '/restaurants/modifiers-other', '/unknown'])(
    'does not match a partial segment at %s',
    path => {
      const { result } = renderHook(() => useHeaderTitle(), { wrapper: wrapperFor(path) });
      expect(result.current).toEqual({
        kickerKey: 'nav:header.fallback.kicker',
        titleKey: 'nav:header.fallback.title',
      });
    }
  );
});
