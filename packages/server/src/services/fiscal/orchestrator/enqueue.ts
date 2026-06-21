/**
 * Fiscal orchestrator — ENG-057 outbox emit.
 *
 * `enqueueFiscalEmission` pre-creates the document + items, allocates the Chile
 * CAF folio (ENG-036b), advances the consecutive (FISCAL_SEQUENTIAL_NOT_ADVANCED
 * TOCTOU guard) and enqueues the fiscal_outbox row in ONE write transaction; the
 * adapter runs out-of-band via the worker. The write tx is byte-identical.
 *
 * @module services/fiscal/orchestrator/enqueue
 */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../../db/index.js';
import { companies, cashSessions, fiscalDocumentItems, fiscalDocuments, fiscalNumberingResolutions, fiscalOutbox, sales, tenants, type FiscalDocumentKind, type FiscalDocumentSource } from '../../../db/schema.js';
import type { PuntovivoLogger } from '../../../logging/logger.js';
import { resolveTenantLocale } from '../../tenant-locale.js';
import type { FiscalAdapterIssueInput, FiscalAdapterLine } from '../adapter.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { CONSUMIDOR_FINAL, type FiscalEnvironment } from '../cufe.js';
import { allocateNextFolio } from '../packs/cl/caf-allocator.js';
import { mapInternalKindToTipoDte } from '../packs/cl/mappings.js';
import { getFiscalAdapter, isSupportedFiscalCountry } from '../registry.js';
import type { EmitFiscalDocumentResult } from './types.js';
import { splitIssueTimestamp, isCountryFiscalEnabled, isDianEnabled } from './helpers.js';
import { resolveBuyer, resolveLines } from './snapshots.js';


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
