import { assertExternalSaleCanProceed } from '../external-orders/sale-binding.js';
/** Atomic delivery fulfillment. Logistics never mutate a sale, tender, inventory or fiscal document. */
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  cashSessions,
  customers,
  deliveryOrderEvents,
  deliveryOrders,
  products,
  saleItems,
  saleReturns,
  sales,
  sites,
  tenants,
  type DeliveryOrderRow,
  type DeliveryOrderStatus,
} from '../../db/schema.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { isModuleActiveInSettings } from '../../services/modules/manifest.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type {
  AdvanceDeliveryInput,
  CreateDeliveryFromSaleInput,
  CreateDeliveryInput,
} from '../../trpc/schemas/deliveryOrders.js';

/** Authenticated command identity; the completion fence is mandatory inside the writer. */
export interface DeliveryCommandContext {
  db: DatabaseInstance;
  tenantId: string;
  user: { id: string };
  deviceId: string;
  envelope: { operationId: string; idempotencyKey: string };
  completeInTransaction: (db: DatabaseInstance, result: unknown) => void;
}

/** Strict logistics state machine. Payment corrections always use separate financial commands. */
const transitions: Record<DeliveryOrderStatus, readonly DeliveryOrderStatus[]> = {
  accepted: ['preparing', 'cancelled'],
  preparing: ['dispatched', 'cancelled'],
  dispatched: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};
export function deliveryTransitions(status: DeliveryOrderStatus): readonly DeliveryOrderStatus[] {
  return transitions[status] ?? [];
}
export function deliveryNotFound(): never {
  return throwServerError({
    trpcCode: 'NOT_FOUND',
    errorCode: 'DELIVERY_ORDER_NOT_FOUND',
    message: 'Delivery order is not available in this site',
  });
}
function invalidReference(): never {
  return throwServerError({
    trpcCode: 'BAD_REQUEST',
    errorCode: 'DELIVERY_REFERENCE_INVALID',
    message: 'Delivery reference is not eligible in this site',
  });
}
function staleVersion(): never {
  return throwServerError({
    trpcCode: 'CONFLICT',
    errorCode: 'STALE_VERSION',
    message: 'Delivery changed; refresh before trying again',
  });
}

/** Guard again after the immediate writer lock: preflight checks alone are not authoritative. */
function withDelivery<T>(
  ctx: DeliveryCommandContext,
  siteId: string,
  action: (tx: DatabaseInstance) => T
): T {
  return ctx.db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      const site = tx
        .select({ id: sites.id })
        .from(sites)
        .where(
          and(eq(sites.id, siteId), eq(sites.tenantId, ctx.tenantId), eq(sites.isActive, true))
        )
        .get();
      if (!site) deliveryNotFound();
      const tenant = tx
        .select({ settings: tenants.settings })
        .from(tenants)
        .where(eq(tenants.id, ctx.tenantId))
        .get();
      if (!tenant || !isModuleActiveInSettings(tenant.settings, 'delivery')) {
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'MODULE_NOT_ACTIVATED',
          message: 'Delivery is not active',
          details: { moduleId: 'delivery' },
        });
      }
      return action(tx);
    },
    { behavior: 'immediate' }
  );
}

/** Minimal event/audit/outbox projection excludes recipient PII and item descriptions. */
function completeDelivery(
  ctx: DeliveryCommandContext,
  tx: DatabaseInstance,
  after: DeliveryOrderRow,
  before: DeliveryOrderRow | null,
  reason: string | null = null
) {
  tx.insert(deliveryOrderEvents)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      siteId: after.siteId,
      deliveryOrderId: after.id,
      version: after.version,
      fromStatus: before?.status ?? null,
      toStatus: after.status,
      actorId: ctx.user.id,
      operationId: ctx.envelope.operationId,
      reason,
      createdAt: after.updatedAt,
    })
    .run();
  const facts = {
    id: after.id,
    siteId: after.siteId,
    status: after.status,
    version: after.version,
    source: after.source,
    saleId: after.saleId,
  };
  writeAuditLog({
    tx,
    tenantId: ctx.tenantId,
    actorId: ctx.user.id,
    action: before ? 'delivery.transition' : 'delivery.create',
    resourceType: 'delivery_order',
    resourceId: after.id,
    before: before ? { status: before.status, version: before.version } : null,
    after: facts,
    operationId: ctx.envelope.operationId,
  });
  enqueueSyncInTransaction(
    { ...ctx, db: tx },
    {
      entityType: 'delivery_orders',
      entityId: after.id,
      operation: before ? 'update' : 'create',
      data: facts,
    }
  );
  const result = { id: after.id, status: after.status, version: after.version };
  ctx.completeInTransaction(tx, result);
  return result;
}

/** A completed sale gets its site from its owned cash session, not the caller's current site. */
function eligibleSale(tx: DatabaseInstance, tenantId: string, siteId: string, saleId: string) {
  assertExternalSaleCanProceed(tx, tenantId, saleId);
  const sale = tx
    .select({
      id: sales.id,
      customerId: sales.customerId,
      total: sales.total,
      currencyCode: sales.currencyCode,
      status: sales.status,
      paymentStatus: sales.paymentStatus,
    })
    .from(sales)
    .innerJoin(
      cashSessions,
      and(
        eq(cashSessions.id, sales.cashSessionId),
        eq(cashSessions.tenantId, tenantId),
        eq(cashSessions.siteId, siteId)
      )
    )
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .get();
  if (
    !sale ||
    sale.status !== 'completed' ||
    sale.paymentStatus === 'refunded' ||
    sale.paymentStatus === 'partially_refunded'
  )
    invalidReference();
  // A partial return keeps the sale completed. Do not dispatch the original full snapshot after a refund.
  if (
    tx
      .select({ id: saleReturns.id })
      .from(saleReturns)
      .where(and(eq(saleReturns.saleId, sale.id), eq(saleReturns.tenantId, tenantId)))
      .limit(1)
      .get()
  )
    invalidReference();
  if (
    sale.customerId &&
    !tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, sale.customerId), eq(customers.tenantId, tenantId)))
      .get()
  )
    invalidReference();
  return sale;
}

export function createDelivery(ctx: DeliveryCommandContext, input: CreateDeliveryInput) {
  return withDelivery(ctx, input.siteId, tx => {
    if (
      input.customerId &&
      !tx
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.id, input.customerId),
            eq(customers.tenantId, ctx.tenantId),
            eq(customers.isActive, true)
          )
        )
        .get()
    )
      invalidReference();
    const now = new Date().toISOString();
    const row = tx
      .insert(deliveryOrders)
      .values({
        id: nanoid(),
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        customerId: input.customerId ?? null,
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? null,
        address: input.address,
        addressNotes: input.addressNotes ?? null,
        courierName: input.courierName ?? null,
        source: 'manual',
        currencyCode: resolveTenantCurrency(tx, ctx.tenantId),
        totalAmount: input.totalAmount,
        itemsSnapshot: JSON.stringify(input.items),
        version: 1,
        acceptedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return completeDelivery(ctx, tx, row, null);
  });
}

export function createDeliveryFromSale(
  ctx: DeliveryCommandContext,
  input: CreateDeliveryFromSaleInput
) {
  return withDelivery(ctx, input.siteId, tx => {
    const sale = eligibleSale(tx, ctx.tenantId, input.siteId, input.saleId);
    // Historical duplicate links remain readable; never add another, even with a new command key.
    const linked = tx
      .select({ id: deliveryOrders.id })
      .from(deliveryOrders)
      .where(and(eq(deliveryOrders.tenantId, ctx.tenantId), eq(deliveryOrders.saleId, sale.id)))
      .limit(1)
      .get();
    if (linked)
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'DELIVERY_SALE_ALREADY_LINKED',
        message: 'This sale already has a delivery order',
      });
    const lines = tx
      .select({
        name: sql<string>`coalesce(${saleItems.productNameSnapshot}, ${products.name})`,
        qty: saleItems.quantity,
        unitPrice: saleItems.unitPrice,
        total: saleItems.total,
        saleItemId: saleItems.id,
      })
      .from(saleItems)
      .innerJoin(sales, and(eq(sales.id, saleItems.saleId), eq(sales.tenantId, ctx.tenantId)))
      .innerJoin(
        products,
        and(eq(products.id, saleItems.productId), eq(products.tenantId, ctx.tenantId))
      )
      .where(eq(sales.id, sale.id))
      .orderBy(saleItems.id)
      .limit(201)
      .all();
    const expected = tx
      .select({ count: sql<number>`count(*)` })
      .from(saleItems)
      .innerJoin(sales, and(eq(sales.id, saleItems.saleId), eq(sales.tenantId, ctx.tenantId)))
      .where(eq(sales.id, sale.id))
      .get()!.count;
    if (!lines.length || lines.length > 200 || lines.length !== expected) invalidReference();
    const now = new Date().toISOString();
    const row = tx
      .insert(deliveryOrders)
      .values({
        id: nanoid(),
        tenantId: ctx.tenantId,
        siteId: input.siteId,
        saleId: sale.id,
        customerId: sale.customerId,
        customerName: input.customerName,
        customerPhone: input.customerPhone ?? null,
        address: input.address,
        addressNotes: input.addressNotes ?? null,
        courierName: input.courierName ?? null,
        source: 'sale',
        currencyCode: sale.currencyCode,
        totalAmount: sale.total,
        itemsSnapshot: JSON.stringify(lines),
        version: 1,
        acceptedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    return completeDelivery(ctx, tx, row, null);
  });
}

export function advanceDelivery(ctx: DeliveryCommandContext, input: AdvanceDeliveryInput) {
  return withDelivery(ctx, input.siteId, tx => {
    const scope = and(
      eq(deliveryOrders.id, input.id),
      eq(deliveryOrders.tenantId, ctx.tenantId),
      eq(deliveryOrders.siteId, input.siteId)
    );
    const before = tx.select().from(deliveryOrders).where(scope).get();
    if (!before) deliveryNotFound();
    if (before.version !== input.expectedVersion) staleVersion();
    if (!deliveryTransitions(before.status).includes(input.toStatus)) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'DELIVERY_TRANSITION_INVALID',
        message: 'Delivery cannot move to this state',
      });
    }
    if (input.toStatus !== 'cancelled' && before.saleId)
      eligibleSale(tx, ctx.tenantId, input.siteId, before.saleId);
    const courierName = input.courierName ?? before.courierName;
    if (input.toStatus === 'dispatched' && !courierName?.trim()) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'DELIVERY_COURIER_REQUIRED',
        message: 'Assign a courier before dispatching',
      });
    }
    const now = new Date().toISOString();
    const after = tx
      .update(deliveryOrders)
      .set({
        status: input.toStatus,
        version: before.version + 1,
        courierName,
        updatedAt: now,
        ...(input.toStatus === 'preparing' ? { preparingAt: now } : {}),
        ...(input.toStatus === 'dispatched' ? { dispatchedAt: now } : {}),
        ...(input.toStatus === 'delivered' ? { deliveredAt: now } : {}),
        ...(input.toStatus === 'cancelled'
          ? { cancelledAt: now, cancellationReason: input.reason! }
          : {}),
      })
      .where(and(scope, eq(deliveryOrders.version, input.expectedVersion)))
      .returning()
      .get();
    if (!after) staleVersion();
    return completeDelivery(
      ctx,
      tx,
      after,
      before,
      input.toStatus === 'cancelled' ? input.reason! : null
    );
  });
}
