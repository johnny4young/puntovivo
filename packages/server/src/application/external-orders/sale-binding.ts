import type { ResolvedItemsBundle } from '../sales/item-resolution.js';
/** Authoritative inbox/sale link and cancellation guards, always inside the caller's writer. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { externalOrders, externalOrderEvents, type ExternalOrderRow } from '../../db/schema.js';
import { externalOrderError } from '../../services/external-orders/errors.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { roundMoney } from '../../lib/money.js';
import {
  readExternalCatalog,
  externalResolvedLineHash,
  requireExternalOrder,
  type ExternalAcceptanceReference,
} from './quote.js';
import type { CompleteSaleContext, CompleteSaleInput } from '../sales/types.js';

/** Minimal operator identity shared by sale writers and explicit inbox commands. */
export interface ExternalOperatorIdentity {
  tenantId: string;
  actorId: string;
  operationId: string;
  deviceId?: string | null | undefined;
}
export function transitionExternalOrder(
  tx: DatabaseInstance,
  ctx: ExternalOperatorIdentity,
  before: ExternalOrderRow,
  change: { status: ExternalOrderRow['status']; saleId?: string; reason?: string }
) {
  const row = tx
    .update(externalOrders)
    .set({ ...change, version: before.version + 1, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(externalOrders.tenantId, ctx.tenantId),
        eq(externalOrders.id, before.id),
        eq(externalOrders.version, before.version)
      )
    )
    .returning()
    .get();
  if (!row) externalOrderError('conflict');
  tx.insert(externalOrderEvents)
    .values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      siteId: row.siteId,
      orderId: row.id,
      version: row.version,
      fromStatus: before.status,
      toStatus: row.status,
      source: 'operator',
      actorId: ctx.actorId,
      operationId: ctx.operationId,
    })
    .run();
  const facts = {
    id: row.id,
    siteId: row.siteId,
    saleId: row.saleId,
    status: row.status,
    version: row.version,
  };
  writeAuditLog({
    tx,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    operationId: ctx.operationId,
    action: 'external_order.update',
    resourceType: 'external_order',
    resourceId: row.id,
    before: { status: before.status, version: before.version },
    after: facts,
  });
  enqueueSyncInTransaction(
    {
      db: tx,
      tenantId: ctx.tenantId,
      deviceId: ctx.deviceId ?? null,
      envelope: { operationId: ctx.operationId },
    },
    { entityType: 'external_orders', entityId: row.id, operation: 'update', data: facts }
  );
  return row;
}
export function assertExternalAcceptance(
  tx: DatabaseInstance,
  ctx: CompleteSaleContext,
  input: Extract<CompleteSaleInput, { mode: 'fresh' }>,
  totals: { subtotal: number; taxAmount: number; total: number },
  currencyCode: string,
  resolvedItems: ResolvedItemsBundle
): ExternalOrderRow | null {
  const reference = input.externalOrder;
  if (!reference) return null;
  if (
    !ctx.envelope?.operationId ||
    !['admin', 'manager'].includes(ctx.user.role) ||
    input.status !== 'draft' ||
    input.paymentStatus !== 'pending' ||
    input.customerId ||
    input.sourceQuotationId ||
    input.sourceReturnId ||
    input.restaurant ||
    input.tableId ||
    input.payments?.length ||
    input.amountReceived ||
    input.discountAmount ||
    input.tipAmount ||
    input.serviceChargeAmount ||
    (input.priceTier !== undefined && input.priceTier !== 1)
  )
    externalOrderError('invalid');
  const row = requireExternalOrder(tx, ctx.tenantId, ctx.siteId, reference.id);
  if (row.status !== 'received' || row.saleId || row.version !== reference.expectedVersion)
    externalOrderError('conflict');
  const catalog = readExternalCatalog(tx, ctx.tenantId, row);
  if (
    externalResolvedLineHash(resolvedItems) !== reference.lineHash ||
    catalog.catalogHash !== reference.catalogHash ||
    currencyCode !== reference.currencyCode ||
    catalog.currencyCode !== currencyCode ||
    JSON.stringify(input.items) !== JSON.stringify(catalog.items)
  )
    externalOrderError('conflict');
  for (const key of ['subtotal', 'taxAmount', 'total'] as const)
    if (roundMoney(totals[key]) !== reference[key]) externalOrderError('conflict');
  return row;
}
export function bindExternalSale(
  tx: DatabaseInstance,
  ctx: CompleteSaleContext,
  row: ExternalOrderRow,
  saleId: string
): void {
  if (!ctx.envelope?.operationId) externalOrderError('invalid');
  transitionExternalOrder(
    tx,
    {
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      operationId: ctx.envelope.operationId,
      deviceId: ctx.deviceId,
    },
    row,
    { status: 'accepted', saleId }
  );
}
/** Cancellation intent blocks checkout/dispatch; it never silently refunds a completed sale. */
export function assertExternalSaleCanProceed(
  tx: DatabaseInstance,
  tenantId: string,
  saleId: string
): void {
  const row = tx
    .select({ status: externalOrders.status })
    .from(externalOrders)
    .where(and(eq(externalOrders.tenantId, tenantId), eq(externalOrders.saleId, saleId)))
    .get();
  if (row && row.status !== 'accepted') externalOrderError('conflict');
}
/** Splitting an externally bound order would orphan source quantities and cancellation ownership. */
export function assertSaleNotExternallyBound(
  tx: DatabaseInstance,
  tenantId: string,
  saleId: string
): void {
  const row = tx
    .select({ id: externalOrders.id })
    .from(externalOrders)
    .where(and(eq(externalOrders.tenantId, tenantId), eq(externalOrders.saleId, saleId)))
    .get();
  if (row) externalOrderError('conflict');
}
/** Called only after exact stock restoration in the same discard/void transaction. */
export function cancelExternalSale(
  tx: DatabaseInstance,
  ctx: CompleteSaleContext,
  saleId: string
): void {
  const row = tx
    .select()
    .from(externalOrders)
    .where(and(eq(externalOrders.tenantId, ctx.tenantId), eq(externalOrders.saleId, saleId)))
    .get();
  if (!row || row.status === 'cancelled') return;
  if (!ctx.envelope?.operationId || !['accepted', 'cancel_requested'].includes(row.status))
    externalOrderError('conflict');
  transitionExternalOrder(
    tx,
    {
      tenantId: ctx.tenantId,
      actorId: ctx.user.id,
      operationId: ctx.envelope.operationId,
      deviceId: ctx.deviceId,
    },
    row,
    { status: 'cancelled' }
  );
}
// Export the internal seam from one module for sale types; it is not a public sales.create field.
export type { ExternalAcceptanceReference };
