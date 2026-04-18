import { and, desc, eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../db/index.js';
import {
  inventoryBalances,
  products,
  sites,
  transferOrderItems,
  transferOrders,
  type TransferOrderStatus,
} from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';
import {
  getPrimarySiteId,
  syncProductStockFromBalances,
} from './inventory-balances.js';
import { writeAuditLog } from './audit-logs.js';

/**
 * Phase 2 DB-102 / API-102 step 1 — immediate inventory transfers.
 *
 * A transfer atomically decreases `inventory_balances.on_hand` at
 * `fromSiteId` and increases it at `toSiteId` for one or more products,
 * persisting an audit row in `transfer_orders` (+ line items).
 *
 * This step collapses create/ship/receive into a single mutation; a future
 * iteration adds the lifecycle states (`draft` → `in_transit` → `received`)
 * plus a `reserved`/in-transit column on `inventory_balances`.
 */

export interface TransferItemInput {
  productId: string;
  quantity: number;
}

export interface CreateTransferArgs {
  tenantId: string;
  fromSiteId: string;
  toSiteId: string;
  items: readonly TransferItemInput[];
  notes?: string | null;
  createdBy: string;
  /**
   * When true, the transfer is persisted with status `in_transit`: origin
   * is debited but destination is NOT credited yet. Call `receiveInventoryTransfer`
   * later to flip the transfer to `completed` and credit the destination.
   * Defaults to false (immediate completion — legacy step-1 behaviour).
   */
  defer?: boolean;
}

export interface CreatedTransfer {
  id: string;
  status: TransferOrderStatus;
  fromSiteId: string;
  toSiteId: string;
  notes: string | null;
  createdAt: string;
  createdBy: string;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    productSku: string;
    quantity: number;
  }>;
}

function getTimestamp(): string {
  return new Date().toISOString();
}

function assertValidTransferArgs(args: CreateTransferArgs): void {
  if (args.fromSiteId === args.toSiteId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TRANSFER_SITES_IDENTICAL',
      message: 'Origin and destination sites must be different',
      details: { fromSiteId: args.fromSiteId },
    });
  }

  if (args.items.length === 0) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'TRANSFER_ITEMS_REQUIRED',
      message: 'A transfer must include at least one product line',
    });
  }

  for (const item of args.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_QUANTITY_INVALID',
        message: 'Transfer quantity must be greater than zero',
        details: { productId: item.productId, quantity: item.quantity },
      });
    }
  }
}

function seedMissingBalanceRow(args: {
  tx: DatabaseInstance;
  tenantId: string;
  siteId: string;
  productId: string;
  initialOnHand: number;
  now: string;
}): void {
  args.tx
    .insert(inventoryBalances)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      siteId: args.siteId,
      productId: args.productId,
      onHand: args.initialOnHand,
      reserved: 0,
      syncStatus: 'pending',
      syncVersion: 0,
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoNothing({
      target: [
        inventoryBalances.tenantId,
        inventoryBalances.siteId,
        inventoryBalances.productId,
      ],
    })
    .run();
}

export function createInventoryTransfer(
  db: DatabaseInstance,
  args: CreateTransferArgs
): CreatedTransfer {
  assertValidTransferArgs(args);
  const now = getTimestamp();
  const transferId = nanoid();

  const result = db.transaction(tx => {
    const primarySiteId = getPrimarySiteId(tx, args.tenantId);

    // Validate both sites belong to the tenant and are active.
    const tenantSites = tx
      .select({ id: sites.id, isActive: sites.isActive })
      .from(sites)
      .where(and(eq(sites.tenantId, args.tenantId)))
      .all();
    const tenantSiteById = new Map(tenantSites.map(site => [site.id, site]));

    for (const siteId of [args.fromSiteId, args.toSiteId]) {
      const site = tenantSiteById.get(siteId);
      if (!site || site.isActive === false) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'TRANSFER_SITE_NOT_FOUND',
          message: 'Transfer site was not found or is inactive',
          details: { siteId },
        });
      }
    }

    // Collapse duplicate product lines so a single product can only move in
    // one direction per transfer. (The callers shouldn't pass duplicates, but
    // defending here keeps the balance updates consistent.)
    const collapsedItems = new Map<string, number>();
    for (const item of args.items) {
      collapsedItems.set(
        item.productId,
        (collapsedItems.get(item.productId) ?? 0) + item.quantity
      );
    }

    const productIds = Array.from(collapsedItems.keys());
    const tenantProducts = tx
      .select({ id: products.id, name: products.name, sku: products.sku, stock: products.stock })
      .from(products)
      .where(and(eq(products.tenantId, args.tenantId), eq(products.isActive, true)))
      .all();
    const productById = new Map(tenantProducts.map(product => [product.id, product]));

    for (const productId of productIds) {
      if (!productById.has(productId)) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'TRANSFER_PRODUCT_NOT_FOUND',
          message: 'Transfer product was not found or is inactive',
          details: { productId },
        });
      }
    }

    const deferred = args.defer === true;
    const createdStatus: TransferOrderStatus = deferred ? 'in_transit' : 'completed';

    tx.insert(transferOrders)
      .values({
        id: transferId,
        tenantId: args.tenantId,
        fromSiteId: args.fromSiteId,
        toSiteId: args.toSiteId,
        status: createdStatus,
        notes: args.notes ?? null,
        createdBy: args.createdBy,
        syncStatus: 'pending',
        syncVersion: 0,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const persistedItems: CreatedTransfer['items'] = [];

    for (const [productId, quantity] of collapsedItems.entries()) {
      const product = productById.get(productId)!;

      // Lazily seed missing balance rows for both sites so transfer creation
      // does not depend on the balances read path having run beforehand.
      seedMissingBalanceRow({
        tx,
        tenantId: args.tenantId,
        siteId: args.fromSiteId,
        productId,
        initialOnHand: args.fromSiteId === primarySiteId ? product.stock : 0,
        now,
      });
      seedMissingBalanceRow({
        tx,
        tenantId: args.tenantId,
        siteId: args.toSiteId,
        productId,
        initialOnHand: args.toSiteId === primarySiteId ? product.stock : 0,
        now,
      });

      const fromBalance = tx
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, args.tenantId),
            eq(inventoryBalances.siteId, args.fromSiteId),
            eq(inventoryBalances.productId, productId)
          )
        )
        .get();

      if (!fromBalance || fromBalance.onHand < quantity) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'TRANSFER_INSUFFICIENT_STOCK',
          message: 'Insufficient stock at origin site for transfer',
          details: {
            productId,
            siteId: args.fromSiteId,
            available: fromBalance?.onHand ?? 0,
            requested: quantity,
          },
        });
      }

      // Origin is always debited on create — whether the transfer completes
      // immediately or ships deferred, the stock has physically left the
      // source shelf.
      tx.update(inventoryBalances)
        .set({
          onHand: fromBalance.onHand - quantity,
          syncStatus: 'pending',
          updatedAt: now,
        })
        .where(
          and(
            eq(inventoryBalances.tenantId, args.tenantId),
            eq(inventoryBalances.siteId, args.fromSiteId),
            eq(inventoryBalances.productId, productId)
          )
        )
        .run();

      // Destination is credited only on immediate transfers. Deferred
      // transfers credit the destination later via `receiveInventoryTransfer`.
      if (!deferred) {
        const existingToBalance = tx
          .select({ onHand: inventoryBalances.onHand })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, args.tenantId),
              eq(inventoryBalances.siteId, args.toSiteId),
              eq(inventoryBalances.productId, productId)
            )
          )
          .get();

        tx.update(inventoryBalances)
          .set({
            onHand: (existingToBalance?.onHand ?? 0) + quantity,
            syncStatus: 'pending',
            updatedAt: now,
          })
          .where(
            and(
              eq(inventoryBalances.tenantId, args.tenantId),
              eq(inventoryBalances.siteId, args.toSiteId),
              eq(inventoryBalances.productId, productId)
            )
          )
          .run();
      }

      // Recompute products.stock for both sides of the transfer so the
      // tenant-wide cache stays in lockstep with Σ(balances), matching the
      // step-4 invariant established for all other mutation paths.
      syncProductStockFromBalances(tx, {
        tenantId: args.tenantId,
        productId,
        now,
      });

      const itemId = nanoid();
      tx.insert(transferOrderItems)
        .values({
          id: itemId,
          transferOrderId: transferId,
          productId,
          quantity,
          createdAt: now,
        })
        .run();

      persistedItems.push({
        id: itemId,
        productId,
        productName: product.name,
        productSku: product.sku,
        quantity,
      });
    }

    return { items: persistedItems, status: createdStatus };
  });

  return {
    id: transferId,
    status: result.status,
    fromSiteId: args.fromSiteId,
    toSiteId: args.toSiteId,
    notes: args.notes ?? null,
    createdAt: now,
    createdBy: args.createdBy,
    items: result.items,
  };
}

export interface VoidTransferArgs {
  tenantId: string;
  transferId: string;
  reason?: string | null;
  voidedBy: string;
}

export interface VoidedTransfer {
  id: string;
  status: TransferOrderStatus;
  fromSiteId: string;
  toSiteId: string;
  voidedAt: string;
  voidedBy: string;
  reversedItems: Array<{ productId: string; quantity: number }>;
}

/**
 * Voids a completed transfer by reversing every line item:
 *   - Destination `on_hand` is decremented by the item quantity.
 *   - Origin `on_hand` is incremented by the same quantity.
 * The transfer row's `status` becomes `void`.
 *
 * Rejects with `TRANSFER_ALREADY_VOID` if the transfer is already voided, and
 * with `TRANSFER_VOID_INSUFFICIENT_STOCK` if a later write (sale, outbound
 * transfer) already consumed the destination's balance — the operator must
 * bring stock back first before the void can be applied.
 */
export function voidInventoryTransfer(
  db: DatabaseInstance,
  args: VoidTransferArgs
): VoidedTransfer {
  const now = getTimestamp();

  return db.transaction(tx => {
    const transfer = tx
      .select({
        id: transferOrders.id,
        status: transferOrders.status,
        fromSiteId: transferOrders.fromSiteId,
        toSiteId: transferOrders.toSiteId,
        notes: transferOrders.notes,
      })
      .from(transferOrders)
      .where(
        and(
          eq(transferOrders.id, args.transferId),
          eq(transferOrders.tenantId, args.tenantId)
        )
      )
      .get();

    if (!transfer) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'TRANSFER_NOT_FOUND',
        message: 'Transfer not found',
        details: { transferId: args.transferId },
      });
    }

    if (transfer.status === 'void') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_ALREADY_VOID',
        message: 'Transfer is already void',
        details: { transferId: args.transferId },
      });
    }

    const items = tx
      .select({
        productId: transferOrderItems.productId,
        quantity: transferOrderItems.quantity,
        receivedQuantity: transferOrderItems.receivedQuantity,
      })
      .from(transferOrderItems)
      .where(eq(transferOrderItems.transferOrderId, args.transferId))
      .all();

    // The destination debit on void matches whatever was credited at receive
    // time. Legacy rows (pre-UI-103) have receivedQuantity = null → coalesce
    // to the shipped quantity to preserve existing void semantics.
    const itemsWithReversal = items.map(item => ({
      ...item,
      destinationDebit: item.receivedQuantity ?? item.quantity,
    }));

    const primarySiteId = getPrimarySiteId(tx, args.tenantId);
    const productStockById = new Map(
      tx
        .select({ id: products.id, stock: products.stock })
        .from(products)
        .where(
          and(
            eq(products.tenantId, args.tenantId),
            inArray(
              products.id,
              items.map(item => item.productId)
            )
          )
        )
        .all()
        .map(product => [product.id, product.stock])
    );

    const wasInTransit = transfer.status === 'in_transit';

    // Pre-validate destination stock only when the destination was previously
    // credited (i.e. status was `completed`). Deferred transfers that are
    // still `in_transit` never touched the destination, so there is nothing
    // to reverse on that side.
    const validatedDestinationOnHand = new Map<string, number>();
    if (!wasInTransit) {
      for (const item of itemsWithReversal) {
        if (item.destinationDebit <= 0) {
          // A received=0 line never touched the destination, so there is
          // nothing to validate or debit. Still reachable for fully-lost
          // shipments where the receiver recorded a zero on every line.
          validatedDestinationOnHand.set(item.productId, 0);
          continue;
        }

        const destinationBalance = tx
          .select({ onHand: inventoryBalances.onHand })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, args.tenantId),
              eq(inventoryBalances.siteId, transfer.toSiteId),
              eq(inventoryBalances.productId, item.productId)
            )
          )
          .get();

        const available = destinationBalance?.onHand ?? 0;
        if (!destinationBalance || available < item.destinationDebit) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'TRANSFER_VOID_INSUFFICIENT_STOCK',
            message: 'Destination site does not have enough stock to reverse the transfer',
            details: {
              transferId: args.transferId,
              productId: item.productId,
              destinationSiteId: transfer.toSiteId,
              available,
              required: item.destinationDebit,
            },
          });
        }
        validatedDestinationOnHand.set(item.productId, available);
      }
    }

    const reversedItems: VoidedTransfer['reversedItems'] = [];

    for (const item of itemsWithReversal) {
      if (!wasInTransit && item.destinationDebit > 0) {
        // Decrement destination using the pre-validated value — a single read
        // per item keeps the math consistent and avoids a reachable path to a
        // negative balance if the row was somehow removed between loops.
        const destinationOnHand = validatedDestinationOnHand.get(item.productId)!;

        tx.update(inventoryBalances)
          .set({
            onHand: destinationOnHand - item.destinationDebit,
            syncStatus: 'pending',
            updatedAt: now,
          })
          .where(
            and(
              eq(inventoryBalances.tenantId, args.tenantId),
              eq(inventoryBalances.siteId, transfer.toSiteId),
              eq(inventoryBalances.productId, item.productId)
            )
          )
          .run();
      }

      // Credit origin — ensure the row exists first. Applies for BOTH
      // completed and in_transit voids, since origin was always debited on
      // create.
      seedMissingBalanceRow({
        tx,
        tenantId: args.tenantId,
        siteId: transfer.fromSiteId,
        productId: item.productId,
        initialOnHand:
          transfer.fromSiteId === primarySiteId
            ? (productStockById.get(item.productId) ?? 0)
            : 0,
        now,
      });

      const originBalance = tx
        .select({ onHand: inventoryBalances.onHand })
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, args.tenantId),
            eq(inventoryBalances.siteId, transfer.fromSiteId),
            eq(inventoryBalances.productId, item.productId)
          )
        )
        .get();

      tx.update(inventoryBalances)
        .set({
          onHand: (originBalance?.onHand ?? 0) + item.quantity,
          syncStatus: 'pending',
          updatedAt: now,
        })
        .where(
          and(
            eq(inventoryBalances.tenantId, args.tenantId),
            eq(inventoryBalances.siteId, transfer.fromSiteId),
            eq(inventoryBalances.productId, item.productId)
          )
        )
        .run();

      // Keep products.stock in lockstep with Σ(balances) after the reversal
      // (same invariant enforced by every other balance mutation).
      syncProductStockFromBalances(tx, {
        tenantId: args.tenantId,
        productId: item.productId,
        now,
      });

      reversedItems.push({ productId: item.productId, quantity: item.quantity });
    }

    // Flip the transfer row to `void`. Preserve existing notes and append
    // a void reason when provided.
    const voidReason = args.reason?.trim();
    const mergedNotes = voidReason
      ? transfer.notes
        ? `${transfer.notes}\n[VOID] ${voidReason}`
        : `[VOID] ${voidReason}`
      : transfer.notes;

    tx.update(transferOrders)
      .set({
        status: 'void',
        notes: mergedNotes,
        syncStatus: 'pending',
        updatedAt: now,
      })
      .where(
        and(
          eq(transferOrders.id, args.transferId),
          eq(transferOrders.tenantId, args.tenantId)
        )
      )
      .run();

    // Phase 8 / Tier-2 #8 — audit this sensitive operation. Inside the same
    // transaction so either both the void and the audit row land, or neither.
    writeAuditLog({
      tx,
      tenantId: args.tenantId,
      actorId: args.voidedBy,
      action: 'transfer.void',
      resourceType: 'transfer_order',
      resourceId: args.transferId,
      before: {
        status: transfer.status,
        fromSiteId: transfer.fromSiteId,
        toSiteId: transfer.toSiteId,
        notes: transfer.notes,
      },
      after: {
        status: 'void',
        notes: mergedNotes,
      },
      metadata: voidReason ? { reason: voidReason } : null,
    });

    return {
      id: args.transferId,
      status: 'void' as TransferOrderStatus,
      fromSiteId: transfer.fromSiteId,
      toSiteId: transfer.toSiteId,
      voidedAt: now,
      voidedBy: args.voidedBy,
      reversedItems,
    };
  });
}

export interface ReceiveTransferLine {
  /** `transfer_order_items.id` of the line being received. */
  itemId: string;
  receivedQuantity: number;
}

export interface ReceiveTransferArgs {
  tenantId: string;
  transferId: string;
  receivedBy: string;
  /**
   * Phase 2 UI-103. Optional per-line received quantities keyed by
   * `transfer_order_items.id`. When omitted or empty, every line is credited
   * at its shipped quantity (legacy one-click receive behaviour). When
   * supplied, unknown ids or `received > shipped` are rejected.
   */
  lines?: readonly ReceiveTransferLine[];
  /** Optional receiver-side note captured when variance is present. */
  discrepancyNotes?: string | null;
}

export interface ReceivedTransfer {
  id: string;
  status: TransferOrderStatus;
  fromSiteId: string;
  toSiteId: string;
  receivedAt: string;
  receivedBy: string;
  /**
   * `quantity` here is the received quantity — the amount credited to the
   * destination. Callers that need the shipped quantity should read it from
   * `transfers.getById`.
   */
  receivedItems: Array<{ productId: string; quantity: number }>;
  /** True when any line's received quantity diverged from the shipped one. */
  hasDiscrepancy: boolean;
  discrepancyNotes: string | null;
}

/**
 * Completes a deferred (in_transit) transfer by crediting the destination
 * site and flipping the transfer status to `completed`. Called when the
 * shipment physically arrives at the destination.
 *
 * Rejects with `TRANSFER_NOT_FOUND` if the id doesn't exist for the tenant
 * and `TRANSFER_NOT_IN_TRANSIT` if the transfer is in any state other than
 * `in_transit` (completed transfers were already credited; voided transfers
 * have been reversed).
 */
function resolveReceivedQuantitiesByItemId(
  items: ReadonlyArray<{ id: string; quantity: number }>,
  lines: readonly ReceiveTransferLine[] | undefined
): Map<string, number> {
  if (!lines || lines.length === 0) {
    return new Map(items.map(item => [item.id, item.quantity]));
  }

  const shippedById = new Map(items.map(item => [item.id, item.quantity]));
  const resolved = new Map<string, number>();

  for (const line of lines) {
    const shipped = shippedById.get(line.itemId);
    if (shipped === undefined) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_RECEIVE_LINE_MISMATCH',
        message: 'Receive payload references a line that does not belong to this transfer',
        details: { itemId: line.itemId },
      });
    }
    if (resolved.has(line.itemId)) {
      // Duplicate ids would otherwise silently collapse — reject so the UI
      // can't accidentally double-credit a line.
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_RECEIVE_LINE_MISMATCH',
        message: 'Receive payload contains duplicate line entries',
        details: { itemId: line.itemId },
      });
    }
    if (line.receivedQuantity > shipped) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_RECEIVED_EXCEEDS_SHIPPED',
        message: 'Received quantity cannot exceed the shipped quantity',
        details: {
          itemId: line.itemId,
          shipped,
          received: line.receivedQuantity,
        },
      });
    }
    resolved.set(line.itemId, line.receivedQuantity);
  }

  // Any line not addressed by the caller defaults to the shipped quantity.
  for (const item of items) {
    if (!resolved.has(item.id)) {
      resolved.set(item.id, item.quantity);
    }
  }

  return resolved;
}

export function receiveInventoryTransfer(
  db: DatabaseInstance,
  args: ReceiveTransferArgs
): ReceivedTransfer {
  const now = getTimestamp();
  const trimmedDiscrepancyNotes = args.discrepancyNotes?.trim();
  const normalizedDiscrepancyNotes =
    trimmedDiscrepancyNotes && trimmedDiscrepancyNotes.length > 0
      ? trimmedDiscrepancyNotes
      : null;

  return db.transaction(tx => {
    const transfer = tx
      .select({
        id: transferOrders.id,
        status: transferOrders.status,
        fromSiteId: transferOrders.fromSiteId,
        toSiteId: transferOrders.toSiteId,
      })
      .from(transferOrders)
      .where(
        and(
          eq(transferOrders.id, args.transferId),
          eq(transferOrders.tenantId, args.tenantId)
        )
      )
      .get();

    if (!transfer) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'TRANSFER_NOT_FOUND',
        message: 'Transfer not found',
        details: { transferId: args.transferId },
      });
    }

    if (transfer.status !== 'in_transit') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'TRANSFER_NOT_IN_TRANSIT',
        message: 'Only transfers currently in transit can be received',
        details: { transferId: args.transferId, status: transfer.status },
      });
    }

    const items = tx
      .select({
        id: transferOrderItems.id,
        productId: transferOrderItems.productId,
        quantity: transferOrderItems.quantity,
      })
      .from(transferOrderItems)
      .where(eq(transferOrderItems.transferOrderId, args.transferId))
      .all();

    const receivedByItemId = resolveReceivedQuantitiesByItemId(items, args.lines);

    const primarySiteId = getPrimarySiteId(tx, args.tenantId);
    const productStockById = new Map(
      tx
        .select({ id: products.id, stock: products.stock })
        .from(products)
        .where(
          and(
            eq(products.tenantId, args.tenantId),
            inArray(
              products.id,
              items.map(item => item.productId)
            )
          )
        )
        .all()
        .map(product => [product.id, product.stock])
    );

    const receivedItems: ReceivedTransfer['receivedItems'] = [];
    let hasDiscrepancy = false;

    for (const item of items) {
      const receivedQuantity = receivedByItemId.get(item.id) ?? item.quantity;
      if (receivedQuantity !== item.quantity) {
        hasDiscrepancy = true;
      }

      // Seed the destination row even when received is zero so the drawer
      // stays consistent (every line gets a row) and subsequent voids can
      // safely read it.
      seedMissingBalanceRow({
        tx,
        tenantId: args.tenantId,
        siteId: transfer.toSiteId,
        productId: item.productId,
        initialOnHand:
          transfer.toSiteId === primarySiteId
            ? (productStockById.get(item.productId) ?? 0)
            : 0,
        now,
      });

      if (receivedQuantity > 0) {
        const destinationBalance = tx
          .select({ onHand: inventoryBalances.onHand })
          .from(inventoryBalances)
          .where(
            and(
              eq(inventoryBalances.tenantId, args.tenantId),
              eq(inventoryBalances.siteId, transfer.toSiteId),
              eq(inventoryBalances.productId, item.productId)
            )
          )
          .get();

        tx.update(inventoryBalances)
          .set({
            onHand: (destinationBalance?.onHand ?? 0) + receivedQuantity,
            syncStatus: 'pending',
            updatedAt: now,
          })
          .where(
            and(
              eq(inventoryBalances.tenantId, args.tenantId),
              eq(inventoryBalances.siteId, transfer.toSiteId),
              eq(inventoryBalances.productId, item.productId)
            )
          )
          .run();
      }

      tx.update(transferOrderItems)
        .set({ receivedQuantity })
        .where(eq(transferOrderItems.id, item.id))
        .run();

      // Products.stock drifts by (shipped - received) because origin was
      // debited the full shipped quantity at create time but destination only
      // gets credited the received quantity. Recompute from Σ(balances) to
      // keep the cache honest (intentional shrinkage).
      syncProductStockFromBalances(tx, {
        tenantId: args.tenantId,
        productId: item.productId,
        now,
      });

      receivedItems.push({ productId: item.productId, quantity: receivedQuantity });
    }

    const persistedDiscrepancyNotes = hasDiscrepancy
      ? normalizedDiscrepancyNotes
      : null;

    tx.update(transferOrders)
      .set({
        status: 'completed',
        receivedAt: now,
        receivedBy: args.receivedBy,
        discrepancyNotes: persistedDiscrepancyNotes,
        syncStatus: 'pending',
        updatedAt: now,
      })
      .where(
        and(
          eq(transferOrders.id, args.transferId),
          eq(transferOrders.tenantId, args.tenantId)
        )
      )
      .run();

    return {
      id: args.transferId,
      status: 'completed' as TransferOrderStatus,
      fromSiteId: transfer.fromSiteId,
      toSiteId: transfer.toSiteId,
      receivedAt: now,
      receivedBy: args.receivedBy,
      receivedItems,
      hasDiscrepancy,
      discrepancyNotes: persistedDiscrepancyNotes,
    };
  });
}

export interface TransferHistoryEntry {
  id: string;
  status: TransferOrderStatus;
  fromSiteId: string;
  fromSiteName: string;
  toSiteId: string;
  toSiteName: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  receivedAt: string | null;
  receivedBy: string | null;
  itemCount: number;
  totalQuantity: number;
  /**
   * Phase 2 UI-103. True when any line's received quantity diverges from the
   * shipped quantity. Null-safe against legacy rows (received_quantity is
   * null until the line is actually received).
   */
  hasDiscrepancy: boolean;
  discrepancyNotes: string | null;
}

/**
 * Lists recent transfer orders for the tenant. Reverse-chronological by
 * `createdAt` with a bounded limit — callers can pass a smaller limit via
 * `options.limit`.
 */
export async function listRecentTransfers(
  db: DatabaseInstance,
  tenantId: string,
  options: { limit?: number } = {}
): Promise<TransferHistoryEntry[]> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 200));

  const rows = await db
    .select({
      id: transferOrders.id,
      status: transferOrders.status,
      fromSiteId: transferOrders.fromSiteId,
      toSiteId: transferOrders.toSiteId,
      notes: transferOrders.notes,
      createdBy: transferOrders.createdBy,
      createdAt: transferOrders.createdAt,
      receivedAt: transferOrders.receivedAt,
      receivedBy: transferOrders.receivedBy,
      discrepancyNotes: transferOrders.discrepancyNotes,
    })
    .from(transferOrders)
    .where(eq(transferOrders.tenantId, tenantId))
    .orderBy(desc(transferOrders.createdAt))
    .limit(limit)
    .all();

  if (rows.length === 0) {
    return [];
  }

  const siteRows = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(eq(sites.tenantId, tenantId))
    .all();
  const sitesMap = new Map(siteRows.map(site => [site.id, site.name]));

  // Fan-out per-transfer aggregation. History volumes are bounded by `limit`
  // (<=200) so the N+1 is acceptable for Phase 2 step 1; a future step can
  // replace this with a single GROUP BY join once `transferOrderItems` gains
  // more metadata worth aggregating.
  const enriched = await Promise.all(
    rows.map(async row => {
      const items = await db
        .select({
          quantity: transferOrderItems.quantity,
          receivedQuantity: transferOrderItems.receivedQuantity,
        })
        .from(transferOrderItems)
        .where(eq(transferOrderItems.transferOrderId, row.id))
        .all();

      // Discrepancy is only meaningful once the transfer has been received.
      // Lines still in transit carry receivedQuantity = null and must not
      // trigger the badge.
      const hasDiscrepancy = items.some(
        item => item.receivedQuantity !== null && item.receivedQuantity !== item.quantity
      );

      return {
        ...row,
        fromSiteName: sitesMap.get(row.fromSiteId) ?? '',
        toSiteName: sitesMap.get(row.toSiteId) ?? '',
        itemCount: items.length,
        totalQuantity: items.reduce((total, item) => total + item.quantity, 0),
        hasDiscrepancy,
      };
    })
  );

  return enriched;
}

export interface TransferDetailLine {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: number;
  /** Phase 2 UI-103. Null until the transfer is received. */
  receivedQuantity: number | null;
}

export interface TransferDetail {
  id: string;
  status: TransferOrderStatus;
  fromSiteId: string;
  fromSiteName: string;
  toSiteId: string;
  toSiteName: string;
  notes: string | null;
  createdBy: string;
  createdAt: string;
  receivedAt: string | null;
  receivedBy: string | null;
  updatedAt: string;
  items: TransferDetailLine[];
  /** Phase 2 UI-103. */
  hasDiscrepancy: boolean;
  discrepancyNotes: string | null;
}

/**
 * Fetches a single transfer order with every line item joined to product
 * metadata, intended for the detail drawer on the inventory history table.
 *
 * Returns `null` when the transfer does not exist for the given tenant —
 * callers (typically a tRPC `getById` procedure) translate that to the
 * familiar `TRANSFER_NOT_FOUND` error surface.
 */
export async function getInventoryTransferById(
  db: DatabaseInstance,
  tenantId: string,
  transferId: string
): Promise<TransferDetail | null> {
  const transfer = await db
    .select({
      id: transferOrders.id,
      status: transferOrders.status,
      fromSiteId: transferOrders.fromSiteId,
      toSiteId: transferOrders.toSiteId,
      notes: transferOrders.notes,
      createdBy: transferOrders.createdBy,
      createdAt: transferOrders.createdAt,
      receivedAt: transferOrders.receivedAt,
      receivedBy: transferOrders.receivedBy,
      discrepancyNotes: transferOrders.discrepancyNotes,
      updatedAt: transferOrders.updatedAt,
    })
    .from(transferOrders)
    .where(
      and(
        eq(transferOrders.id, transferId),
        eq(transferOrders.tenantId, tenantId)
      )
    )
    .get();

  if (!transfer) {
    return null;
  }

  const items = await db
    .select({
      id: transferOrderItems.id,
      productId: transferOrderItems.productId,
      quantity: transferOrderItems.quantity,
      receivedQuantity: transferOrderItems.receivedQuantity,
      productName: products.name,
      productSku: products.sku,
    })
    .from(transferOrderItems)
    .innerJoin(products, eq(transferOrderItems.productId, products.id))
    .where(eq(transferOrderItems.transferOrderId, transfer.id))
    .all();

  const hasDiscrepancy = items.some(
    item => item.receivedQuantity !== null && item.receivedQuantity !== item.quantity
  );

  // Resolve site names with a single two-row lookup instead of two separate
  // selects, since most transfers have exactly 2 participating sites.
  const siteRows = await db
    .select({ id: sites.id, name: sites.name })
    .from(sites)
    .where(
      and(
        eq(sites.tenantId, tenantId),
        inArray(sites.id, [transfer.fromSiteId, transfer.toSiteId])
      )
    )
    .all();
  const siteNameById = new Map(siteRows.map(site => [site.id, site.name]));

  return {
    ...transfer,
    fromSiteName: siteNameById.get(transfer.fromSiteId) ?? '',
    toSiteName: siteNameById.get(transfer.toSiteId) ?? '',
    items,
    hasDiscrepancy,
  };
}
