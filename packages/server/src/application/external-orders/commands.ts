/** Operator acceptance reuses the original sale transaction, with no create-then-link window. */
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { sales } from '../../db/schema.js';
import { externalOrderError } from '../../services/external-orders/errors.js';
import type { CompleteSaleContext } from '../sales/types.js';
import { completeSale } from '../sales/completeSale.js';
import type { CriticalCommandContext } from '../../trpc/middleware/commandEnvelope.js';
import { quoteExternalOrder, requireExternalOrder } from './quote.js';
import { transitionExternalOrder } from './sale-binding.js';

/** Explicitly confirmed local quote, not a provider payment or pricing override. */
export interface AcceptExternalOrderInput {
  siteId: string;
  id: string;
  expectedVersion: number;
  fingerprint: string;
  confirmedLocalPricing: true;
}
export async function acceptExternalOrder(
  ctx: CompleteSaleContext,
  input: AcceptExternalOrderInput
) {
  if (ctx.siteId !== input.siteId || !input.confirmedLocalPricing) externalOrderError('invalid');
  const quote = await quoteExternalOrder(ctx.db, ctx.tenantId, input.siteId, input.id);
  if (quote.expectedVersion !== input.expectedVersion || quote.fingerprint !== input.fingerprint)
    externalOrderError('conflict');
  const result = await completeSale(ctx, {
    mode: 'fresh',
    customerId: undefined,
    priceTier: 1,
    items: quote.items.map(item => ({
      productId: item.productId,
      unitId: item.unitId,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      discount: item.discount,
    })),
    status: 'draft',
    paymentStatus: 'pending',
    paymentMethod: 'cash',
    discountAmount: 0,
    externalOrder: {
      id: quote.id,
      expectedVersion: quote.expectedVersion,
      catalogHash: quote.catalogHash,
      lineHash: quote.lineHash,
      subtotal: quote.subtotal,
      taxAmount: quote.taxAmount,
      total: quote.total,
      currencyCode: quote.currencyCode,
    },
  });
  // Match the shared fresh-sale replay response, including a crash immediately
  // after the sale/inbox/fence commit but before this enrichment returns.
  return {
    ...result.sale,
    change: result.change,
    loyaltyPointsEarned: result.loyaltyPointsEarned ?? 0,
  };
}
/** Rejecting unaccepted intent has no financial effect. Cancellation resolution requires a reversed sale. */
export function closeExternalOrder(
  ctx: CriticalCommandContext,
  input: { siteId: string; id: string; expectedVersion: number; reason: string },
  mode: 'reject' | 'resolveCancellation'
) {
  return ctx.db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      const row = requireExternalOrder(tx, ctx.tenantId, input.siteId, input.id);
      if (row.version !== input.expectedVersion) externalOrderError('conflict');
      if (mode === 'reject') {
        if (row.status !== 'received' || row.saleId) externalOrderError('conflict');
      } else {
        if (row.status !== 'cancel_requested' || !row.saleId) externalOrderError('conflict');
        const sale = tx
          .select({ status: sales.status, paymentStatus: sales.paymentStatus })
          .from(sales)
          .where(and(eq(sales.tenantId, ctx.tenantId), eq(sales.id, row.saleId)))
          .get();
        if (!sale || (sale.status !== 'cancelled' && sale.paymentStatus !== 'refunded'))
          externalOrderError('conflict');
      }
      const updated = transitionExternalOrder(
        tx,
        {
          tenantId: ctx.tenantId,
          actorId: ctx.user.id,
          operationId: ctx.envelope.operationId,
          deviceId: ctx.deviceId,
        },
        row,
        { status: mode === 'reject' ? 'rejected' : 'cancelled', reason: input.reason }
      );
      const result = { id: updated.id, version: updated.version, status: updated.status };
      ctx.completeInTransaction(tx, result);
      return result;
    },
    { behavior: 'immediate' }
  );
}
