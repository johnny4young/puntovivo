/**
 * Inventory lots tRPC router (Auditoría 2026-07 — lots, expiry & costing).
 *
 * - `receive` (manager/admin) — record a received batch; increments an
 *   existing (site, product, lot) or inserts a new one, blending cost.
 * - `list` (tenant) — a product's lots at a site, FEFO-ordered.
 * - `expiring` (manager/admin) — lots with stock expiring within a window,
 *   for the ENG-199 radar. Tightened from tenant to manager/admin in ENG-199:
 *   the rows expose `unitCost` (owner data) and the only UI consumer,
 *   /inventory, is already role-gated the same way in App.tsx.
 * - `suggestDiscount` / `dismissSuggestion` / `activeSuggestions` (ENG-199)
 *   — the expiry-radar discount-suggestion lifecycle; logic in
 *   `services/price-suggestions.ts`. `activeSuggestions` stays tenant-wide
 *   because the POS badge is read by cashiers — its payload carries no cost.
 *
 * @module trpc/routers/inventoryLots
 */

import { and, eq } from 'drizzle-orm';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { products } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { assertTenantSite } from '../../services/devices/authority/helpers.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import {
  listExpiringLots,
  listLotsForProduct,
  receiveInventoryLot,
} from '../../services/inventory-lots/index.js';
import {
  createExpirySuggestion,
  dismissSuggestion,
  listActiveSuggestions,
} from '../../services/price-suggestions.js';
import { resolveDiscountSettings } from '../../services/discount-settings.js';
import {
  activeSuggestionsInput,
  dismissSuggestionInput,
  expiringLotsInput,
  listLotsInput,
  receiveLotInput,
  suggestDiscountInput,
} from '../schemas/inventoryLots.js';

export const inventoryLotsRouter = router({
  receive: managerOrAdminProcedure.input(receiveLotInput).mutation(async ({ ctx, input }) => {
    await assertTenantSite(ctx.db, ctx.tenantId, input.siteId);

    const product = await ctx.db
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
      .get();
    if (!product) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'LOT_PRODUCT_NOT_FOUND',
        message: 'Product not found for this tenant',
        details: { productId: input.productId },
      });
    }

    const now = new Date().toISOString();
    // Wrap the read-then-write (select + update/insert) in a transaction so a
    // lot receipt is atomic — the function is designed to run inside the
    // caller's transaction, and this keeps the blended-cost read consistent
    // if the DB backend ever allows the select and write to interleave.
    const result = ctx.db.transaction(tx =>
      receiveInventoryLot(tx, {
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        productId: input.productId,
        lotNumber: input.lotNumber,
        expiresAt: input.expiresAt ?? null,
        quantity: input.quantity,
        unitCost: input.unitCost,
        notes: input.notes ?? null,
        now,
      })
    );

    await enqueueSync(ctx, {
      entityType: 'inventory_lots',
      entityId: result.lotId,
      operation: result.created ? 'create' : 'update',
      data: {
        id: result.lotId,
        siteId: input.siteId,
        productId: input.productId,
        lotNumber: input.lotNumber,
        onHand: result.onHand,
        unitCost: result.unitCost,
      },
    });

    return result;
  }),

  list: tenantProcedure.input(listLotsInput).query(async ({ ctx, input }) => {
    const items = listLotsForProduct(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: input.siteId,
      productId: input.productId,
      activeOnly: input.activeOnly,
    });
    return { items };
  }),

  expiring: managerOrAdminProcedure.input(expiringLotsInput).query(async ({ ctx, input }) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const cutoff = new Date(now.getTime() + input.withinDays * 24 * 60 * 60 * 1000).toISOString();
    const items = listExpiringLots(ctx.db, {
      tenantId: ctx.tenantId,
      nowIso,
      cutoffIso: cutoff,
      ...(input.siteId ? { siteId: input.siteId } : {}),
    });
    return { items, cutoff };
  }),

  /**
   * ENG-199 — accept the radar CTA for a lot. The discount percent comes
   * from the server-side expiry tiers; multi-tenant scoping, eligibility,
   * the race-safe duplicate guard, and the audit row live in the service.
   */
  suggestDiscount: managerOrAdminProcedure
    .input(suggestDiscountInput)
    .mutation(async ({ ctx, input }) => {
      // ENG-211 — the tenant's tuned ladder decides the percent; the
      // service keeps computing it server-side (the client never picks).
      const { expiryTiers } = await resolveDiscountSettings(ctx.db, ctx.tenantId);
      return createExpirySuggestion(ctx.db, {
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        lotId: input.lotId,
        tiers: expiryTiers,
      });
    }),

  /** ENG-199 — retire an active suggestion (audited). */
  dismissSuggestion: managerOrAdminProcedure
    .input(dismissSuggestionInput)
    .mutation(async ({ ctx, input }) => {
      dismissSuggestion(ctx.db, {
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        suggestionId: input.suggestionId,
      });
      return { dismissed: true };
    }),

  /**
   * ENG-199 — the active suggestions the POS badge and the radar share.
   * Tenant-wide on purpose (cashiers read it); the payload carries no cost
   * fields — see `listActiveSuggestions`.
   */
  activeSuggestions: tenantProcedure.input(activeSuggestionsInput).query(async ({ ctx, input }) => {
    if (input?.siteId) {
      await assertTenantSite(ctx.db, ctx.tenantId, input.siteId);
    }
    const items = listActiveSuggestions(ctx.db, {
      tenantId: ctx.tenantId,
      ...(input?.siteId ? { siteId: input.siteId } : {}),
    });
    return { items };
  }),
});
