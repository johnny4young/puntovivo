/**
 * setupReadiness tRPC router.
 *
 * The public transport contract stays flat while the tenant overview and
 * cashier-selling projections live in focused builder modules.
 */
import { router } from '../init.js';
import { cashierManagerOrAdminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  checkoutReadinessInputSchema,
  checkoutReadinessOutputSchema,
  firstSaleReadinessInputSchema,
  firstSaleReadinessOutputSchema,
  setupReadinessOutputSchema,
  verticalReadinessOutputSchema,
} from '../schemas/setupReadiness.js';
import { buildReadiness } from './setupReadiness/overview.js';
import { buildCheckoutReadiness, buildFirstSaleReadiness } from './setupReadiness/selling.js';
import { buildVerticalReadiness } from './setupReadiness/vertical.js';

export const setupReadinessRouter = router({
  get: managerOrAdminProcedure.output(setupReadinessOutputSchema).query(async ({ ctx }) => {
    return buildReadiness({ db: ctx.db, tenantId: ctx.tenantId });
  }),

  vertical: managerOrAdminProcedure.output(verticalReadinessOutputSchema).query(async ({ ctx }) => {
    return buildVerticalReadiness({ db: ctx.db, tenantId: ctx.tenantId });
  }),

  /**
   * Cashier-facing readiness is site-validated. A missing sale sequential is
   * a blocker because checkout cannot allocate a valid document number;
   * degradations that do not compromise the sale remain warnings.
   */
  checkout: cashierManagerOrAdminProcedure
    .input(checkoutReadinessInputSchema)
    .output(checkoutReadinessOutputSchema)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return buildCheckoutReadiness({
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteId: input.siteId,
      });
    }),

  /**
   * shell-level first-sale onboarding is available to every selling
   * role and uses the shared tenant-site guard.
   */
  firstSale: cashierManagerOrAdminProcedure
    .input(firstSaleReadinessInputSchema)
    .output(firstSaleReadinessOutputSchema)
    .query(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return buildFirstSaleReadiness({
        db: ctx.db,
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        userId: ctx.user!.id,
      });
    }),
});

export type SetupReadinessRouter = typeof setupReadinessRouter;
