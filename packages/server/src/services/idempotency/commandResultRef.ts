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

/** Compact replay payload for a committed sale completion. */
interface SaleCompletionPayload {
  schemaVersion: 1;
  kind: 'sale_completion';
  saleId: string;
  responseShape: 'fresh' | 'completed_draft';
  change: number;
  loyaltyPointsEarned: number;
}

/** Compact replay payload for a committed full/partial return resource. */
interface SaleReturnPayload {
  schemaVersion: 1;
  kind: 'sale_return';
  saleId: string;
}

/** Compact replay payload for a committed draft lifecycle mutation. */
interface SaleResourcePayload {
  schemaVersion: 1;
  kind: 'sale_resource';
  saleId: string;
}

/** Compact replay payload for both aggregates created by a draft split. */
interface SaleSplitPayload {
  schemaVersion: 1;
  kind: 'sale_split';
  sourceSaleId: string;
  createdSaleId: string;
}

/** Every versioned sale reference that can be hydrated after commit. */
type DeferredCommandResultPayload =
  SaleCompletionPayload | SaleReturnPayload | SaleResourcePayload | SaleSplitPayload;

/** Marker object persisted when a completion response needs post-commit hydration. */
export interface SaleCompletionCommandResultRef {
  [COMMAND_RESULT_REF_KEY]: SaleCompletionPayload;
}

/** Marker object persisted when a return response needs post-commit hydration. */
export interface SaleReturnCommandResultRef {
  [COMMAND_RESULT_REF_KEY]: SaleReturnPayload;
}

/** Marker object persisted for a single draft-sale lifecycle response. */
export interface SaleResourceCommandResultRef {
  [COMMAND_RESULT_REF_KEY]: SaleResourcePayload;
}

/** Marker object persisted for a source/child draft split response. */
export interface SaleSplitCommandResultRef {
  [COMMAND_RESULT_REF_KEY]: SaleSplitPayload;
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

/** Hydrate a draft lifecycle command from its tenant-scoped sale aggregate. */
export function createSaleResourceCommandResultRef(saleId: string): SaleResourceCommandResultRef {
  return {
    [COMMAND_RESULT_REF_KEY]: {
      schemaVersion: 1,
      kind: 'sale_resource',
      saleId,
    },
  };
}

/** Hydrate both sides of an already committed draft split. */
export function createSaleSplitCommandResultRef(
  sourceSaleId: string,
  createdSaleId: string
): SaleSplitCommandResultRef {
  return {
    [COMMAND_RESULT_REF_KEY]: {
      schemaVersion: 1,
      kind: 'sale_split',
      sourceSaleId,
      createdSaleId,
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
  if ((payload as { kind?: unknown }).kind === 'sale_resource') {
    const candidate = payload as Partial<SaleResourcePayload>;
    if (typeof candidate.saleId !== 'string' || candidate.saleId.length === 0) {
      throw new Error('Malformed sale resource command result reference');
    }
    return candidate as SaleResourcePayload;
  }
  if ((payload as { kind?: unknown }).kind === 'sale_split') {
    const candidate = payload as Partial<SaleSplitPayload>;
    if (
      typeof candidate.sourceSaleId !== 'string' ||
      candidate.sourceSaleId.length === 0 ||
      typeof candidate.createdSaleId !== 'string' ||
      candidate.createdSaleId.length === 0
    ) {
      throw new Error('Malformed sale split command result reference');
    }
    return candidate as SaleSplitPayload;
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

  if (payload.kind === 'sale_split') {
    const [source, created] = await Promise.all([
      getSaleRecord(db, tenantId, payload.sourceSaleId),
      getSaleRecord(db, tenantId, payload.createdSaleId),
    ]);
    return { source, created };
  }
  const sale = await getSaleRecord(db, tenantId, payload.saleId);
  if (payload.kind === 'sale_return' || payload.kind === 'sale_resource') return sale;
  return {
    ...sale,
    change: payload.change,
    loyaltyPointsEarned: payload.loyaltyPointsEarned,
  };
}
