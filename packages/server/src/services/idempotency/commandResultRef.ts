/**
 * Versioned, durable references for command results that cannot be fully
 * materialized until after their domain transaction commits.
 *
 * A sale completion is the first such command: the transaction knows the
 * authoritative sale id, cash change and loyalty accrual, while fiscal/read-side
 * enrichment happens post-commit. Persisting this compact reference closes
 * the crash window without freezing an incomplete response. Ordinary success
 * later refines the idempotency row to the exact resolver response; a crash or
 * an interrupted refinement hydrates this reference from tenant-scoped data.
 *
 * @module services/idempotency/commandResultRef
 */

import type { DatabaseInstance } from '../../db/index.js';
import { getSaleRecord } from '../../application/sales/sale-read.js';

const COMMAND_RESULT_REF_KEY = '__puntovivoCommandResult' as const;

interface SaleCompletionPayload {
  schemaVersion: 1;
  kind: 'sale_completion';
  saleId: string;
  responseShape: 'fresh' | 'completed_draft';
  change: number;
  loyaltyPointsEarned: number;
}

interface SaleReturnPayload {
  schemaVersion: 1;
  kind: 'sale_return';
  saleId: string;
}

type DeferredCommandResultPayload = SaleCompletionPayload | SaleReturnPayload;

export interface SaleCompletionCommandResultRef {
  [COMMAND_RESULT_REF_KEY]: SaleCompletionPayload;
}

export interface SaleReturnCommandResultRef {
  [COMMAND_RESULT_REF_KEY]: SaleReturnPayload;
}

export function createSaleCompletionCommandResultRef(input: {
  saleId: string;
  responseShape: SaleCompletionPayload['responseShape'];
  change: number;
  loyaltyPointsEarned: number;
}): SaleCompletionCommandResultRef {
  return {
    [COMMAND_RESULT_REF_KEY]: {
      schemaVersion: 1,
      kind: 'sale_completion',
      saleId: input.saleId,
      responseShape: input.responseShape,
      change: input.change,
      loyaltyPointsEarned: input.loyaltyPointsEarned,
    },
  };
}

export function createSaleReturnCommandResultRef(saleId: string): SaleReturnCommandResultRef {
  return {
    [COMMAND_RESULT_REF_KEY]: {
      schemaVersion: 1,
      kind: 'sale_return',
      saleId,
    },
  };
}

function hasDeferredMarker(
  value: unknown
): value is Record<typeof COMMAND_RESULT_REF_KEY, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, COMMAND_RESULT_REF_KEY)
  );
}

function readDeferredPayload(value: unknown): DeferredCommandResultPayload | null {
  if (!hasDeferredMarker(value)) return null;
  const payload = value[COMMAND_RESULT_REF_KEY];
  if (
    typeof payload !== 'object' ||
    payload === null ||
    (payload as { schemaVersion?: unknown }).schemaVersion !== 1
  ) {
    throw new Error('Unsupported or malformed deferred command result reference');
  }

  if ((payload as { kind?: unknown }).kind === 'sale_return') {
    const candidate = payload as Partial<SaleReturnPayload>;
    if (typeof candidate.saleId !== 'string' || candidate.saleId.length === 0) {
      throw new Error('Malformed sale return command result reference');
    }
    return candidate as SaleReturnPayload;
  }
  if ((payload as { kind?: unknown }).kind !== 'sale_completion') {
    throw new Error('Unsupported deferred command result reference kind');
  }

  const candidate = payload as Partial<SaleCompletionPayload>;
  if (
    typeof candidate.saleId !== 'string' ||
    candidate.saleId.length === 0 ||
    (candidate.responseShape !== 'fresh' && candidate.responseShape !== 'completed_draft') ||
    typeof candidate.change !== 'number' ||
    !Number.isFinite(candidate.change) ||
    candidate.change < 0 ||
    typeof candidate.loyaltyPointsEarned !== 'number' ||
    !Number.isInteger(candidate.loyaltyPointsEarned) ||
    candidate.loyaltyPointsEarned < 0
  ) {
    throw new Error('Malformed sale completion command result reference');
  }
  return candidate as SaleCompletionPayload;
}

export function isDeferredCommandResultRef(value: unknown): boolean {
  return readDeferredPayload(value) !== null;
}

/**
 * Resolve a known reference into the public tRPC result. Legacy/full result
 * refs are returned untouched, preserving backward compatibility.
 */
export async function resolveCommandResultRef(
  db: DatabaseInstance,
  tenantId: string,
  resultRef: unknown
): Promise<unknown> {
  const payload = readDeferredPayload(resultRef);
  if (!payload) return resultRef;

  const sale = await getSaleRecord(db, tenantId, payload.saleId);
  if (payload.kind === 'sale_return') return sale;
  return {
    ...sale,
    change: payload.change,
    loyaltyPointsEarned: payload.loyaltyPointsEarned,
  };
}
