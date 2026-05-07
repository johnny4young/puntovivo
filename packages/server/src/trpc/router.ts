/**
 * Root tRPC Router
 *
 * Combines all tRPC routers
 */

import { router, publicProcedure } from './init.js';
import { authRouter } from './routers/auth.js';
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
import { citiesRouter, countriesRouter, departmentsRouter } from './routers/geography.js';
import { logosRouter } from './routers/logos.js';
import { providersRouter } from './routers/providers.js';
import { productsRouter } from './routers/products.js';
import { ordersRouter } from './routers/orders.js';
import { purchasesRouter } from './routers/purchases.js';
import { sequentialsRouter } from './routers/sequentials.js';
import { unitsRouter } from './routers/units.js';
import { usersRouter } from './routers/users.js';
import { vatRatesRouter } from './routers/vatRates.js';
import { customersRouter } from './routers/customers.js';
import { salesRouter } from './routers/sales.js';
import { inventoryRouter } from './routers/inventory.js';
import { locationsRouter } from './routers/locations.js';
import { sitesRouter } from './routers/sites.js';
import { syncRouter } from './routers/sync.js';
import { transfersRouter } from './routers/transfers.js';
import { quotationsRouter } from './routers/quotations.js';
import { receiptTemplatesRouter } from './routers/receiptTemplates.js';
import { auditLogsRouter } from './routers/auditLogs.js';
import { tenantLocaleRouter } from './routers/tenantLocale.js';
import { reportsRouter } from './routers/reports/index.js';
import { aiRouter } from './routers/ai.js';
import { fiscalSettingsRouter } from './routers/fiscal-settings.js';
import { peripheralsRouter } from './routers/peripherals.js';
import { modulesRouter } from './routers/modules.js';

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
});

export type AppRouter = typeof appRouter;
