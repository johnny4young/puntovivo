/**
 * Transaction-local document-number allocation.
 *
 * Callers must invoke this from a write transaction (preferably IMMEDIATE).
 * Resolving a sequential before the transaction is useful for site validation,
 * but its current value is not an allocation: another register may advance it
 * before the caller writes. This helper re-reads and advances the row with an
 * expected-value guard so every committed document owns a distinct number.
 */
import { and, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../db/types.js';
import { sequentials } from '../db/schema.js';
import { throwServerError } from '../lib/errorCodes.js';

/**
 * The only Drizzle operations needed while allocating a document number.
 * Both the connection and its transaction implement these methods; requiring
 * the full connection would force transaction callers to lie about their type.
 * Callers must still supply a handle inside their own write transaction.
 */
export type SequentialAllocationExecutor = Pick<DatabaseInstance, 'select' | 'update'>;

export interface AllocatedSequential {
  value: number;
  number: string;
}

export function allocateNextSequential(
  db: SequentialAllocationExecutor,
  args: {
    tenantId: string;
    sequentialId: string;
    updatedAt: string;
  }
): AllocatedSequential {
  const current = db
    .select({ prefix: sequentials.prefix, currentValue: sequentials.currentValue })
    .from(sequentials)
    .where(and(eq(sequentials.id, args.sequentialId), eq(sequentials.tenantId, args.tenantId)))
    .get();

  if (!current) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'DOCUMENT_SEQUENTIAL_CHANGED',
      message: 'The selected document sequential is no longer available',
      details: { sequentialId: args.sequentialId },
    });
  }

  const value = current.currentValue + 1;
  const advanced = db
    .update(sequentials)
    .set({ currentValue: value, updatedAt: args.updatedAt })
    .where(
      and(
        eq(sequentials.id, args.sequentialId),
        eq(sequentials.tenantId, args.tenantId),
        eq(sequentials.currentValue, current.currentValue)
      )
    )
    .run();

  if (advanced.changes !== 1) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'DOCUMENT_SEQUENTIAL_CHANGED',
      message: 'The document sequential changed while its number was being allocated',
      details: { sequentialId: args.sequentialId, expectedValue: current.currentValue },
    });
  }

  return {
    value,
    number: `${current.prefix}${String(value).padStart(6, '0')}`,
  };
}
