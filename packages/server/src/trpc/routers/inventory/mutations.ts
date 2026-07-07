/**
 * Inventory router — write procedures (ENG-178 split).
 *
 * The four tenant-scoped mutations: `recordEntry` (initial / physical-count
 * entry + atomic stock update), `createMovement` (typed movement + stock
 * delta), `adjustStock` (absolute set, critical-command gated, per-site
 * balance reconciliation + audit), and `reconcileBalances` (admin heal-up
 * tool). Spread into the router barrel.
 *
 * @module trpc/routers/inventory/mutations
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { adminProcedure, managerOrAdminProcedure } from '../../middleware/roles.js';
import { criticalCommandManagerOrAdminProcedure } from '../../middleware/criticalCommand.js';
import { asCriticalCommandContext } from '../../middleware/commandEnvelope.js';
import {
  initialInventory,
  inventoryMovements,
  products,
  sites,
  units,
} from '../../../db/schema.js';
import { enqueueSync } from '../../../services/sync/enqueue.js';
import {
  applyInventoryBalanceDelta,
  ensurePrimaryInventoryBalanceSnapshot,
  getPrimarySiteId,
  getProductStockTotal,
  reconcileProductStockFromBalances,
} from '../../../services/inventory-balances.js';
import { writeAuditLog } from '../../../services/audit-logs.js';
import { roundMoney } from '../../../lib/money.js';
import {
  adjustStockInput,
  createMovementInput,
  recordEntryInput,
} from '../../schemas/inventory.js';
import {
  getNormalizedInventoryQuantity,
  getProductForInventory,
  getProductUnitAssignment,
  lookupInventoryJournalEventId,
  safeUpdateInventoryAdjustedSummary,
} from './helpers.js';

export const inventoryMutationProcedures = {
  /**
   * Record an initial inventory or physical-count entry and update stock atomically.
   */
  recordEntry: managerOrAdminProcedure.input(recordEntryInput).mutation(async ({ ctx, input }) => {
    const product = await getProductForInventory(ctx.db, ctx.tenantId, input.productId);
    const unitAssignment = await getProductUnitAssignment(ctx.db, input.productId, input.unitId);
    const normalizedQuantity = getNormalizedInventoryQuantity(input.quantity, unitAssignment.equivalence);
    const cost = roundMoney(input.cost);
    const now = new Date().toISOString();
    const entryId = nanoid();
    const movementId = nanoid();
    // Tenant-wide stock is derived from Σ(inventory_balances.on_hand); read the
    // pre-mutation total to compute the movement snapshot and the balance delta.
    const previousStock = getProductStockTotal(ctx.db, ctx.tenantId, input.productId);
    const newStock =
      input.mode === 'initial' ? previousStock + normalizedQuantity : normalizedQuantity;
    const stockDelta = newStock - previousStock;

    ctx.db.transaction(tx => {
      tx.insert(initialInventory)
        .values({
          id: entryId,
          tenantId: ctx.tenantId,
          productId: input.productId,
          unitId: input.unitId,
          siteId: ctx.siteId,
          mode: input.mode,
          quantity: input.quantity,
          unitEquivalence: unitAssignment.equivalence,
          normalizedQuantity,
          cost,
          previousStock,
          newStock,
          notes: input.notes,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();

      tx.insert(inventoryMovements)
        .values({
          id: movementId,
          tenantId: ctx.tenantId,
          productId: input.productId,
          type: 'adjustment',
          quantity: Math.abs(stockDelta),
          previousStock,
          newStock,
          reference: entryId,
          notes:
            input.notes ??
            (input.mode === 'initial' ? 'Initial inventory entry' : 'Physical inventory count'),
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();

      // Persist the entry's cost baseline on the product. Stock itself is no
      // longer a product column — it is applied to inventory_balances below.
      tx.update(products)
        .set({
          initialCost: cost,
          syncStatus: 'pending',
          syncVersion: (product.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(products.id, input.productId))
        .run();

      // Phase 2 API-103 step 3: apply the same stockDelta to the operator
      // site's balance — the single source of truth. `ctx.siteId` is the
      // entry's site (also persisted on `initial_inventory.siteId`); falsy
      // values no-op. When no site context exists, fall back to the primary
      // site so the entry still lands somewhere authoritative.
      const primarySiteIdForEntry = getPrimarySiteId(tx, ctx.tenantId);
      const entrySiteId = ctx.siteId ?? primarySiteIdForEntry;
      if (entrySiteId) {
        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: entrySiteId,
          productId: input.productId,
          delta: stockDelta,
          initialOnHandIfMissing:
            entrySiteId === primarySiteIdForEntry ? previousStock : 0,
          now,
        });
      }

    });

    await enqueueSync(ctx, {
      entityType: 'initial_inventory',
      entityId: entryId,
      operation: 'create',
      data: {
        id: entryId,
        productId: input.productId,
        unitId: input.unitId,
        mode: input.mode,
        normalizedQuantity,
        newStock,
      },
    });

    const created = await ctx.db
      .select({
        id: initialInventory.id,
        tenantId: initialInventory.tenantId,
        productId: initialInventory.productId,
        unitId: initialInventory.unitId,
        siteId: initialInventory.siteId,
        mode: initialInventory.mode,
        quantity: initialInventory.quantity,
        unitEquivalence: initialInventory.unitEquivalence,
        normalizedQuantity: initialInventory.normalizedQuantity,
        cost: initialInventory.cost,
        previousStock: initialInventory.previousStock,
        newStock: initialInventory.newStock,
        notes: initialInventory.notes,
        createdBy: initialInventory.createdBy,
        syncStatus: initialInventory.syncStatus,
        syncVersion: initialInventory.syncVersion,
        createdAt: initialInventory.createdAt,
        productName: products.name,
        productSku: products.sku,
        unitName: units.name,
        unitAbbreviation: units.abbreviation,
        siteName: sites.name,
      })
      .from(initialInventory)
      .innerJoin(products, eq(initialInventory.productId, products.id))
      .innerJoin(units, eq(initialInventory.unitId, units.id))
      .leftJoin(sites, eq(initialInventory.siteId, sites.id))
      .where(eq(initialInventory.id, entryId))
      .get();

    return created!;
  }),

  /**
   * Create an inventory movement and update product stock atomically.
   *
   * - For 'purchase'/'return': adds quantity to stock
   * - For 'sale'/'transfer': subtracts quantity from stock
   * - For 'adjustment': treated as an add (use adjustStock for absolute set)
   */
  createMovement: managerOrAdminProcedure.input(createMovementInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();

    // Validate product belongs to tenant
    const product = await ctx.db
      .select()
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!product) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    // Determine stock change direction. Tenant-wide stock is derived from
    // Σ(inventory_balances.on_hand); read the pre-mutation total.
    const previousStock = getProductStockTotal(ctx.db, ctx.tenantId, input.productId);
    const isDeduction = input.type === 'sale' || input.type === 'transfer';
    const newStock = isDeduction ? previousStock - input.quantity : previousStock + input.quantity;

    if (newStock < 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Insufficient stock. Available: ${previousStock}, requested: ${input.quantity}`,
      });
    }

    const movementId = nanoid();
    const stockDelta = newStock - previousStock;

    // better-sqlite3 requires a synchronous transaction callback
    ctx.db.transaction(tx => {
      // Create movement record
      tx.insert(inventoryMovements)
        .values({
          id: movementId,
          tenantId: ctx.tenantId,
          productId: input.productId,
          type: input.type,
          quantity: input.quantity,
          previousStock,
          newStock,
          reference: input.reference,
          notes: input.notes,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();

      // Apply the delta to inventory_balances — the single source of truth.
      // Route to the operator site when present, else the primary site.
      const primarySiteId = getPrimarySiteId(tx, ctx.tenantId);
      const movementSiteId = ctx.siteId ?? primarySiteId;
      if (movementSiteId) {
        applyInventoryBalanceDelta(tx, {
          tenantId: ctx.tenantId,
          siteId: movementSiteId,
          productId: input.productId,
          delta: stockDelta,
          initialOnHandIfMissing:
            movementSiteId === primarySiteId ? previousStock : 0,
          now,
        });
      }

    });

    await enqueueSync(ctx, {
      entityType: 'inventory_movements',
      entityId: movementId,
      operation: 'create',
      data: { id: movementId, productId: input.productId, newStock },
    });

    const created = await ctx.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.id, movementId))
      .get();

    return created!;
  }),

  /**
   * Set a product's stock to an absolute value (admin only).
   * Creates an 'adjustment' movement record.
   */
  adjustStock: criticalCommandManagerOrAdminProcedure.input(adjustStockInput).mutation(async ({ ctx, input }) => {
    // Validates the product exists and is active (throws otherwise).
    await getProductForInventory(ctx.db, ctx.tenantId, input.productId);

    const now = new Date().toISOString();
    const movementId = nanoid();
    // Tenant-wide stock is derived from Σ(inventory_balances.on_hand).
    const previousStock = getProductStockTotal(ctx.db, ctx.tenantId, input.productId);
    const delta = input.newStock - previousStock;
    const quantity = Math.abs(delta);
    let resolvedAdjustmentSiteId: string | null = null;

    // Validate the explicit siteId (if provided) belongs to the tenant and is
    // active. We do this outside the transaction because the check is a pure
    // read and `throwServerError` would just roll back an untouched tx.
    if (input.siteId) {
      const targetSite = await ctx.db
        .select({ id: sites.id, isActive: sites.isActive })
        .from(sites)
        .where(and(eq(sites.id, input.siteId), eq(sites.tenantId, ctx.tenantId)))
        .get();

      if (!targetSite || targetSite.isActive === false) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Selected adjustment site was not found or is inactive',
        });
      }
    }

    // better-sqlite3 requires a synchronous transaction callback
    ctx.db.transaction(tx => {
      // Phase 2 API-103 step 3: resolve the site to apply the balance delta
      // to. Priority: explicit input > cashier/operator site > primary site.
      // If the tenant has zero active sites, `resolvedSiteId` is null and the
      // balance write silently no-ops (legacy path). `primarySiteId` is also
      // reused below for the migration-rule seed decision.
      const primarySiteId = getPrimarySiteId(tx, ctx.tenantId);
      const resolvedSiteId = input.siteId ?? ctx.siteId ?? primarySiteId;
      resolvedAdjustmentSiteId = resolvedSiteId;

      // When adjusting a non-primary site, first snapshot the primary site
      // with the PRE-adjustment aggregate so a later read still shows the
      // prior tenant stock at the primary.
      if (
        resolvedSiteId &&
        primarySiteId &&
        resolvedSiteId !== primarySiteId &&
        delta !== 0
      ) {
        ensurePrimaryInventoryBalanceSnapshot(tx, {
          tenantId: ctx.tenantId,
          productId: input.productId,
          onHandSnapshot: previousStock,
          now,
        });
      }

      // Apply the delta to the resolved site's balance — the single source of
      // truth. The absolute target `input.newStock` is realized as
      // Σ(site balances) once this delta lands.
      // Seed value respects the migration rule: primary site seeds from the
      // pre-adjustment tenant total, non-primary sites seed from 0.
      applyInventoryBalanceDelta(tx, {
        tenantId: ctx.tenantId,
        siteId: resolvedSiteId,
        productId: input.productId,
        delta,
        initialOnHandIfMissing:
          resolvedSiteId && resolvedSiteId === primarySiteId ? previousStock : 0,
        now,
      });

      tx.insert(inventoryMovements)
        .values({
          id: movementId,
          tenantId: ctx.tenantId,
          productId: input.productId,
          type: 'adjustment',
          quantity,
          previousStock,
          newStock: input.newStock,
          reference: 'manual-adjustment',
          notes: input.notes,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();

      // Phase 8 / Tier-2 #8 — only audit when the adjustment actually
      // changed stock. A no-op call (newStock === current) shouldn't
      // pollute the audit timeline. Captures the delta + resolved site so
      // a reviewer can reconstruct the operator's intent without joining
      // back to inventory_movements.
      //
      // Scope note: the `tx.update(products) / tx.insert(inventoryMovements)`
      // writes ABOVE still land unconditionally when delta === 0 (writing a
      // zero-quantity movement row). The sync_outbox row is enqueued
      // post-tx unconditionally for the same reason. That pre-existing
      // shape is intentionally left unchanged; the audit row being
      // suppressed is a narrower, safer contract.
      if (delta !== 0) {
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId: ctx.user!.id,
          action: 'inventory.adjust_stock',
          resourceType: 'product',
          resourceId: input.productId,
          before: { stock: previousStock },
          after: { stock: input.newStock },
          metadata: {
            delta,
            // resolvedSiteId is null when the tenant has zero active sites.
            ...(resolvedSiteId ? { siteId: resolvedSiteId } : {}),
            ...(input.notes ? { notes: input.notes } : {}),
            movementId,
          },
        });
      }
    });

    await enqueueSync(ctx, {
      entityType: 'inventory_movements',
      entityId: movementId,
      operation: 'create',
      data: { id: movementId, productId: input.productId, newStock: input.newStock },
    });

    const journalEventId = await lookupInventoryJournalEventId(
      ctx.db,
      ctx.tenantId,
      // ENG-179c — adjustStock is a criticalCommand procedure, so the
      // envelope is always present; narrow ctx at the single boundary.
      asCriticalCommandContext(ctx).envelope.operationId
    );
    if (journalEventId && resolvedAdjustmentSiteId) {
      await safeUpdateInventoryAdjustedSummary(ctx, journalEventId, {
        productId: input.productId,
        siteId: resolvedAdjustmentSiteId,
        locationId: null,
        quantityBefore: previousStock,
        quantityAfter: input.newStock,
        delta,
        reasonCode: input.notes ?? null,
      });
    }

    const updatedProduct = await ctx.db
      .select()
      .from(products)
      .where(eq(products.id, input.productId))
      .get();

    // `stock` is no longer a product column; expose the derived tenant-wide
    // total so the mutation's response shape stays stable for clients.
    const derivedStock = getProductStockTotal(ctx.db, ctx.tenantId, input.productId);

    return { product: { ...updatedProduct!, stock: derivedStock }, movementId };
  }),

  /**
   * Admin reconciliation — retired by the single-source unification.
   *
   * `inventory_balances` is now the single source of truth and the tenant-wide
   * total is derived from it on read, so there is no denormalized cache to
   * recompute. This procedure is retained (as a no-op returning
   * `productsUpdated: 0`) because a web client and tests still invoke it.
   */
  reconcileBalances: adminProcedure.mutation(async ({ ctx }) => {
    const result = reconcileProductStockFromBalances(ctx.db, ctx.tenantId);
    return { ...result, reconciledAt: new Date().toISOString() };
  }),
};
