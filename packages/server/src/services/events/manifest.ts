/**
 * ENG-070 — Public events manifest (v1).
 *
 * The single source of truth for the 5 public event types Puntovivo
 * exposes to integrators (future central server, ERP connectors,
 * email notifications, etc.). Every event has a versioned Zod
 * payload schema; the projector validates the payload before
 * enqueueing a `webhook_outbox` row, and `events.getContract` returns
 * the manifest as a discoverable surface.
 *
 * Adding a new event:
 *   1. Append to `PUBLIC_EVENT_TYPES`.
 *   2. Add a Zod schema entry in `PUBLIC_EVENT_PAYLOAD_SCHEMAS` (TS
 *      exhaustiveness on `Record<PublicEventType, ...>` blocks the
 *      forgotten arm at compile time).
 *   3. Wire the projector branch in `services/events/projector.ts`
 *      (or in the appropriate worker for non-command-driven events
 *      like `fiscal_document.accepted`).
 *   4. Bump `PUBLIC_EVENTS_VERSION` if the contract is breaking;
 *      additive changes keep the version.
 *
 * Tied to ADR-0003 (5 outboxes — webhook_outbox is #5) and ADR-0007
 * (events-as-modules pattern; the `events-api` module gates
 * projection per tenant).
 *
 * @module services/events/manifest
 */

import { z } from 'zod';

/**
 * Closed list of public event types ENG-070 v1 ships. The 5
 * named in the ROADMAP AC.
 */
export const PUBLIC_EVENT_TYPES = [
  'sale.completed',
  'sale.refunded',
  'inventory.adjusted',
  'cash_session.closed',
  'fiscal_document.accepted',
] as const;
export type PublicEventType = (typeof PUBLIC_EVENT_TYPES)[number];

/**
 * Manifest version. Bumped only on breaking contract changes (renamed
 * required fields, removed events). Additive changes (new event,
 * new optional field) keep the version constant — integrators read
 * the manifest to discover what's available.
 */
export const PUBLIC_EVENTS_VERSION = 1;

/**
 * Per-event payload schema. Each branch validates the projector
 * output before insertion into `webhook_outbox`. A failing parse is
 * treated as projector mis-alignment and logged — the original
 * operation's commit is NEVER blocked by a webhook validation
 * failure (best-effort enqueue).
 *
 * Use `safeParse` on read paths so unknown future fields are stripped
 * cleanly rather than rejecting the whole row.
 */
export const PUBLIC_EVENT_PAYLOAD_SCHEMAS = {
  /**
   * `sale.completed` — fired when a sale finishes successfully.
   * Includes both fresh checkouts (`sales.create`) and draft
   * completions (`sales.completeDraft`). Payment-method strings
   * mirror the internal POS enum (cash / card / transfer / credit /
   * other) so subscribers can map them downstream.
   */
  'sale.completed': z.object({
    saleId: z.string(),
    saleNumber: z.string(),
    siteId: z.string(),
    cashSessionId: z.string(),
    customerId: z.string().nullable(),
    subtotal: z.number(),
    taxAmount: z.number(),
    discountAmount: z.number(),
    total: z.number(),
    currencyCode: z.string(),
    paymentMethod: z.string(),
    completedAt: z.string(), // ISO 8601
  }),
  /**
   * `sale.refunded` — fired when a return is registered against an
   * existing sale. Carries the original sale id + the returned
   * subset so subscribers can reconcile inventory + fiscal state.
   */
  'sale.refunded': z.object({
    saleReturnId: z.string(),
    originalSaleId: z.string(),
    siteId: z.string(),
    cashSessionId: z.string(),
    refundedAmount: z.number(),
    currencyCode: z.string(),
    reasonCode: z.string().nullable(),
    refundedAt: z.string(), // ISO 8601
  }),
  /**
   * `inventory.adjusted` — fired when a manager calls
   * `inventory.adjustStock` to correct stock levels (counted vs.
   * recorded). Subscribers can mirror the adjustment into external
   * inventory systems.
   */
  'inventory.adjusted': z.object({
    productId: z.string(),
    siteId: z.string(),
    locationId: z.string().nullable(),
    quantityBefore: z.number(),
    quantityAfter: z.number(),
    delta: z.number(),
    reasonCode: z.string().nullable(),
    adjustedByUserId: z.string(),
    adjustedAt: z.string(), // ISO 8601
  }),
  /**
   * `cash_session.closed` — fired when a cashier closes a turn.
   * Carries the open/close totals + pickup amounts so subscribers
   * can build daily reconciliation views.
   */
  'cash_session.closed': z.object({
    cashSessionId: z.string(),
    siteId: z.string(),
    cashierId: z.string(),
    openedAt: z.string(),
    closedAt: z.string(),
    expectedCashBalance: z.number(),
    countedCashBalance: z.number(),
    overShortAmount: z.number(),
    currencyCode: z.string(),
  }),
  /**
   * `fiscal_document.accepted` — fired by the fiscal worker (NOT a
   * command-driven event) when a `fiscal_documents` row flips
   * status='accepted'. Subscribers can pair the public event with
   * the original sale to surface "facturado" badges externally.
   */
  'fiscal_document.accepted': z.object({
    fiscalDocumentId: z.string(),
    cufe: z.string(),
    documentNumber: z.string(),
    source: z.string(),
    sourceId: z.string(),
    countryCode: z.string(),
    providerId: z.string(),
    acceptedAt: z.string(), // ISO 8601
  }),
} as const satisfies Record<PublicEventType, z.ZodSchema>;

export type PublicEventPayload<T extends PublicEventType> = z.infer<
  (typeof PUBLIC_EVENT_PAYLOAD_SCHEMAS)[T]
>;

/**
 * The full public event envelope. `payload` holds the type-specific
 * data validated against the schema for `type`.
 */
export interface PublicEvent {
  type: PublicEventType;
  version: number;
  occurredAt: string;
  tenantId: string;
  /** Soft link back to the operation-journal row. Null for worker-driven events. */
  operationEventId: string | null;
  payload: Record<string, unknown>;
}

/**
 * Defensive type guard for unknown strings — useful when reading
 * stored event types out of `webhook_outbox` rows.
 */
export function isPublicEventType(value: string): value is PublicEventType {
  return (PUBLIC_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Returns the payload schema for a known event type. Throws on
 * unknown types — callers should narrow first via `isPublicEventType`.
 */
export function getPayloadSchema(type: PublicEventType): z.ZodSchema {
  const schema = PUBLIC_EVENT_PAYLOAD_SCHEMAS[type];
  if (!schema) {
    throw new Error(`Unknown public event type: ${type}`, {
      cause: {
        manifest: 'events',
        helper: 'getPayloadSchema',
        unknownType: type,
        known: PUBLIC_EVENT_TYPES,
      },
    });
  }
  return schema;
}

/**
 * Build the contract surface returned by `events.getContract`. The
 * Zod schemas are converted to a JSON-serializable shape via shape
 * extraction so the response can travel across tRPC without
 * carrying class instances.
 */
export interface PublicEventContract {
  version: number;
  eventTypes: ReadonlyArray<PublicEventType>;
  /**
   * Per-event field metadata. Each entry lists the field names + a
   * boolean for required-ness. Non-Zod-aware integrators get a
   * minimal but useful surface; ENG-070b can extend this with full
   * JSON Schema if needed.
   */
  fields: Record<PublicEventType, ReadonlyArray<{ name: string; required: boolean }>>;
}

export function buildPublicEventContract(): PublicEventContract {
  const fields: Record<PublicEventType, Array<{ name: string; required: boolean }>> = {
    'sale.completed': [],
    'sale.refunded': [],
    'inventory.adjusted': [],
    'cash_session.closed': [],
    'fiscal_document.accepted': [],
  };
  for (const type of PUBLIC_EVENT_TYPES) {
    const schema = PUBLIC_EVENT_PAYLOAD_SCHEMAS[type];
    // Zod 3 + 4 expose `.shape` on object schemas. Cast to access
    // the field map without coupling to internal types.
    const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape;
    if (!shape) continue;
    for (const [name, field] of Object.entries(shape)) {
      const required = !field.isOptional();
      fields[type].push({ name, required });
    }
  }
  return {
    version: PUBLIC_EVENTS_VERSION,
    eventTypes: PUBLIC_EVENT_TYPES,
    fields,
  };
}
