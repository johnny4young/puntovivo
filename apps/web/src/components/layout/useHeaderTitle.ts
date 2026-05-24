import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

interface HeaderTitleKeys {
  kickerKey: string;
  titleKey: string;
}

const FALLBACK: HeaderTitleKeys = {
  kickerKey: 'nav:header.fallback.kicker',
  titleKey: 'nav:header.fallback.title',
};

const ROUTE_TABLE: ReadonlyArray<{ prefix: string; entry: HeaderTitleKeys }> = [
  { prefix: '/dashboard', entry: { kickerKey: 'nav:header.dashboard.kicker', titleKey: 'nav:header.dashboard.title' } },
  { prefix: '/co-pilot', entry: { kickerKey: 'nav:header.copilot.kicker', titleKey: 'nav:header.copilot.title' } },
  { prefix: '/settings/ai', entry: { kickerKey: 'nav:header.aiConfig.kicker', titleKey: 'nav:header.aiConfig.title' } },
  { prefix: '/sales', entry: { kickerKey: 'nav:header.sales.kicker', titleKey: 'nav:header.sales.title' } },
  { prefix: '/inventory', entry: { kickerKey: 'nav:header.inventory.kicker', titleKey: 'nav:header.inventory.title' } },
  { prefix: '/operations', entry: { kickerKey: 'nav:header.operations.kicker', titleKey: 'nav:header.operations.title' } },
  { prefix: '/catalog', entry: { kickerKey: 'nav:header.catalog.kicker', titleKey: 'nav:header.catalog.title' } },
  { prefix: '/procurement', entry: { kickerKey: 'nav:header.procurement.kicker', titleKey: 'nav:header.procurement.title' } },
  { prefix: '/finance', entry: { kickerKey: 'nav:header.finance.kicker', titleKey: 'nav:header.finance.title' } },
  { prefix: '/orders', entry: { kickerKey: 'nav:header.orders.kicker', titleKey: 'nav:header.orders.title' } },
  { prefix: '/purchases', entry: { kickerKey: 'nav:header.purchases.kicker', titleKey: 'nav:header.purchases.title' } },
  { prefix: '/quotations', entry: { kickerKey: 'nav:header.quotations.kicker', titleKey: 'nav:header.quotations.title' } },
  { prefix: '/delivery', entry: { kickerKey: 'nav:header.delivery.kicker', titleKey: 'nav:header.delivery.title' } },
  { prefix: '/customers', entry: { kickerKey: 'nav:header.customers.kicker', titleKey: 'nav:header.customers.title' } },
  { prefix: '/products', entry: { kickerKey: 'nav:header.products.kicker', titleKey: 'nav:header.products.title' } },
  { prefix: '/providers', entry: { kickerKey: 'nav:header.providers.kicker', titleKey: 'nav:header.providers.title' } },
  { prefix: '/categories', entry: { kickerKey: 'nav:header.categories.kicker', titleKey: 'nav:header.categories.title' } },
  { prefix: '/customer-catalogs', entry: { kickerKey: 'nav:header.customerCatalogs.kicker', titleKey: 'nav:header.customerCatalogs.title' } },
  { prefix: '/units', entry: { kickerKey: 'nav:header.units.kicker', titleKey: 'nav:header.units.title' } },
  { prefix: '/vat-rates', entry: { kickerKey: 'nav:header.vatRates.kicker', titleKey: 'nav:header.vatRates.title' } },
  { prefix: '/locations', entry: { kickerKey: 'nav:header.locations.kicker', titleKey: 'nav:header.locations.title' } },
  { prefix: '/geography', entry: { kickerKey: 'nav:header.geography.kicker', titleKey: 'nav:header.geography.title' } },
  { prefix: '/restaurants/tables', entry: { kickerKey: 'nav:header.restaurantTables.kicker', titleKey: 'nav:header.restaurantTables.title' } },
  { prefix: '/users', entry: { kickerKey: 'nav:header.users.kicker', titleKey: 'nav:header.users.title' } },
  { prefix: '/receipt-templates', entry: { kickerKey: 'nav:header.receiptTemplates.kicker', titleKey: 'nav:header.receiptTemplates.title' } },
  { prefix: '/peripherals', entry: { kickerKey: 'nav:header.peripherals.kicker', titleKey: 'nav:header.peripherals.title' } },
  { prefix: '/audit-logs', entry: { kickerKey: 'nav:header.auditLogs.kicker', titleKey: 'nav:header.auditLogs.title' } },
  { prefix: '/fiscal-documents', entry: { kickerKey: 'nav:header.fiscalDocuments.kicker', titleKey: 'nav:header.fiscalDocuments.title' } },
  { prefix: '/fiscal-reports', entry: { kickerKey: 'nav:header.fiscalReports.kicker', titleKey: 'nav:header.fiscalReports.title' } },
  { prefix: '/company', entry: { kickerKey: 'nav:header.company.kicker', titleKey: 'nav:header.company.title' } },
  { prefix: '/sites', entry: { kickerKey: 'nav:header.sites.kicker', titleKey: 'nav:header.sites.title' } },
  { prefix: '/sequentials', entry: { kickerKey: 'nav:header.sequentials.kicker', titleKey: 'nav:header.sequentials.title' } },
];

export function useHeaderTitle(): HeaderTitleKeys {
  const { pathname } = useLocation();
  return useMemo(() => {
    const match = ROUTE_TABLE.find(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`));
    return match ? match.entry : FALLBACK;
  }, [pathname]);
}
