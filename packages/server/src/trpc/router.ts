/**
 * Root tRPC Router
 *
 * Combines all tRPC routers
 */

import { router, publicProcedure } from './init.js';
import { authRouter } from './routers/auth.js';
import { categoriesRouter } from './routers/categories.js';
import { productsRouter } from './routers/products.js';
import { customersRouter } from './routers/customers.js';
import { salesRouter } from './routers/sales.js';
import { inventoryRouter } from './routers/inventory.js';
import { sitesRouter } from './routers/sites.js';
import { syncRouter } from './routers/sync.js';

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
  categories: categoriesRouter,
  products: productsRouter,
  customers: customersRouter,
  sales: salesRouter,
  inventory: inventoryRouter,
  sites: sitesRouter,
  sync: syncRouter,
});

export type AppRouter = typeof appRouter;
