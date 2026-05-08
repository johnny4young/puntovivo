/**
 * ENG-070 — Operation event → public event projector.
 *
 * Pure function. Given an `operation_events` row, return the
 * corresponding `PublicEvent` (or `null` when the operation does not
 * map). Every command-driven public event passes through this
 * function; non-command-driven events (currently only
 * `fiscal_document.accepted`) are projected separately by their
 * owning worker via `projectFiscalDocumentAccepted`.
 *
 * The projector is INTENTIONALLY pure:
 *   - No DB reads / writes (caller passes the operation_events row).
 *   - No HTTP / network.
 *   - No throws — a malformed `summary` returns null + leaves a log
 *     entry for forensics. The caller (the operation-journal hook)
 *     never lets the original commit fail because of a webhook
 *     projection issue.
 *
 * Mapping table (`operationKind` + `status='succeeded'` only):
 *
 *   | operationKind            | event type                |
 *   |--------------------------|---------------------------|
 *   | sales.create             | sale.completed            |
 *   | sales.completeDraft      | sale.completed            |
 *   | sales.returnSale         | sale.refunded             |
 *   | inventory.adjustStock    | inventory.adjusted        |
 *   | cashSessions.close       | cash_session.closed       |
 *
 * `fiscal_document.accepted` is wired in the fiscal worker rather
 * than here because the trigger is a row-level UPDATE, not an
 * operation-event completion.
 *
 * @module services/events/projector
 */

import type { OperationEvent } from '../operation-journal/journal.js';
import {
  PUBLIC_EVENT_PAYLOAD_SCHEMAS,
  type PublicEvent,
  type PublicEventType,
} from './manifest.js';

/**
 * Tight wrapper around the operation_events row + an extracted
 * summary. Keeping this as a separate type avoids forcing the caller
 * to coerce `summary` to `Record<string, unknown>` at every call
 * site.
 */
export interface ProjectionInput {
  op: OperationEvent;
}

/**
 * The full mapping table. Adding a new command-driven public event
 * means adding a row here + extending the manifest. TS keeps the
 * value space narrow via the `PublicEventType` union.
 */
const KIND_TO_EVENT: Record<
  string,
  {
    type: PublicEventType;
    /**
     * Builds the payload by reading the op's summary. Returns null
     * to signal a malformed/missing summary — the caller treats null
     * as "skip this row" rather than throwing.
     */
    buildPayload: (
      op: OperationEvent,
      summary: Record<string, unknown>
    ) => Record<string, unknown> | null;
  }
> = {
  'sales.create': {
    type: 'sale.completed',
    buildPayload: (op, summary) => buildSaleCompletedPayload(op, summary),
  },
  'sales.completeDraft': {
    type: 'sale.completed',
    buildPayload: (op, summary) => buildSaleCompletedPayload(op, summary),
  },
  'sales.returnSale': {
    type: 'sale.refunded',
    buildPayload: (op, summary) => buildSaleRefundedPayload(op, summary),
  },
  'inventory.adjustStock': {
    type: 'inventory.adjusted',
    buildPayload: (op, summary) => buildInventoryAdjustedPayload(op, summary),
  },
  'cashSessions.close': {
    type: 'cash_session.closed',
    buildPayload: (op, summary) => buildCashSessionClosedPayload(op, summary),
  },
};

/**
 * Project an operation_events row into a public event envelope.
 *
 * Returns `null` when:
 *   - The op's `operationKind` is not in the mapping table (most
 *     ops don't map — that's expected).
 *   - The op's `status` is not 'succeeded' (failed / partial / started
 *     ops never project).
 *   - The op's `summary` is missing or non-object.
 *   - The payload builder returns null (defensive — missing required
 *     fields).
 *   - The Zod schema rejects the built payload.
 */
export function projectOperationEvent(input: ProjectionInput): PublicEvent | null {
  const { op } = input;

  if (op.status !== 'succeeded') {
    return null;
  }

  const mapping = KIND_TO_EVENT[op.operationKind];
  if (!mapping) {
    return null;
  }

  const summary = isPlainObject(op.summary) ? op.summary : null;
  if (!summary) {
    return null;
  }

  const payload = mapping.buildPayload(op, summary);
  if (!payload) {
    return null;
  }

  // Defensive validation: if the payload doesn't match the manifest
  // schema we treat it as projector mis-alignment and skip rather
  // than emit an invalid contract row.
  const schema = PUBLIC_EVENT_PAYLOAD_SCHEMAS[mapping.type];
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }

  const occurredAt = op.completedAt ?? op.startedAt ?? new Date().toISOString();

  return {
    type: mapping.type,
    version: 1,
    occurredAt,
    tenantId: op.tenantId,
    operationEventId: op.id,
    payload: parsed.data as Record<string, unknown>,
  };
}

/**
 * ENG-070 — Special-case projector for fiscal_document.accepted.
 *
 * The fiscal worker drives the status flip on `fiscal_documents`,
 * not the operation-journal. This builder accepts the same kind of
 * structured payload the worker has at hand and validates it
 * against the manifest schema. Tenants with `events-api` off skip
 * the call entirely; the worker checks the module gate.
 */
export function projectFiscalDocumentAccepted(input: {
  tenantId: string;
  operationEventId: string | null;
  payload: {
    fiscalDocumentId: string;
    cufe: string;
    documentNumber: string;
    source: string;
    sourceId: string;
    countryCode: string;
    providerId: string;
    acceptedAt: string;
  };
}): PublicEvent | null {
  const schema = PUBLIC_EVENT_PAYLOAD_SCHEMAS['fiscal_document.accepted'];
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success) {
    return null;
  }
  return {
    type: 'fiscal_document.accepted',
    version: 1,
    occurredAt: input.payload.acceptedAt,
    tenantId: input.tenantId,
    operationEventId: input.operationEventId,
    payload: parsed.data as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Per-event payload builders.
// ---------------------------------------------------------------------------

function buildSaleCompletedPayload(
  op: OperationEvent,
  summary: Record<string, unknown>
): Record<string, unknown> | null {
  const saleId = readString(summary.saleId);
  const saleNumber = readString(summary.saleNumber);
  const siteId = readString(summary.siteId);
  const cashSessionId = readString(summary.cashSessionId);
  const subtotal = readNumber(summary.subtotal);
  const taxAmount = readNumber(summary.taxAmount);
  const discountAmount = readNumber(summary.discountAmount);
  const total = readNumber(summary.total);
  const currencyCode = readString(summary.currencyCode);
  const paymentMethod = readString(summary.paymentMethod);

  if (
    saleId === null ||
    saleNumber === null ||
    siteId === null ||
    cashSessionId === null ||
    subtotal === null ||
    taxAmount === null ||
    discountAmount === null ||
    total === null ||
    currencyCode === null ||
    paymentMethod === null
  ) {
    return null;
  }

  // customerId is allowed null in the schema; readMaybeString
  // preserves null for missing keys but coerces non-strings.
  const customerId = readMaybeString(summary.customerId);

  return {
    saleId,
    saleNumber,
    siteId,
    cashSessionId,
    customerId,
    subtotal,
    taxAmount,
    discountAmount,
    total,
    currencyCode,
    paymentMethod,
    completedAt: op.completedAt ?? op.startedAt ?? new Date().toISOString(),
  };
}

function buildSaleRefundedPayload(
  op: OperationEvent,
  summary: Record<string, unknown>
): Record<string, unknown> | null {
  const saleReturnId = readString(summary.saleReturnId);
  const originalSaleId = readString(summary.originalSaleId);
  const siteId = readString(summary.siteId);
  const cashSessionId = readString(summary.cashSessionId);
  const refundedAmount = readNumber(summary.refundedAmount);
  const currencyCode = readString(summary.currencyCode);

  if (
    saleReturnId === null ||
    originalSaleId === null ||
    siteId === null ||
    cashSessionId === null ||
    refundedAmount === null ||
    currencyCode === null
  ) {
    return null;
  }

  const reasonCode = readMaybeString(summary.reasonCode);

  return {
    saleReturnId,
    originalSaleId,
    siteId,
    cashSessionId,
    refundedAmount,
    currencyCode,
    reasonCode,
    refundedAt: op.completedAt ?? op.startedAt ?? new Date().toISOString(),
  };
}

function buildInventoryAdjustedPayload(
  op: OperationEvent,
  summary: Record<string, unknown>
): Record<string, unknown> | null {
  const productId = readString(summary.productId);
  const siteId = readString(summary.siteId);
  const quantityBefore = readNumber(summary.quantityBefore);
  const quantityAfter = readNumber(summary.quantityAfter);
  const delta = readNumber(summary.delta);

  if (
    productId === null ||
    siteId === null ||
    quantityBefore === null ||
    quantityAfter === null ||
    delta === null
  ) {
    return null;
  }

  const locationId = readMaybeString(summary.locationId);
  const reasonCode = readMaybeString(summary.reasonCode);

  return {
    productId,
    siteId,
    locationId,
    quantityBefore,
    quantityAfter,
    delta,
    reasonCode,
    adjustedByUserId: op.userId,
    adjustedAt: op.completedAt ?? op.startedAt ?? new Date().toISOString(),
  };
}

function buildCashSessionClosedPayload(
  op: OperationEvent,
  summary: Record<string, unknown>
): Record<string, unknown> | null {
  const cashSessionId = readString(summary.cashSessionId);
  const siteId = readString(summary.siteId);
  const expectedCashBalance = readNumber(summary.expectedCashBalance);
  const countedCashBalance = readNumber(summary.countedCashBalance);
  const overShortAmount = readNumber(summary.overShortAmount);
  const currencyCode = readString(summary.currencyCode);
  const openedAt = readString(summary.openedAt);

  if (
    cashSessionId === null ||
    siteId === null ||
    expectedCashBalance === null ||
    countedCashBalance === null ||
    overShortAmount === null ||
    currencyCode === null ||
    openedAt === null
  ) {
    return null;
  }

  return {
    cashSessionId,
    siteId,
    cashierId: op.userId,
    openedAt,
    closedAt: op.completedAt ?? op.startedAt ?? new Date().toISOString(),
    expectedCashBalance,
    countedCashBalance,
    overShortAmount,
    currencyCode,
  };
}

// ---------------------------------------------------------------------------
// Defensive readers — never throw, return null on type mismatch.
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readMaybeString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
