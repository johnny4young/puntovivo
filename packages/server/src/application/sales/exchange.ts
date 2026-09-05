/** Atomic linkage between a normalized return and its replacement sale. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { saleExchanges, saleReturns, sales } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';

export function assertSaleExchange(
  tx: DatabaseInstance,
  input: { tenantId: string; saleReturnId: string; replacementCustomerId: string | null }
) {
  const source = tx
    .select({ customerId: sales.customerId })
    .from(saleReturns)
    .innerJoin(sales, and(eq(saleReturns.saleId, sales.id), eq(sales.tenantId, input.tenantId)))
    .where(and(eq(saleReturns.tenantId, input.tenantId), eq(saleReturns.id, input.saleReturnId)))
    .get();
  if (!source) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'SALE_EXCHANGE_RETURN_NOT_FOUND',
      message: 'The source return was not found',
    });
  }
  if ((source.customerId ?? null) !== input.replacementCustomerId) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'SALE_EXCHANGE_CUSTOMER_MISMATCH',
      message: 'The replacement sale must keep the returned sale customer',
    });
  }
  const existing = tx
    .select({ id: saleExchanges.id })
    .from(saleExchanges)
    .where(
      and(
        eq(saleExchanges.tenantId, input.tenantId),
        eq(saleExchanges.saleReturnId, input.saleReturnId)
      )
    )
    .get();
  if (existing) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'SALE_EXCHANGE_ALREADY_LINKED',
      message: 'This return is already linked to a replacement sale',
    });
  }
}

export function finalizeSaleExchange(
  tx: DatabaseInstance,
  input: {
    tenantId: string;
    saleReturnId: string;
    replacementSaleId: string;
    actorId: string;
    now: string;
  }
): string {
  const id = nanoid();
  tx.insert(saleExchanges)
    .values({
      id,
      tenantId: input.tenantId,
      saleReturnId: input.saleReturnId,
      replacementSaleId: input.replacementSaleId,
      createdBy: input.actorId,
      createdAt: input.now,
    })
    .run();
  return id;
}
