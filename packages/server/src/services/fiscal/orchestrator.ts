/**
 * ENG-020 — fiscal document orchestrator.
 *
 * Single entry point (`emitFiscalDocument`) that the sale lifecycle
 * hooks call after the sale operation has committed. The function:
 *
 * 1. Validates the tenant has `fiscal_dian_enabled=true` in its
 *    settings JSON blob. Returns `null` when disabled (backward-compat
 *    path — existing tests keep passing because none of them set the
 *    flag on their synthetic tenants).
 * 2. Resolves the active `fiscal_numbering_resolution` for the source
 *    site + kind. Returns `null` when none is configured — the sale
 *    still completes, just without a fiscal document.
 * 3. Resolves the buyer snapshot (from the sale's customer, or the
 *    CONSUMIDOR_FINAL constants when `customerId` is null).
 * 4. Collects the line snapshots (product name, sku, tax) by joining
 *    sale_items → products.
 * 5. Reads the tenant's resolved locale for `currencyCode` + `locale`.
 * 6. Invokes the country-specific adapter supplied by the caller.
 * 7. Persists `fiscal_documents` + `fiscal_document_items` inside one
 *    local transaction, advances the resolution consecutive, and
 *    returns the new row id.
 *
 * Idempotency: the `(source, source_id, kind)` tuple is effectively
 * unique per tenant (a sale has at most one DEE, one NC, etc.).
 * Callers guard against re-invocation by skipping when a fiscal
 * document for the same tuple already exists.
 *
 * @module services/fiscal/orchestrator
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  companies,
  customers,
  cashSessions,
  fiscalIdentificationTypes,
  fiscalDocumentItems,
  fiscalDocuments,
  fiscalNumberingResolutions,
  fiscalOutbox,
  identificationTypes,
  products,
  saleItems,
  sales,
  tenants,
  type FiscalDocumentKind,
  type FiscalDocumentSource,
} from '../../db/schema.js';
import type { PuntovivoLogger } from '../../logging/logger.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import type {
  FiscalAdapter,
  FiscalAdapterIssueInput,
  FiscalAdapterLine,
} from './adapter.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { CONSUMIDOR_FINAL, type FiscalEnvironment } from './cufe.js';
import { tickDefaultFiscalWorker } from './fiscal-worker.js';
import { allocateNextFolio } from './packs/cl/caf-allocator.js';
import { mapInternalKindToTipoDte } from './packs/cl/mappings.js';
import { getFiscalAdapter, isSupportedFiscalCountry } from './registry.js';

export interface EmitFiscalDocumentArgs {
  /** Database handle used for reads and the local fiscal write transaction. */
  tx: DatabaseInstance;
  tenantId: string;
  userId: string;
  source: FiscalDocumentSource;
  /** Sale id for sale/void sources; saleReturns id for return source. */
  sourceId: string;
  /** Sale id that the document emission is about — matches `sourceId` for sales, the underlying sale for returns/voids. */
  saleId: string;
  kind: FiscalDocumentKind;
  /** When source is void/return, pass the original sale's fiscal doc CUFE. */
  // ENG-179b — explicit `| undefined` so callers can pass
  // `originalCufe: maybeCufe` (built from a nullable DB row) without
  // violating `exactOptionalPropertyTypes`.
  originalCufe?: string | undefined;
  reasonCode?: string | undefined;
  /** Country-specific adapter selected by the sale lifecycle caller. */
  adapter: FiscalAdapter;
  /** Environment flag. Fase A defaults to '2' (sandbox). */
  environment?: FiscalEnvironment | undefined;
}

export interface EmitFiscalDocumentResult {
  id: string;
  cufe: string;
  documentNumber: string;
  status: string;
}

/** ISO `YYYY-MM-DD` + `HH:mm:ssZZ` pair for the emission timestamp. */
function splitIssueTimestamp(now: Date): { issueDate: string; issueTime: string } {
  const iso = now.toISOString();
  return {
    issueDate: iso.slice(0, 10),
    issueTime: iso.slice(11, 19) + 'Z',
  };
}

/**
 * Maps an identification-type abbreviation to the DIAN 2-digit code.
 * Used when the tenant's own catalog does not carry a DIAN code
 * mapping (Fase A limitation — ENG-021 wires the mapping explicitly).
 */
function abbrToDianCode(abbr: string | null | undefined): string {
  switch ((abbr ?? '').toUpperCase()) {
    case 'CC':
      return '13';
    case 'NIT':
      return '31';
    case 'TI':
      return '12';
    case 'CE':
      return '22';
    case 'PA':
      return '41';
    case 'RC':
      return '11';
    case 'NUIP':
      return '91';
    default:
      return '13';
  }
}

interface ResolvedBuyer {
  customerId: string | null;
  taxId: string;
  taxIdTypeCode: string;
  name: string;
  email: string | null;
  address: string | null;
  city: string | null;
  department: string | null;
  country: string | null;
}

async function resolveBuyer(
  tx: DatabaseInstance,
  tenantId: string,
  customerId: string | null
): Promise<ResolvedBuyer> {
  if (!customerId) {
    return {
      customerId: null,
      taxId: CONSUMIDOR_FINAL.taxId,
      taxIdTypeCode: CONSUMIDOR_FINAL.taxIdTypeCode,
      name: CONSUMIDOR_FINAL.name,
      email: null,
      address: null,
      city: null,
      department: null,
      country: null,
    };
  }

  const row = await tx
    .select({
      id: customers.id,
      name: customers.name,
      email: customers.email,
      address: customers.address,
      city: customers.city,
      state: customers.state,
      country: customers.country,
      taxId: customers.taxId,
      identificationTypeId: customers.identificationTypeId,
    })
    .from(customers)
    .where(and(eq(customers.id, customerId), eq(customers.tenantId, tenantId)))
    .get();

  if (!row) {
    // Customer was deleted between sale creation and emission; fall
    // back to consumidor final so the emission does not block the
    // sale lifecycle.
    return {
      customerId: null,
      taxId: CONSUMIDOR_FINAL.taxId,
      taxIdTypeCode: CONSUMIDOR_FINAL.taxIdTypeCode,
      name: CONSUMIDOR_FINAL.name,
      email: null,
      address: null,
      city: null,
      department: null,
      country: null,
    };
  }

  let taxIdTypeCode = '13';
  if (row.identificationTypeId) {
    const idType = await tx
      .select({ code: identificationTypes.code })
      .from(identificationTypes)
      .where(eq(identificationTypes.id, row.identificationTypeId))
      .get();
    taxIdTypeCode = abbrToDianCode(idType?.code ?? null);
  }

  // Sanity: confirm the resolved code exists in the global catalog so
  // the composite FK on `fiscal_documents.(buyer_country_code,
  // buyer_tax_id_type_code)` does not fail. ENG-176c — the orchestrator
  // emits DIAN documents (Colombia) today; multi-country support
  // arrives with ENG-156 / ENG-161 when the adapter routes carry the
  // tenant locale through. Until then, hard-code 'CO' for the lookup.
  const buyerCountryCode = 'CO';
  const catalog = await tx
    .select({ code: fiscalIdentificationTypes.code })
    .from(fiscalIdentificationTypes)
    .where(
      and(
        eq(fiscalIdentificationTypes.countryCode, buyerCountryCode),
        eq(fiscalIdentificationTypes.code, taxIdTypeCode)
      )
    )
    .get();
  if (!catalog) {
    taxIdTypeCode = '13';
  }

  return {
    customerId: row.id,
    taxId: row.taxId ?? CONSUMIDOR_FINAL.taxId,
    taxIdTypeCode,
    name: row.name,
    email: row.email,
    address: row.address,
    city: row.city,
    department: row.state,
    country: row.country,
  };
}

interface ResolvedLine {
  lineNumber: number;
  productId: string;
  productName: string;
  productSku: string | null;
  quantity: number;
  unitPrice: number;
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Country-aware fiscal toggles live under `settings.fiscal.<country>.enabled`.
 * When the namespace is absent we preserve the legacy `fiscal_dian_enabled`
 * behavior so Colombia and older tenants keep working.
 */
function isCountryFiscalEnabled(
  settings: Record<string, unknown>,
  countryCode: string
): boolean {
  const fiscal = settings.fiscal;
  if (!isPlainRecord(fiscal)) return true;

  const countrySettings = fiscal[countryCode.toLowerCase()];
  if (!isPlainRecord(countrySettings)) return true;

  return countrySettings.enabled !== false;
}

async function resolveLines(
  tx: DatabaseInstance,
  tenantId: string,
  saleId: string
): Promise<ResolvedLine[]> {
  const rows = await tx
    .select({
      id: saleItems.id,
      productId: saleItems.productId,
      productName: products.name,
      productSku: products.sku,
      quantity: saleItems.quantity,
      unitPrice: saleItems.unitPrice,
      discount: saleItems.discount,
      taxRate: saleItems.taxRate,
      taxAmount: saleItems.taxAmount,
      total: saleItems.total,
    })
    .from(saleItems)
    .innerJoin(products, eq(saleItems.productId, products.id))
    .where(
      and(
        eq(saleItems.saleId, saleId),
        eq(products.tenantId, tenantId)
      )
    )
    .all();

  return rows.map((row, index) => ({
    lineNumber: index + 1,
    productId: row.productId,
    productName: row.productName ?? 'Unknown product',
    productSku: row.productSku,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    discountAmount: (row.unitPrice * row.quantity * (row.discount ?? 0)) / 100,
    taxRate: row.taxRate ?? 0,
    taxAmount: row.taxAmount ?? 0,
    lineTotal: row.total,
  }));
}

/**
 * Check whether the tenant has opted into DIAN emission. Stored in the
 * JSON settings blob to avoid a migration until the feature is widely
 * adopted. `true`, `"true"`, or `1` all count as enabled.
 */
async function isDianEnabled(
  tx: DatabaseInstance,
  tenantId: string
): Promise<boolean> {
  const row = await tx
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  if (!row) return false;
  const settings = (row.settings ?? {}) as Record<string, unknown>;
  const flag = settings.fiscal_dian_enabled ?? settings.fiscalDianEnabled;
  return flag === true || flag === 'true' || flag === 1;
}

/**
 * Emit a fiscal document for a sale-lifecycle event (legacy synchronous
 * path — the live sale lifecycle now routes through `enqueueFiscalEmission`
 * since ENG-057; this entry point is retained for adapters/tests that need
 * the in-band issue + persist in a single call).
 *
 * Invariants:
 * - Idempotent by `(tenantId, source, sourceId, kind)`: a replay returns
 *   the existing row instead of issuing a second document. The check runs
 *   twice — once before the adapter call (fast path) and once again INSIDE
 *   the write transaction (`duplicate` probe at the top of `writeTx`) so a
 *   concurrent emitter that won the race is honoured rather than producing a
 *   duplicate insert.
 * - Buyer + line data are SNAPSHOT into `fiscal_documents` /
 *   `fiscal_document_items` at emission time. Editing the customer or the
 *   product later never mutates an already-emitted document — the legal
 *   record reflects the state at the instant of issue, per Resolución DIAN
 *   165/2023 (the CUFE is computed over this frozen payload).
 * - The numbering consecutive advances INSIDE the same write transaction as
 *   the document insert (`update(fiscalNumberingResolutions)` with a
 *   versioned WHERE on the resolution row). The post-update guard
 *   `updateResult.changes !== 1` throws `FISCAL_SEQUENTIAL_NOT_ADVANCED`
 *   (CONFLICT) when a concurrent emitter advanced the same resolution first
 *   — a TOCTOU guard that rolls the whole transaction back rather than
 *   burning a gapped/duplicated consecutive.
 *
 * Preconditions:
 * - The tenant has opted into DIAN (`fiscal_dian_enabled`) AND the country
 *   pack is enabled for `adapter.countryCode`; otherwise returns `null`.
 * - The sale exists, carries a `cashSessionId` (the site is resolved through
 *   it), has an active numbering resolution for its `(site, kind)`, and has
 *   at least one line. Any missing prerequisite returns `null` cleanly — the
 *   caller treats `null` as "no document for this sale", never an error.
 *
 * Postconditions:
 * - On success: one `fiscal_documents` row + N `fiscal_document_items` rows
 *   committed, the resolution consecutive advanced by exactly 1, and the
 *   `{ id, cufe, documentNumber, status }` summary returned.
 * - On idempotent replay: the existing summary, no new rows, no consecutive
 *   advance.
 * - On any prerequisite miss: `null`, no rows, no consecutive advance.
 */
export async function emitFiscalDocument(
  args: EmitFiscalDocumentArgs
): Promise<EmitFiscalDocumentResult | null> {
  const { tx, tenantId, userId, source, sourceId, saleId, kind, adapter } = args;

  if (!(await isDianEnabled(tx, tenantId))) {
    return null;
  }

  const existing = await tx
    .select({
      id: fiscalDocuments.id,
      cufe: fiscalDocuments.cufe,
      documentNumber: fiscalDocuments.documentNumber,
      status: fiscalDocuments.status,
    })
    .from(fiscalDocuments)
    .where(
      and(
        eq(fiscalDocuments.tenantId, tenantId),
        eq(fiscalDocuments.source, source),
        eq(fiscalDocuments.sourceId, sourceId),
        eq(fiscalDocuments.kind, kind)
      )
    )
    .get();
  if (existing) {
    return existing;
  }

  // Resolve the active numbering resolution for the sale's site.
  const sale = await tx
    .select({
      id: sales.id,
      tenantId: sales.tenantId,
      customerId: sales.customerId,
      cashSessionId: sales.cashSessionId,
      paymentMethod: sales.paymentMethod,
      subtotal: sales.subtotal,
      taxAmount: sales.taxAmount,
      discountAmount: sales.discountAmount,
      total: sales.total,
    })
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .get();
  if (!sale) return null;

  // `fiscal_numbering_resolutions` is per-site; use the sale's cash
  // session to find the site. Sales without a cash session (legacy
  // paths) skip fiscal emission.
  if (!sale.cashSessionId) return null;

  const saleSite = await tx
    .select({ siteId: cashSessions.siteId })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.id, sale.cashSessionId),
        eq(cashSessions.tenantId, tenantId)
      )
    )
    .get();
  if (!saleSite) return null;

  const resolution = await tx
    .select()
    .from(fiscalNumberingResolutions)
    .where(
      and(
        eq(fiscalNumberingResolutions.tenantId, tenantId),
        eq(fiscalNumberingResolutions.siteId, saleSite.siteId),
        eq(fiscalNumberingResolutions.kind, kind),
        eq(fiscalNumberingResolutions.isActive, true)
      )
    )
    .get();
  if (!resolution) return null;

  const locale = await resolveTenantLocale(tx, tenantId);
  const buyer = await resolveBuyer(tx, tenantId, sale.customerId);
  const lines = await resolveLines(tx, tenantId, saleId);
  if (lines.length === 0) return null;

  // ENG-035b: surface tenant settings + emisor legal name to the
  // adapter so country packs (MX, CL) can read their pack-specific
  // settings without coupling to the DB layer.
  const tenantRow = await tx
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const tenantSettings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  if (!isCountryFiscalEnabled(tenantSettings, adapter.countryCode)) {
    return null;
  }

  const companyRow = await tx
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.tenantId, tenantId))
    .limit(1)
    .get();
  const issuerName = companyRow?.name ?? null;

  const adapterLines: FiscalAdapterLine[] = lines.map(line => ({
    lineNumber: line.lineNumber,
    productName: line.productName,
    productSku: line.productSku ?? null,
    unitMeasureCode: 'EA',
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    taxRate: line.taxRate,
    taxAmount: line.taxAmount,
    taxCategoryCode: '01',
    lineTotal: line.lineTotal,
  }));

  const consecutive = resolution.currentNumber + 1;
  const documentNumber = `${resolution.prefix}${consecutive.toString().padStart(10, '0')}`;
  const { issueDate, issueTime } = splitIssueTimestamp(new Date());

  const adapterInput: FiscalAdapterIssueInput = {
    tenantId,
    source,
    sourceId,
    kind,
    issueDate,
    issueTime,
    environment: args.environment ?? '2',
    issuerNit: tenantId,
    issuerName: issuerName ?? undefined,
    tenantSettings,
    currencyCode: locale.currency,
    localeCode: locale.locale,
    paymentMethod: sale.paymentMethod,
    resolution: {
      id: resolution.id,
      resolutionNumber: resolution.resolutionNumber,
      prefix: resolution.prefix,
      technicalKey: resolution.technicalKey,
      consecutive,
      documentNumber,
    },
    buyer: {
      taxId: buyer.taxId,
      taxIdTypeCode: buyer.taxIdTypeCode,
      name: buyer.name,
      email: buyer.email,
      address: buyer.address,
      city: buyer.city,
      department: buyer.department,
      country: buyer.country,
    },
    subtotal: sale.subtotal,
    ivaAmount: sale.taxAmount,
    incAmount: 0,
    icaAmount: 0,
    discountAmount: sale.discountAmount,
    totalAmount: sale.total,
    lines: adapterLines,
    originalCufe: args.originalCufe,
    reasonCode: args.reasonCode,
  };

  const issued = await adapter.issue(adapterInput);

  const fiscalDocumentId = nanoid();
  const now = new Date().toISOString();

  return tx.transaction(writeTx => {
    const duplicate = writeTx
      .select({
        id: fiscalDocuments.id,
        cufe: fiscalDocuments.cufe,
        documentNumber: fiscalDocuments.documentNumber,
        status: fiscalDocuments.status,
      })
      .from(fiscalDocuments)
      .where(
        and(
          eq(fiscalDocuments.tenantId, tenantId),
          eq(fiscalDocuments.source, source),
          eq(fiscalDocuments.sourceId, sourceId),
          eq(fiscalDocuments.kind, kind)
        )
      )
      .get();
    if (duplicate) {
      return duplicate;
    }

    writeTx.insert(fiscalDocuments)
      .values({
        id: fiscalDocumentId,
        tenantId,
        source,
        sourceId,
        kind,
        resolutionId: resolution.id,
        consecutive,
        documentNumber,
        cufe: issued.cufe,
        status: issued.status,
        customerId: buyer.customerId,
        buyerTaxId: buyer.taxId,
        buyerTaxIdTypeCode: buyer.taxIdTypeCode,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        buyerAddress: buyer.address,
        buyerCity: buyer.city,
        buyerDepartment: buyer.department,
        buyerCountry: buyer.country,
        subtotal: sale.subtotal,
        taxAmount: sale.taxAmount,
        discountAmount: sale.discountAmount,
        totalAmount: sale.total,
        currencyCode: locale.currency,
        localeCode: locale.locale,
        originalCufe: args.originalCufe ?? null,
        reasonCode: args.reasonCode ?? null,
        providerId: issued.providerId,
        providerResponse: issued.providerResponse,
        xmlRef: issued.xmlRef,
        retries: 0,
        emittedByUserId: userId,
        emittedAt: now,
        updatedAt: now,
      })
      .run();

    for (const line of lines) {
      writeTx.insert(fiscalDocumentItems)
        .values({
          id: nanoid(),
          fiscalDocumentId,
          lineNumber: line.lineNumber,
          productId: line.productId,
          productName: line.productName,
          productSku: line.productSku,
          unitMeasureCode: 'EA',
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          taxCategoryCode: '01',
          lineTotal: line.lineTotal,
        })
        .run();
    }

    const updateResult = writeTx.update(fiscalNumberingResolutions)
      .set({ currentNumber: consecutive, updatedAt: now })
      .where(
        and(
          eq(fiscalNumberingResolutions.id, resolution.id),
          eq(fiscalNumberingResolutions.tenantId, tenantId),
          eq(fiscalNumberingResolutions.siteId, saleSite.siteId),
          eq(fiscalNumberingResolutions.kind, kind)
        )
      )
      .run();

    if (updateResult.changes !== 1) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'FISCAL_SEQUENTIAL_NOT_ADVANCED',
        message: 'Fiscal numbering resolution was not advanced',
        details: {
          resolutionId: resolution.id,
          tenantId,
          siteId: saleSite.siteId,
          kind,
          expectedConsecutive: consecutive,
        },
      });
    }

    return {
      id: fiscalDocumentId,
      cufe: issued.cufe,
      documentNumber,
      status: issued.status,
    };
  });
}

/**
 * ENG-057 — Pre-create the `fiscal_documents` row + enqueue a
 * `fiscal_outbox` row in ONE local transaction (the ENG-057 inversion of
 * the legacy `emitFiscalDocument`: the adapter is NOT called inline here —
 * the fiscal worker `services/fiscal/fiscal-worker.ts` drains the outbox,
 * calls the adapter out-of-band, and mirrors the verdict back to
 * `fiscal_documents.status`).
 *
 * Invariants:
 * - Idempotent by `(tenantId, source, sourceId, kind)`: replay of the same
 *   envelope returns the existing summary. The check runs twice — once on
 *   the outer connection (fast path) and once again INSIDE the write
 *   transaction (`duplicate` probe) so a concurrent enqueue that won the
 *   race is honoured rather than double-inserting.
 * - Buyer + line data are SNAPSHOT into `fiscal_documents` /
 *   `fiscal_document_items` (and embedded in the outbox `adapterInput`
 *   payload) at enqueue time. The worker issues against this frozen payload
 *   without re-querying the customer/products, so a later edit to the
 *   customer or a product never alters the in-flight legal document.
 * - The numbering consecutive advances INSIDE the same write transaction as
 *   the pre-create. The post-update guard `updateResult.changes !== 1`
 *   throws `FISCAL_SEQUENTIAL_NOT_ADVANCED` (CONFLICT) on a concurrent
 *   advance — a TOCTOU guard that rolls the whole transaction back (no row
 *   inserted, no outbox enqueued, no folio burned). Trade-off: a
 *   dead-lettered emission burns a consecutive DIAN never sees — accepted
 *   per ADR-0003 §Fiscal outbox; ENG-058 may revisit with reserve-on-enqueue.
 * - The CUFE column is seeded with a `pending-<nanoid>` placeholder that
 *   satisfies the `fiscal_documents.cufe` UNIQUE constraint at insert; the
 *   worker overwrites it with the adapter-returned CUFE on `accepted`.
 * - Chile only (ENG-036b): the next CAF folio is allocated inside the same
 *   write transaction (`allocateNextFolio`), so the folio cursor advance,
 *   the document insert, and the outbox enqueue commit atomically — a
 *   `CAF_NOT_AVAILABLE` / `CAF_EXHAUSTED` throw rolls all three back.
 *
 * Preconditions:
 * - Same null surface as `emitFiscalDocument`: returns `null` when DIAN is
 *   disabled, the country pack is disabled, the sale has no cash session /
 *   no active resolution / no items, OR the country pack's `validateConfig`
 *   rejects (config error → skip enqueue; the operator must fix settings).
 *   Callers (sale lifecycle services) tolerate `null` without throwing.
 *
 * Postconditions:
 * - On success: a `fiscal_documents` row at `status='pending'`, its items,
 *   the advanced consecutive, and a `queued` `fiscal_outbox` row — all in
 *   one commit. Returns `{ id, cufe: placeholderCufe, documentNumber,
 *   status: 'pending' }`.
 * - Errors thrown here MUST NOT propagate past the back-compat shim
 *   `safelyEmitFiscalDocument` so the sale lifecycle stays unaffected.
 */
export async function enqueueFiscalEmission(args: {
  db: DatabaseInstance;
  tenantId: string;
  userId: string;
  log: Pick<PuntovivoLogger, 'warn' | 'info' | 'debug' | 'error'>;
  source: FiscalDocumentSource;
  sourceId: string;
  saleId: string;
  kind: FiscalDocumentKind;
  // ENG-179b — explicit `| undefined` on optional fields so the
  // sale lifecycle can forward `args.originalCufe` (typed
  // `string | undefined`) without violating `exactOptionalPropertyTypes`.
  originalCufe?: string | undefined;
  reasonCode?: string | undefined;
  environment?: FiscalEnvironment | undefined;
}): Promise<EmitFiscalDocumentResult | null> {
  const { db, tenantId, userId, source, sourceId, saleId, kind } = args;

  if (!(await isDianEnabled(db, tenantId))) {
    return null;
  }

  const existing = await db
    .select({
      id: fiscalDocuments.id,
      cufe: fiscalDocuments.cufe,
      documentNumber: fiscalDocuments.documentNumber,
      status: fiscalDocuments.status,
    })
    .from(fiscalDocuments)
    .where(
      and(
        eq(fiscalDocuments.tenantId, tenantId),
        eq(fiscalDocuments.source, source),
        eq(fiscalDocuments.sourceId, sourceId),
        eq(fiscalDocuments.kind, kind)
      )
    )
    .get();
  if (existing) {
    return existing;
  }

  const sale = await db
    .select({
      id: sales.id,
      tenantId: sales.tenantId,
      customerId: sales.customerId,
      cashSessionId: sales.cashSessionId,
      paymentMethod: sales.paymentMethod,
      subtotal: sales.subtotal,
      taxAmount: sales.taxAmount,
      discountAmount: sales.discountAmount,
      total: sales.total,
    })
    .from(sales)
    .where(and(eq(sales.id, saleId), eq(sales.tenantId, tenantId)))
    .get();
  if (!sale || !sale.cashSessionId) return null;

  const saleSite = await db
    .select({ siteId: cashSessions.siteId })
    .from(cashSessions)
    .where(
      and(
        eq(cashSessions.id, sale.cashSessionId),
        eq(cashSessions.tenantId, tenantId)
      )
    )
    .get();
  if (!saleSite) return null;

  const resolution = await db
    .select()
    .from(fiscalNumberingResolutions)
    .where(
      and(
        eq(fiscalNumberingResolutions.tenantId, tenantId),
        eq(fiscalNumberingResolutions.siteId, saleSite.siteId),
        eq(fiscalNumberingResolutions.kind, kind),
        eq(fiscalNumberingResolutions.isActive, true)
      )
    )
    .get();
  if (!resolution) return null;

  const locale = await resolveTenantLocale(db, tenantId);
  // ENG-185 — no fiscal pack for this country: skip emission cleanly. This
  // keeps the sale lifecycle non-fatal (best-effort, like the other null
  // returns here) and never emits a Colombia-shaped fallback document for a
  // country we do not actually support.
  if (!isSupportedFiscalCountry(locale.countryCode)) {
    return null;
  }
  const adapter = getFiscalAdapter(locale.countryCode);
  const buyer = await resolveBuyer(db, tenantId, sale.customerId);
  const lines = await resolveLines(db, tenantId, saleId);
  if (lines.length === 0) return null;

  const tenantRow = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  const tenantSettings = (tenantRow?.settings ?? {}) as Record<string, unknown>;
  if (!isCountryFiscalEnabled(tenantSettings, adapter.countryCode)) {
    return null;
  }

  // ENG-057 — Adapter pre-flight: when the country pack reports
  // structurally invalid configuration (missing RFC for MX, missing
  // RUT for CL, etc.), do NOT pre-create a fiscal_documents row.
  // This is config-error territory, not a provider outage — the
  // operator must fix settings before any emission is attempted.
  // The legacy `safelyEmitFiscalDocument` swallowed the adapter
  // throw; ENG-057 surfaces the same null behavior more cleanly by
  // calling `validateConfig` first.
  try {
    const validation = await adapter.validateConfig({
      tenantId,
      countryCode: adapter.countryCode,
      settings: tenantSettings,
    });
    if (!validation.ok) {
      args.log.debug(
        { tenantId, countryCode: adapter.countryCode, issues: validation.issues },
        'fiscal pack validateConfig rejected; skipping enqueue'
      );
      return null;
    }
  } catch (validationErr) {
    args.log.warn(
      { err: validationErr, tenantId, countryCode: adapter.countryCode },
      'fiscal pack validateConfig threw; skipping enqueue'
    );
    return null;
  }

  const companyRow = await db
    .select({ name: companies.name })
    .from(companies)
    .where(eq(companies.tenantId, tenantId))
    .limit(1)
    .get();
  const issuerName = companyRow?.name ?? null;

  const adapterLines: FiscalAdapterLine[] = lines.map(line => ({
    lineNumber: line.lineNumber,
    productName: line.productName,
    productSku: line.productSku ?? null,
    unitMeasureCode: 'EA',
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    discountAmount: line.discountAmount,
    taxRate: line.taxRate,
    taxAmount: line.taxAmount,
    taxCategoryCode: '01',
    lineTotal: line.lineTotal,
  }));

  const consecutive = resolution.currentNumber + 1;
  const documentNumber = `${resolution.prefix}${consecutive.toString().padStart(10, '0')}`;
  const { issueDate, issueTime } = splitIssueTimestamp(new Date());

  const adapterInput: FiscalAdapterIssueInput = {
    tenantId,
    source,
    sourceId,
    kind,
    issueDate,
    issueTime,
    environment: args.environment ?? '2',
    issuerNit: tenantId,
    issuerName: issuerName ?? undefined,
    tenantSettings,
    currencyCode: locale.currency,
    localeCode: locale.locale,
    paymentMethod: sale.paymentMethod,
    resolution: {
      id: resolution.id,
      resolutionNumber: resolution.resolutionNumber,
      prefix: resolution.prefix,
      technicalKey: resolution.technicalKey,
      consecutive,
      documentNumber,
    },
    buyer: {
      taxId: buyer.taxId,
      taxIdTypeCode: buyer.taxIdTypeCode,
      name: buyer.name,
      email: buyer.email,
      address: buyer.address,
      city: buyer.city,
      department: buyer.department,
      country: buyer.country,
    },
    subtotal: sale.subtotal,
    ivaAmount: sale.taxAmount,
    incAmount: 0,
    icaAmount: 0,
    discountAmount: sale.discountAmount,
    totalAmount: sale.total,
    lines: adapterLines,
    originalCufe: args.originalCufe,
    reasonCode: args.reasonCode,
  };

  const fiscalDocumentId = nanoid();
  // Placeholder CUFE — random unique token that satisfies the
  // fiscal_documents.cufe UNIQUE constraint at insert time. The
  // worker overwrites with the adapter's real CUFE on `accepted`.
  // Format `pending-<nanoid>` is intentional so an operator
  // inspecting raw rows can tell at a glance whether a document
  // has been finalized.
  const placeholderCufe = `pending-${nanoid(40)}`;
  const now = new Date().toISOString();

  return db.transaction(writeTx => {
    const duplicate = writeTx
      .select({
        id: fiscalDocuments.id,
        cufe: fiscalDocuments.cufe,
        documentNumber: fiscalDocuments.documentNumber,
        status: fiscalDocuments.status,
      })
      .from(fiscalDocuments)
      .where(
        and(
          eq(fiscalDocuments.tenantId, tenantId),
          eq(fiscalDocuments.source, source),
          eq(fiscalDocuments.sourceId, sourceId),
          eq(fiscalDocuments.kind, kind)
        )
      )
      .get();
    if (duplicate) {
      return duplicate;
    }

    // ENG-036b — Chile: pre-allocate the next CAF folio inside this
    // write transaction so the cursor advance + the fiscal_documents
    // insert + the outbox enqueue commit atomically. The orchestrator
    // resolves tipoDte from (source, buyerHasRut) and embeds the
    // allocation in the outbox payload — the worker passes it to
    // adapter.issue() without re-querying the DB. If the allocator
    // throws (CAF_NOT_AVAILABLE / CAF_EXHAUSTED), the surrounding tx
    // rolls back: no folio burned, no fiscal_documents row created,
    // no outbox row enqueued.
    if (adapter.countryCode === 'CL') {
      const buyerHasRut =
        !!buyer.taxId && buyer.taxId !== CONSUMIDOR_FINAL.taxId;
      const tipoDte = mapInternalKindToTipoDte(source, buyerHasRut);
      const allocation = allocateNextFolio(writeTx, { tenantId, tipoDte });
      adapterInput.chileAllocation = {
        cafId: allocation.cafId,
        folio: allocation.folio,
        tipoDte: allocation.tipoDte,
        rutEmisor: allocation.rutEmisor,
        rawCafXml: allocation.rawCafXml,
        rangeRemaining: allocation.rangeRemaining,
      };
    }

    writeTx.insert(fiscalDocuments)
      .values({
        id: fiscalDocumentId,
        tenantId,
        source,
        sourceId,
        kind,
        resolutionId: resolution.id,
        consecutive,
        documentNumber,
        cufe: placeholderCufe,
        status: 'pending',
        customerId: buyer.customerId,
        buyerTaxId: buyer.taxId,
        buyerTaxIdTypeCode: buyer.taxIdTypeCode,
        buyerName: buyer.name,
        buyerEmail: buyer.email,
        buyerAddress: buyer.address,
        buyerCity: buyer.city,
        buyerDepartment: buyer.department,
        buyerCountry: buyer.country,
        subtotal: sale.subtotal,
        taxAmount: sale.taxAmount,
        discountAmount: sale.discountAmount,
        totalAmount: sale.total,
        currencyCode: locale.currency,
        localeCode: locale.locale,
        originalCufe: args.originalCufe ?? null,
        reasonCode: args.reasonCode ?? null,
        providerId: adapter.providerId,
        providerResponse: null,
        xmlRef: null,
        retries: 0,
        emittedByUserId: userId,
        emittedAt: now,
        updatedAt: now,
      })
      .run();

    for (const line of lines) {
      writeTx.insert(fiscalDocumentItems)
        .values({
          id: nanoid(),
          fiscalDocumentId,
          lineNumber: line.lineNumber,
          productId: line.productId,
          productName: line.productName,
          productSku: line.productSku,
          unitMeasureCode: 'EA',
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount,
          taxRate: line.taxRate,
          taxAmount: line.taxAmount,
          taxCategoryCode: '01',
          lineTotal: line.lineTotal,
        })
        .run();
    }

    const updateResult = writeTx.update(fiscalNumberingResolutions)
      .set({ currentNumber: consecutive, updatedAt: now })
      .where(
        and(
          eq(fiscalNumberingResolutions.id, resolution.id),
          eq(fiscalNumberingResolutions.tenantId, tenantId),
          eq(fiscalNumberingResolutions.siteId, saleSite.siteId),
          eq(fiscalNumberingResolutions.kind, kind)
        )
      )
      .run();
    if (updateResult.changes !== 1) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'FISCAL_SEQUENTIAL_NOT_ADVANCED',
        message: 'Fiscal numbering resolution was not advanced',
        details: {
          resolutionId: resolution.id,
          tenantId,
          siteId: saleSite.siteId,
          kind,
          expectedConsecutive: consecutive,
        },
      });
    }

    // Enqueue the outbox row last so a constraint-violation roll-back
    // on fiscal_documents (rare — the duplicate probe runs first)
    // doesn't leave an orphan outbox row.
    const outboxId = nanoid();
    writeTx.insert(fiscalOutbox)
      .values({
        id: outboxId,
        tenantId,
        status: 'queued',
        kind: 'emit',
        fiscalDocumentId,
        providerId: adapter.providerId,
        cufe: null,
        payload: {
          countryCode: adapter.countryCode,
          providerId: adapter.providerId,
          fiscalDocumentId,
          adapterInput,
        },
        payloadVersion: 1,
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        priority: 0,
        claimToken: null,
        lockedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    return {
      id: fiscalDocumentId,
      cufe: placeholderCufe,
      documentNumber,
      status: 'pending',
    };
  });
}

/**
 * ENG-020 / ENG-054 / ENG-057 — best-effort fiscal emission entry point
 * used by sale-lifecycle services (`completeSale`, `voidSale`,
 * `returnSale`). Backwards-compatible wrapper around `enqueueFiscalEmission`.
 *
 * Invariants:
 * - Best-effort, NON-BLOCKING relative to the sale. The sale-lifecycle
 *   transaction has already committed by the time this runs; an emission
 *   failure (provider outage, missing resolution, malformed input) MUST NOT
 *   roll back the sale. This wrapper catches every throw from
 *   `enqueueFiscalEmission` and returns `null` — it NEVER throws.
 * - Idempotent for retry: because `enqueueFiscalEmission` is keyed on
 *   `(tenantId, source, sourceId, kind)`, a later replay (the fiscal worker
 *   re-tick, or a contingency retry) picks a dropped emission back up
 *   without duplicating the document.
 * - The shape of the returned object is preserved so existing callers read
 *   `result.id` for `fiscal_emit` journal-effect emission without edits.
 *
 * Preconditions: the sale lifecycle has already committed the source sale,
 * and the caller provides the tenant/user/source tuple needed to enqueue or
 * idempotently find the fiscal document.
 *
 * Postconditions:
 * - On a produced document: fires a fire-and-forget worker tick to drain the
 *   new outbox row immediately (the worker's claim_token guards against
 *   double-processing) and returns the `{ id, cufe, documentNumber, status }`
 *   summary.
 * - On a non-DIAN tenant / missing prerequisite / swallowed error: returns
 *   `null`. A `null` return is the NORMAL flow for a non-DIAN tenant — the
 *   caller may emit a journal effect off the return but MUST NOT make a
 *   business-critical decision on it.
 */
export async function safelyEmitFiscalDocument(args: {
  db: DatabaseInstance;
  tenantId: string;
  userId: string;
  log: Pick<PuntovivoLogger, 'warn' | 'info' | 'debug' | 'error'>;
  source: FiscalDocumentSource;
  sourceId: string;
  saleId: string;
  kind: FiscalDocumentKind;
  // ENG-179b — explicit `| undefined` per the optional-args pattern.
  originalCufe?: string | undefined;
  reasonCode?: string | undefined;
}): Promise<EmitFiscalDocumentResult | null> {
  try {
    const result = await enqueueFiscalEmission({
      db: args.db,
      tenantId: args.tenantId,
      userId: args.userId,
      log: args.log,
      source: args.source,
      sourceId: args.sourceId,
      saleId: args.saleId,
      kind: args.kind,
      originalCufe: args.originalCufe,
      reasonCode: args.reasonCode,
    });
    if (result) {
      // Fire-and-forget: ask the fiscal worker to drain the new
      // outbox row immediately so the happy-path latency stays
      // close to the synchronous status quo. The worker's
      // claim_token guards against double-processing if the
      // periodic tick fires concurrently.
      tickDefaultFiscalWorker(args.tenantId).catch(err => {
        args.log.debug(
          { err, tenantId: args.tenantId },
          'immediate fiscal worker tick failed (non-blocking)'
        );
      });
    }
    return result;
  } catch (err) {
    args.log.warn(
      {
        err,
        tenantId: args.tenantId,
        saleId: args.saleId,
        source: args.source,
        kind: args.kind,
      },
      'fiscal emission failed (non-blocking)'
    );
    return null;
  }
}
