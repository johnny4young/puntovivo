/**
 * Drizzle schema — fiscal domain.
 *
 * ENG-178 — relocated verbatim from the former monolithic `db/schema.ts`
 * (5430 LOC) during the megafile decomposition. The flat `db/schema.ts`
 * is now a thin barrel that re-exports every domain module, so all 263
 * importers + drizzle-kit are unchanged and the schema shape is identical.
 *
 * @module db/schema/fiscal
 */
import { foreignKey, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';
import { moneyPositiveChecks, nowIso, sqliteNow } from './base.js';
import { sites, tenants, users } from './auth.js';
import { customers } from './customers.js';
import { countryCatalog, fiscalIdentificationTypes } from './config.js';

// ============================================================================
// FISCAL DOCUMENTS (ENG-020 Phase A — Colombia DIAN MVP)
// ============================================================================
//
// Four tenant-scoped tables that together model the fiscal-document
// lifecycle without committing to any specific Proveedor Tecnológico.
// ENG-021 (Fase B) swaps the `MockAdapter` implementation behind the
// `FiscalAdapter` interface for a real PT integration — the tables
// themselves do not change shape.
//
// Immutability contract: once a `fiscal_document` row is inserted it
// MUST NOT be updated except through a very narrow set of status
// transitions managed by `services/fiscal/orchestrator.ts`. The buyer
// and line snapshots are FROZEN at issuance time so later mutations
// of the `customers` / `products` rows cannot alter the emitted fiscal
// record. This is a legal requirement under DIAN Resolución 165/2023.
//
// Scope per tenant:
// - `fiscal_numbering_resolutions` — DIAN-issued consecutive ranges.
//   Each site holds one active range per kind (DEE, FEV, NC, ND).
// - `fiscal_certificates` — references to the p12 cert + passphrase
//   (stored out of band; only the ref + validity metadata lives here).
// - `fiscal_documents` — one row per emitted fiscal event.
// - `fiscal_document_items` — line snapshot; frozen product name/sku.

/** Kinds of fiscal documents DIAN recognises for POS / e-invoicing. */
export const fiscalDocumentKindEnum = ['DEE', 'FEV', 'NC', 'ND'] as const;
export type FiscalDocumentKind = (typeof fiscalDocumentKindEnum)[number];

/**
 * Lifecycle states a fiscal document can occupy.
 *
 * ENG-176c extended the set so the same enum can carry the
 * acknowledgement language of every LATAM authority Puntovivo plans to
 * integrate, not just DIAN:
 * - `pending` / `sent` / `accepted` / `rejected` / `contingency` —
 *   DIAN-native states from ENG-020 Phase A.
 * - `voided` — terminal state for SAT CFDI cancelaciones, SII DTE
 *   anulaciones, and NFe (Brazil) cancelamento; the original
 *   document is unrecoverable.
 * - `notified_correction` — SAT acuse de notificación de corrección;
 *   the authority asks the emitter to fix and re-submit. Non-terminal.
 * - `partial_send` — SUNAT batch acknowledgement where a subset of
 *   the lote's comprobantes was accepted and the rest must be
 *   resent. Non-terminal.
 *
 * Adapters map their provider-specific status code to the closest
 * canonical value here. The frontend (`FiscalStatusBadge.tsx`) keeps
 * a parallel union that mirrors this list one-for-one.
 */
export const fiscalDocumentStatusEnum = [
  'pending',
  'sent',
  'accepted',
  'rejected',
  'contingency',
  'voided',
  'notified_correction',
  'partial_send',
] as const;
export type FiscalDocumentStatus = (typeof fiscalDocumentStatusEnum)[number];

/** Source event that triggered the document. */
export const fiscalDocumentSourceEnum = ['sale', 'void', 'return'] as const;
export type FiscalDocumentSource = (typeof fiscalDocumentSourceEnum)[number];

export const fiscalNumberingResolutions = sqliteTable(
  'fiscal_numbering_resolutions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    siteId: text('site_id')
      .notNull()
      .references(() => sites.id),
    kind: text('kind', { enum: fiscalDocumentKindEnum }).notNull(),
    /** DIAN resolution number — opaque string the PT expects verbatim. */
    resolutionNumber: text('resolution_number').notNull(),
    prefix: text('prefix').notNull(),
    fromNumber: integer('from_number').notNull(),
    toNumber: integer('to_number').notNull(),
    currentNumber: integer('current_number').notNull(),
    /** Technical key provided by DIAN, used in CUFE inputs. */
    technicalKey: text('technical_key').notNull(),
    validFrom: text('valid_from').notNull(),
    validUntil: text('valid_until').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_fiscal_resolutions_tenant').on(table.tenantId),
    index('idx_fiscal_resolutions_site_kind').on(
      table.siteId,
      table.kind,
      table.isActive
    ),
  ]
);

export const fiscalCertificates = sqliteTable(
  'fiscal_certificates',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    alias: text('alias').notNull(),
    /** Reference (URL or path) to the p12 blob — never the blob itself. */
    p12Ref: text('p12_ref').notNull(),
    /** Reference to the passphrase (vault / KMS), never the passphrase. */
    passphraseRef: text('passphrase_ref').notNull(),
    /** PEM-encoded subject DN for the admin UI. Non-secret. */
    subjectDn: text('subject_dn'),
    validFrom: text('valid_from').notNull(),
    validUntil: text('valid_until').notNull(),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    createdAt: text('created_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [index('idx_fiscal_certificates_tenant').on(table.tenantId)]
);

export const fiscalDocuments = sqliteTable(
  'fiscal_documents',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Source event type (which sale lifecycle hook fired). */
    source: text('source', { enum: fiscalDocumentSourceEnum }).notNull(),
    /** Id of the source row — sale id, sale return id, etc. */
    sourceId: text('source_id').notNull(),
    /** DIAN document kind (DEE, FEV, NC, ND). */
    kind: text('kind', { enum: fiscalDocumentKindEnum }).notNull(),
    /** Numbering resolution used to generate the consecutive. */
    resolutionId: text('resolution_id')
      .notNull()
      .references(() => fiscalNumberingResolutions.id),
    consecutive: integer('consecutive').notNull(),
    documentNumber: text('document_number').notNull(),
    /**
     * CUFE (Código Único de Factura Electrónica). 96-char hex string
     * computed via SHA-384 per DIAN Resolución 165/2023. Unique.
     */
    cufe: text('cufe').notNull(),
    status: text('status', { enum: fiscalDocumentStatusEnum })
      .notNull()
      .default('pending'),
    // --- Buyer snapshot (frozen at emission) ---------------------------------
    /** null when consumidor final; otherwise the source customer id. */
    customerId: text('customer_id').references(() => customers.id),
    buyerTaxId: text('buyer_tax_id').notNull(),
    /**
     * ENG-176c — country whose authority issued the buyer's
     * identification type. Defaults to `'CO'` for legacy rows
     * (DIAN-only era). FK composes with `buyerTaxIdTypeCode` to
     * resolve a row in `fiscal_identification_types`.
     */
    buyerCountryCode: text('buyer_country_code')
      .notNull()
      .default('CO')
      .references(() => countryCatalog.code),
    /**
     * Authority code for the identification type. Composes with
     * `buyerCountryCode` against `fiscal_identification_types`.
     * No standalone `.references(...)` — the composite FK is declared
     * in the table-config callback below.
     */
    buyerTaxIdTypeCode: text('buyer_tax_id_type_code').notNull(),
    buyerName: text('buyer_name').notNull(),
    buyerEmail: text('buyer_email'),
    buyerAddress: text('buyer_address'),
    buyerCity: text('buyer_city'),
    buyerDepartment: text('buyer_department'),
    buyerCountry: text('buyer_country'),
    // --- Sale header snapshot ------------------------------------------------
    subtotal: real('subtotal').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    discountAmount: real('discount_amount').notNull().default(0),
    totalAmount: real('total_amount').notNull().default(0),
    currencyCode: text('currency_code').notNull(),
    localeCode: text('locale_code').notNull(),
    /**
     * When the source is `void` or `return`, this holds the CUFE of the
     * original `fiscal_documents` row being compensated.
     */
    originalCufe: text('original_cufe'),
    reasonCode: text('reason_code'),
    /** Provider that emitted the document. Fase A = 'mock'. */
    providerId: text('provider_id').notNull(),
    /** PT response JSON snapshot for troubleshooting. Null for MockAdapter. */
    providerResponse: text('provider_response', { mode: 'json' }).$type<
      Record<string, unknown> | null
    >(),
    /** Reference to the XML blob (storage path). Null until stored. */
    xmlRef: text('xml_ref'),
    /** Retry count for the contingency queue. */
    retries: integer('retries').notNull().default(0),
    emittedByUserId: text('emitted_by_user_id')
      .notNull()
      .references(() => users.id),
    emittedAt: text('emitted_at').notNull().default(sqliteNow).$defaultFn(nowIso),
    updatedAt: text('updated_at').notNull().default(sqliteNow).$defaultFn(nowIso),
  },
  table => [
    index('idx_fiscal_documents_tenant').on(table.tenantId),
    index('idx_fiscal_documents_source').on(table.source, table.sourceId),
    uniqueIndex('idx_fiscal_documents_cufe').on(table.cufe),
    uniqueIndex('idx_fiscal_documents_tenant_doc').on(
      table.tenantId,
      table.documentNumber
    ),
    index('idx_fiscal_documents_status').on(table.status),
    // ENG-176b — pin both invariants (nonneg + 2dec precision) on the
    // sale-header snapshot stored on the fiscal document. Recreation
    // of this table by migration 0037 also retro-fits the CHECKs the
    // Drizzle snapshot chain could not emit during ENG-176a.
    ...moneyPositiveChecks('fiscal_documents_subtotal', table.subtotal),
    ...moneyPositiveChecks('fiscal_documents_tax', table.taxAmount),
    ...moneyPositiveChecks('fiscal_documents_discount', table.discountAmount),
    ...moneyPositiveChecks('fiscal_documents_total', table.totalAmount),
    // ENG-176c — composite FK against `fiscal_identification_types`
    // PK (country_code, code). Replaces the legacy single-column FK
    // to `dian_identification_types.code` so SAT / SUNAT / SII rows
    // can resolve without colliding with DIAN codes.
    foreignKey({
      columns: [table.buyerCountryCode, table.buyerTaxIdTypeCode],
      foreignColumns: [
        fiscalIdentificationTypes.countryCode,
        fiscalIdentificationTypes.code,
      ],
      name: 'fiscal_documents_buyer_fiscal_identification_fk',
    }),
  ]
);

export const fiscalDocumentItems = sqliteTable(
  'fiscal_document_items',
  {
    id: text('id').primaryKey(),
    fiscalDocumentId: text('fiscal_document_id')
      .notNull()
      .references(() => fiscalDocuments.id, { onDelete: 'cascade' }),
    lineNumber: integer('line_number').notNull(),
    /** Product id at emission time — kept only for lineage; NOT joined. */
    productId: text('product_id'),
    /** Product name snapshot. Frozen. */
    productName: text('product_name').notNull(),
    productSku: text('product_sku'),
    /** Unit of measure code (DIAN spec: 'EA', 'KGM', 'LTR', …). */
    unitMeasureCode: text('unit_measure_code').notNull().default('EA'),
    quantity: real('quantity').notNull(),
    unitPrice: real('unit_price').notNull(),
    discountAmount: real('discount_amount').notNull().default(0),
    taxRate: real('tax_rate').notNull().default(0),
    taxAmount: real('tax_amount').notNull().default(0),
    /** DIAN tax category code ('01' IVA, '04' INC, '05' ReteIVA, …). */
    taxCategoryCode: text('tax_category_code').notNull().default('01'),
    lineTotal: real('line_total').notNull(),
  },
  table => [
    index('idx_fiscal_document_items_doc').on(table.fiscalDocumentId),
    // ENG-176b — line-level invariants on the fiscal snapshot.
    // currency_code is inherited implicitly from
    // `fiscal_documents.currency_code` via the `fiscal_document_id`
    // FK (no per-item column to avoid duplication; an item never
    // outlives its parent header).
    ...moneyPositiveChecks('fiscal_document_items_unit_price', table.unitPrice),
    ...moneyPositiveChecks('fiscal_document_items_discount', table.discountAmount),
    ...moneyPositiveChecks('fiscal_document_items_tax', table.taxAmount),
    ...moneyPositiveChecks('fiscal_document_items_total', table.lineTotal),
  ]
);

export const fiscalNumberingResolutionsRelations = relations(
  fiscalNumberingResolutions,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [fiscalNumberingResolutions.tenantId],
      references: [tenants.id],
    }),
    site: one(sites, {
      fields: [fiscalNumberingResolutions.siteId],
      references: [sites.id],
    }),
  })
);

export const fiscalDocumentsRelations = relations(
  fiscalDocuments,
  ({ one, many }) => ({
    tenant: one(tenants, {
      fields: [fiscalDocuments.tenantId],
      references: [tenants.id],
    }),
    resolution: one(fiscalNumberingResolutions, {
      fields: [fiscalDocuments.resolutionId],
      references: [fiscalNumberingResolutions.id],
    }),
    emittedBy: one(users, {
      fields: [fiscalDocuments.emittedByUserId],
      references: [users.id],
    }),
    items: many(fiscalDocumentItems),
  })
);

export const fiscalDocumentItemsRelations = relations(
  fiscalDocumentItems,
  ({ one }) => ({
    fiscalDocument: one(fiscalDocuments, {
      fields: [fiscalDocumentItems.fiscalDocumentId],
      references: [fiscalDocuments.id],
    }),
  })
);

// ============================================================================
// FISCAL OUTBOX (ENG-057 — first concrete consumer of the outbox kernel)
// ============================================================================

/**
 * Closed list of statuses for the fiscal outbox lifecycle, per
 * ADR-0003 §Fiscal outbox. The kernel writes `queued`, `submitting`,
 * `accepted`, `retrying`, `dead_letter`. The fiscal worker writes
 * `contingency` (operator-visible "we are knowingly off-line, retry
 * pending") and `rejected` (terminal-but-not-success when the
 * provider returns a non-recoverable rejection) before the kernel's
 * `complete` / `fail` transition narrows again.
 */
export const fiscalOutboxStatusEnum = [
  'queued',
  'submitting',
  'accepted',
  'rejected',
  'contingency',
  'retrying',
  'dead_letter',
] as const;
export type FiscalOutboxStatus = (typeof fiscalOutboxStatusEnum)[number];

/**
 * Closed list of fiscal outbox kinds. ENG-057 ships only `emit`;
 * `cancel` (DIAN cancellation), `retry_contingency` (re-enqueue
 * after manual operator action), and `fetch_status` (poll PT for
 * an in-flight CUFE) land incrementally per ADR-0003 sequencing.
 */
export const fiscalOutboxKindEnum = ['emit'] as const;
export type FiscalOutboxKind = (typeof fiscalOutboxKindEnum)[number];

/**
 * `fiscal_outbox` orchestrates the lifecycle of fiscal-document
 * delivery to the country adapter. Lives next to `fiscal_documents`
 * which remains the source of truth for each comprobante; the outbox
 * row tracks the communication-with-provider state.
 *
 * The status machine + retry policy + claim_token concurrency are
 * inherited from `lib/outbox/createOutboxKernel`. The fiscal worker
 * (`services/fiscal/fiscal-worker.ts`) drives state transitions and
 * mirrors the verdict back to `fiscal_documents.status` so existing
 * consumers (close-shift pending checks, FiscalContingencyIndicator,
 * `reports.fiscal.list`) keep working without joining this table.
 */
export const fiscalOutbox = sqliteTable(
  'fiscal_outbox',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id')
      .notNull()
      .references(() => tenants.id),
    status: text('status', { enum: fiscalOutboxStatusEnum }).notNull().default('queued'),
    kind: text('kind', { enum: fiscalOutboxKindEnum }).notNull().default('emit'),
    /**
     * FK to the pre-created `fiscal_documents` row (status='pending'
     * at enqueue time). Nullable to leave room for a future
     * raw-enqueue path (admin batch issue) that does not pre-create.
     * In ENG-057's flow this is always populated.
     */
    fiscalDocumentId: text('fiscal_document_id').references(
      () => fiscalDocuments.id,
      { onDelete: 'set null' }
    ),
    /** Snapshot of the resolved adapter providerId at enqueue. */
    providerId: text('provider_id'),
    /** Filled by the worker on `accepted`; redundant with `fiscal_documents.cufe`. */
    cufe: text('cufe'),
    /** `FiscalAdapterIssueInput` snapshot — worker MUST be able to retry without re-resolving. */
    payload: text('payload', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    attempts: integer('attempts').notNull().default(0),
    nextRetryAt: text('next_retry_at'),
    /** `NormalizedOutboxError` written by the kernel on `fail`. */
    lastError: text('last_error', { mode: 'json' }).$type<Record<string, unknown> | null>(),
    priority: real('priority').notNull().default(0),
    claimToken: text('claim_token'),
    lockedAt: text('locked_at'),
    createdAt: text('created_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
    updatedAt: text('updated_at')
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  table => [
    // Primary path for the kernel's claimNext: filter by tenant +
    // status (queued or retrying) ordered by priority + createdAt;
    // nextRetryAt is consulted as `IS NULL OR <= now`.
    index('idx_fiscal_outbox_tenant_status_retry').on(
      table.tenantId,
      table.status,
      table.nextRetryAt
    ),
    // Drilldown for the FiscalDocumentListPage retry button + the
    // manual-retry router lookup by document id.
    index('idx_fiscal_outbox_fiscal_document').on(table.fiscalDocumentId),
    // Operations Center listing + peek.
    index('idx_fiscal_outbox_tenant_created').on(table.tenantId, table.createdAt),
  ]
);

export const fiscalOutboxRelations = relations(fiscalOutbox, ({ one }) => ({
  tenant: one(tenants, {
    fields: [fiscalOutbox.tenantId],
    references: [tenants.id],
  }),
  fiscalDocument: one(fiscalDocuments, {
    fields: [fiscalOutbox.fiscalDocumentId],
    references: [fiscalDocuments.id],
  }),
}));

export type FiscalOutboxRow = typeof fiscalOutbox.$inferSelect;
export type NewFiscalOutboxRow = typeof fiscalOutbox.$inferInsert;
