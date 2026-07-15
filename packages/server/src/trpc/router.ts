/**
 * Root tRPC Router
 *
 * Combines all tRPC routers
 */

import { router, publicProcedure } from './init.js';
import { authRouter } from './routers/auth/index.js';
import { categoriesRouter } from './routers/categories.js';
import { cashSessionsRouter } from './routers/cashSessions.js';
import { companiesRouter } from './routers/companies.js';
import {
  clientTypesRouter,
  commercialActivitiesRouter,
  identificationTypesRouter,
  personTypesRouter,
  regimeTypesRouter,
} from './routers/customerCatalogs.js';
import { dashboardRouter } from './routers/dashboard.js';
import { citiesRouter, countriesRouter, departmentsRouter } from './routers/geography/index.js';
import { logosRouter } from './routers/logos.js';
import { providersRouter } from './routers/providers.js';
import { productsRouter } from './routers/products/index.js';
import { ordersRouter } from './routers/orders/index.js';
import { purchasesRouter } from './routers/purchases.js';
import { sequentialsRouter } from './routers/sequentials.js';
import { unitsRouter } from './routers/units.js';
import { usersRouter } from './routers/users.js';
import { vatRatesRouter } from './routers/vatRates.js';
import { customersRouter } from './routers/customers.js';
import { salesRouter } from './routers/sales/index.js';
import { inventoryRouter } from './routers/inventory/index.js';
import { inventoryLotsRouter } from './routers/inventoryLots.js';
import { locationsRouter } from './routers/locations.js';
import { sitesRouter } from './routers/sites.js';
import { syncRouter } from './routers/sync/index.js';
import { transfersRouter } from './routers/transfers.js';
import { quotationsRouter } from './routers/quotations.js';
import { receiptTemplatesRouter } from './routers/receiptTemplates.js';
import { auditLogsRouter } from './routers/auditLogs.js';
import { tenantLocaleRouter } from './routers/tenantLocale.js';
import { reportsRouter } from './routers/reports/index.js';
import { aiRouter } from './routers/ai/index.js';
import { fiscalSettingsRouter } from './routers/fiscal-settings.js';
import { peripheralsRouter } from './routers/peripherals/index.js';
import { modulesRouter } from './routers/modules.js';
import { surfacesRouter } from './routers/surfaces.js';
import { eventsRouter } from './routers/events.js';
import { observabilityRouter } from './routers/observability.js';
import { authorityRouter } from './routers/authority.js';
import { paymentsRouter } from './routers/payments.js';
import { paymentSettingsRouter } from './routers/payments-settings.js';
import { restaurantTablesRouter } from './routers/restaurantTables.js';
import { restaurantSettingsRouter } from './routers/restaurantSettings.js';
import { cashCloseSettingsRouter } from './routers/cashCloseSettings.js';
import { kdsRouter } from './routers/kds.js';
import { customerLedgerRouter } from './routers/customerLedger.js';
import { deliveryOrdersRouter } from './routers/deliveryOrders.js';
import { whatsNewRouter } from './routers/whatsNew.js';
import { uploadRouter } from './routers/upload.js';
import { setupReadinessRouter } from './routers/setupReadiness.js';
import { operationsRouter } from './routers/operations.js';
import { dataRetentionRouter } from './routers/dataRetention.js';
import { employeeShiftsRouter } from './routers/employeeShifts.js';

export const appRouter = router({
  health: router({
    check: publicProcedure.query(() => {
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        message: 'tRPC is working correctly',
      };
    }),
  }),
  auth: authRouter,
  cashSessions: cashSessionsRouter,
  companies: companiesRouter,
  countries: countriesRouter,
  identificationTypes: identificationTypesRouter,
  personTypes: personTypesRouter,
  regimeTypes: regimeTypesRouter,
  clientTypes: clientTypesRouter,
  commercialActivities: commercialActivitiesRouter,
  dashboard: dashboardRouter,
  departments: departmentsRouter,
  cities: citiesRouter,
  logos: logosRouter,
  providers: providersRouter,
  sequentials: sequentialsRouter,
  units: unitsRouter,
  vatRates: vatRatesRouter,
  categories: categoriesRouter,
  products: productsRouter,
  orders: ordersRouter,
  customers: customersRouter,
  purchases: purchasesRouter,
  sales: salesRouter,
  inventory: inventoryRouter,
  inventoryLots: inventoryLotsRouter,
  locations: locationsRouter,
  sites: sitesRouter,
  sync: syncRouter,
  transfers: transfersRouter,
  quotations: quotationsRouter,
  receiptTemplates: receiptTemplatesRouter,
  auditLogs: auditLogsRouter,
  users: usersRouter,
  tenantLocale: tenantLocaleRouter,
  reports: reportsRouter,
  ai: aiRouter,
  fiscalSettings: fiscalSettingsRouter,
  peripherals: peripheralsRouter,
  modules: modulesRouter,
  surfaces: surfacesRouter,
  events: eventsRouter,
  observability: observabilityRouter,
  authority: authorityRouter,
  payments: paymentsRouter,
  paymentSettings: paymentSettingsRouter,
  restaurantTables: restaurantTablesRouter,
  restaurantSettings: restaurantSettingsRouter,
  cashCloseSettings: cashCloseSettingsRouter,
  kds: kdsRouter,
  customerLedger: customerLedgerRouter,
  deliveryOrders: deliveryOrdersRouter,
  whatsNew: whatsNewRouter,
  upload: uploadRouter,
  setupReadiness: setupReadinessRouter,
  operations: operationsRouter,
  dataRetention: dataRetentionRouter,
  employeeShifts: employeeShiftsRouter,
});

export type AppRouter = typeof appRouter;
