import { useMemo } from 'react';
import { useLocation } from 'react-router';

interface HeaderTitleKeys {
  kickerKey: string;
  titleKey: string;
}

const FALLBACK: HeaderTitleKeys = {
  kickerKey: 'nav:header.fallback.kicker',
  titleKey: 'nav:header.fallback.title',
};

/** Store each translation namespace once; preserve ordered route matching and explicit aliases. */
const ROUTE_TABLE: ReadonlyArray<
  readonly [prefix: string, section: string, titleOverride?: string]
> = [
  ['/dashboard', 'dashboard'],
  ['/co-pilot', 'copilot'],
  ['/settings/ai', 'aiConfig'],
  ['/sales', 'sales'],
  ['/inventory', 'inventory'],
  ['/operations', 'operations'],
  ['/day-close', 'dayClose'],
  ['/my-schedule', 'mySchedule'],
  ['/schedule', 'schedule'],
  ['/catalog', 'catalog'],
  ['/procurement', 'procurement'],
  ['/finance', 'finance'],
  ['/setup', 'setup'],
  ['/orders', 'orders'],
  ['/purchases', 'purchases'],
  ['/provider-payables', 'procurement', 'nav:items.providerPayables'],
  ['/quotations', 'quotations'],
  ['/reservations', 'reservations'],
  ['/external-orders', 'externalOrders'],
  ['/delivery', 'delivery'],
  ['/customers', 'customers'],
  ['/products', 'products'],
  ['/providers', 'providers'],
  ['/categories', 'categories'],
  ['/customer-catalogs', 'customerCatalogs'],
  ['/units', 'units'],
  ['/vat-rates', 'vatRates'],
  ['/locations', 'locations'],
  ['/geography', 'geography'],
  ['/restaurants/modifiers', 'restaurantModifiers'],
  ['/restaurants/tables', 'restaurantTables'],
  ['/users', 'users'],
  ['/receipt-templates', 'receiptTemplates'],
  ['/peripherals', 'peripherals'],
  ['/audit-logs', 'auditLogs'],
  ['/fiscal-documents', 'fiscalDocuments'],
  ['/fiscal-reports', 'fiscalReports'],
  ['/profitability', 'profitability'],
  ['/accounting-export', 'accountingExport'],
  ['/company', 'company'],
  ['/design-system', 'designSystem'],
  ['/data-import', 'dataImport'],
  ['/sites', 'sites'],
  ['/sequentials', 'sequentials'],
];

export function useHeaderTitle(): HeaderTitleKeys {
  const { pathname } = useLocation();
  return useMemo(() => {
    const match = ROUTE_TABLE.find(
      ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`)
    );
    return match
      ? {
          kickerKey: `nav:header.${match[1]}.kicker`,
          titleKey: match[2] ?? `nav:header.${match[1]}.title`,
        }
      : FALLBACK;
  }, [pathname]);
}
