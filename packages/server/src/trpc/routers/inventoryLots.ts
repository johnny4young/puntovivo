/**
 * Inventory lots tRPC router (Auditoría 2026-07 — lots, expiry & costing).
 *
 * - `receive` (critical manager/admin) — atomically record a received batch;
 * increments an existing (site, product, lot) or inserts a new one, blending cost.
 * - `list` (manager/admin) — a product's lots at a site, FEFO-ordered; the
 * payload includes unit cost and frozen custody metadata.
 * - `expiring` (manager/admin) — lots with stock expiring within a window
 * for the radar. The rows expose `unitCost` (owner data) and the only UI
 * consumer, /inventory, is already role-gated the same way in App.tsx.
 * - `suggestDiscount` / `dismissSuggestion` / `activeSuggestions` —
 * the expiry-radar discount-suggestion lifecycle; logic lives in
 * `services/price-suggestions.ts`. `activeSuggestions` stays tenant-wide
 * because the POS badge is read by cashiers — its payload carries no cost.
 *
 * @module trpc/routers/inventoryLots
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { roundQuantity } from '@puntovivo/shared/unit-math';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { inventoryMovements, pharmacyProductProfiles, products, sites } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  applyInventoryBalanceDelta,
  getProductStockTotal,
} from '../../services/inventory-balances.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import {
  listExpiringLots,
  listLotsForProduct,
  receiveInventoryLot,
} from '../../services/inventory-lots/index.js';
import { assertCatalogStockMutationAllowed } from '../../services/products/lot-tracking.js';
import {
  createExpirySuggestion,
  dismissSuggestion,
  listActiveSuggestions,
} from '../../services/price-suggestions.js';
import { resolveDiscountSettings } from '../../services/discount-settings.js';
import {
  assertTenantBusinessClockCurrent,
  resolveTenantBusinessClock,
  writeInventoryLotEvent,
} from '../../services/pharmacy/index.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { addCalendarDays } from '../../services/reports/day-window.js';
import {
  activeSuggestionsInput,
  dismissSuggestionInput,
  expiringLotsInput,
  listLotsInput,
  receiveLotInput,
  suggestDiscountInput,
} from '../schemas/inventoryLots.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { criticalCommandManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  applyRecallCustodyOverlays,
  findActiveRecallOverlaysForLot,
} from '../../services/pharmacy/transfer-custody.js';

export const inventoryLotsRouter = router({
  receive: criticalCommandManagerOrAdminProcedure
    .input(receiveLotInput)
    .mutation(async ({ ctx, input }) => {
      const criticalCtx = asCriticalCommandContext(ctx);
      await ensureTenantSite(criticalCtx.db, criticalCtx.tenantId, input.siteId);
      const businessClock = await resolveTenantBusinessClock(criticalCtx.db, criticalCtx.tenantId);
      const now = businessClock.nowIso;
      const receivedQuantity = roundQuantity(input.quantity, 12);
      const movementId = nanoid();
      // The immediate writer reservation closes the product/site TOCTOU and
      // keeps the lot, balance, movement, outbox and command result atomic.
      return criticalCtx.db.transaction(
        tx => {
          assertTenantBusinessClockCurrent(tx, criticalCtx.tenantId, businessClock);
          const activeSite = tx
            .select({ id: sites.id })
            .from(sites)
            .where(
              and(
                eq(sites.id, input.siteId),
                eq(sites.tenantId, criticalCtx.tenantId),
                eq(sites.isActive, true)
              )
            )
            .get();
          if (!activeSite) {
            throwServerError({
              trpcCode: 'NOT_FOUND',
              errorCode: 'AUTHORITY_SITE_NOT_FOUND',
              message: 'Inventory site was not found or is inactive for this tenant',
              details: { siteId: input.siteId },
            });
          }

          const product = tx
            .select({
              id: products.id,
              tracksLots: products.tracksLots,
              catalogType: products.catalogType,
              pharmacyProductId: pharmacyProductProfiles.productId,
            })
            .from(products)
            .leftJoin(
              pharmacyProductProfiles,
              and(
                eq(pharmacyProductProfiles.productId, products.id),
                eq(pharmacyProductProfiles.tenantId, criticalCtx.tenantId)
              )
            )
            .where(
              and(eq(products.id, input.productId), eq(products.tenantId, criticalCtx.tenantId))
            )
            .get();
          if (!product) {
            throwServerError({
              trpcCode: 'NOT_FOUND',
              errorCode: 'LOT_PRODUCT_NOT_FOUND',
              message: 'Product not found for this tenant',
              details: { productId: input.productId },
            });
          }
          assertCatalogStockMutationAllowed({
            catalogType: product.catalogType,
            delta: input.quantity,
          });
          if (!product.tracksLots) {
            throwServerError({
              trpcCode: 'BAD_REQUEST',
              errorCode: 'PRODUCT_LOT_TRACKING_REQUIRED',
              message: 'Lot tracking must be enabled before receiving a lot',
              details: { productId: input.productId },
            });
          }

          const syncContext = {
            tenantId: criticalCtx.tenantId,
            envelope: criticalCtx.envelope,
            deviceId: criticalCtx.deviceId,
          };
          const previousStock = getProductStockTotal(tx, criticalCtx.tenantId, input.productId);
          let lot = receiveInventoryLot(tx, {
            tenantId: criticalCtx.tenantId,
            siteId: input.siteId,
            productId: input.productId,
            lotNumber: input.lotNumber,
            expiresAt: input.expiresAt ?? null,
            quantity: input.quantity,
            unitCost: input.unitCost,
            notes: input.notes ?? null,
            now,
            businessDate: businessClock.businessDate,
          });
          if (product.pharmacyProductId) {
            writeInventoryLotEvent(tx, syncContext, {
              tenantId: criticalCtx.tenantId,
              siteId: input.siteId,
              productId: input.productId,
              lotId: lot.lotId,
              eventType: 'activation',
              previousStatus: lot.previousStatus,
              nextStatus: lot.status,
              quantitySnapshot: lot.onHand,
              reason: input.notes ?? 'Inventory lot receipt',
              referenceType: 'inventory_lot_receipt',
              referenceId: movementId,
              actorId: criticalCtx.user.id,
              occurredAt: now,
            });
            const recallOverlays = findActiveRecallOverlaysForLot(tx, {
              tenantId: criticalCtx.tenantId,
              lotId: lot.lotId,
            });
            if (recallOverlays.length > 0) {
              lot = {
                ...lot,
                status: applyRecallCustodyOverlays(tx, syncContext, {
                  tenantId: criticalCtx.tenantId,
                  destinationLotId: lot.lotId,
                  recallOverlays,
                  actorId: criticalCtx.user.id,
                  occurredAt: now,
                }),
              };
            }
          }
          applyInventoryBalanceDelta(tx, {
            tenantId: criticalCtx.tenantId,
            siteId: input.siteId,
            productId: input.productId,
            delta: receivedQuantity,
            initialOnHandIfMissing: 0,
            now,
          });
          // Use the committed rollup instead of recomputing with raw IEEE-754
          // arithmetic. The balance boundary rounds quantities to 12 decimals;
          // movement and audit snapshots must describe that same value.
          const newStock = getProductStockTotal(tx, criticalCtx.tenantId, input.productId);
          tx.insert(inventoryMovements)
            .values({
              id: movementId,
              tenantId: criticalCtx.tenantId,
              productId: input.productId,
              siteId: input.siteId,
              type: 'purchase',
              quantity: receivedQuantity,
              previousStock,
              newStock,
              reference: lot.lotId,
              notes: input.notes ?? `Lot receipt ${input.lotNumber}`,
              createdBy: criticalCtx.user.id,
              syncStatus: 'pending',
              syncVersion: 1,
              createdAt: now,
            })
            .run();
          writeAuditLog({
            tx,
            tenantId: criticalCtx.tenantId,
            actorId: criticalCtx.user.id,
            action: 'inventory.adjust_stock',
            resourceType: 'product',
            resourceId: input.productId,
            before: { stock: previousStock },
            after: { stock: newStock },
            metadata: {
              source: 'inventory_lot_receipt',
              siteId: input.siteId,
              lotId: lot.lotId,
              movementId,
              quantity: receivedQuantity,
            },
            operationId: criticalCtx.envelope.operationId,
          });
          enqueueSyncInTransaction(
            { db: tx, ...syncContext },
            {
              entityType: 'inventory_lots',
              entityId: lot.lotId,
              operation: lot.created ? 'create' : 'update',
              data: {
                id: lot.lotId,
                siteId: input.siteId,
                productId: input.productId,
                lotNumber: input.lotNumber,
                onHand: lot.onHand,
                unitCost: lot.unitCost,
                status: lot.status,
              },
            }
          );
          enqueueSyncInTransaction(
            { db: tx, ...syncContext },
            {
              entityType: 'inventory_movements',
              entityId: movementId,
              operation: 'create',
              data: {
                id: movementId,
                productId: input.productId,
                lotId: lot.lotId,
                quantity: receivedQuantity,
              },
            }
          );
          criticalCtx.completeInTransaction(tx, lot);
          return lot;
        },
        { behavior: 'immediate' }
      );
    }),

  list: managerOrAdminProcedure.input(listLotsInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    const items = listLotsForProduct(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: input.siteId,
      productId: input.productId,
      activeOnly: input.activeOnly,
    });
    return { items };
  }),

  expiring: managerOrAdminProcedure.input(expiringLotsInput).query(async ({ ctx, input }) => {
    if (input.siteId) {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    }
    const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
    const cutoff = new Date(
      Date.parse(clock.nowIso) + input.withinDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const cutoffBusinessDate = addCalendarDays(clock.businessDate, input.withinDays);
    const items = listExpiringLots(ctx.db, {
      tenantId: ctx.tenantId,
      nowIso: clock.nowIso,
      cutoffIso: cutoff,
      businessDate: clock.businessDate,
      cutoffBusinessDate,
      ...(input.siteId ? { siteId: input.siteId } : {}),
    });
    return { items, cutoff };
  }),

  /**
   * accept the radar CTA for a lot. The discount percent comes
   * from the server-side expiry tiers; multi-tenant scoping, eligibility,
   * the race-safe duplicate guard, and the audit row live in the service.
   */
  suggestDiscount: managerOrAdminProcedure
    .input(suggestDiscountInput)
    .mutation(async ({ ctx, input }) => {
      // the tenant's tuned ladder decides the percent; the
      // service keeps computing it server-side (the client never picks).
      const { expiryTiers } = await resolveDiscountSettings(ctx.db, ctx.tenantId);
      const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
      return createExpirySuggestion(ctx.db, {
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        lotId: input.lotId,
        tiers: expiryTiers,
        nowIso: clock.nowIso,
        businessDate: clock.businessDate,
        timezone: clock.timezone,
        countryCode: clock.countryCode,
        localeVersion: clock.localeVersion,
      });
    }),

  /** retire an active suggestion (audited). */
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
   * the active suggestions the POS badge and the radar share.
   * Tenant-wide on purpose (cashiers read it); the payload carries no cost
   * fields — see `listActiveSuggestions`.
   */
  activeSuggestions: tenantProcedure.input(activeSuggestionsInput).query(async ({ ctx, input }) => {
    if (input?.siteId) {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    }
    const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
    const items = listActiveSuggestions(ctx.db, {
      tenantId: ctx.tenantId,
      ...(input?.siteId ? { siteId: input.siteId } : {}),
      nowIso: clock.nowIso,
      businessDate: clock.businessDate,
    });
    return { items };
  }),
});
