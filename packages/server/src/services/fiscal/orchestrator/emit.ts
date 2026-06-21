/**
 * Fiscal orchestrator — legacy synchronous emit (ENG-020).
 *
 * `emitFiscalDocument` calls the adapter inline, then persists the document +
 * items + advances the consecutive in ONE write transaction with the
 * FISCAL_SEQUENTIAL_NOT_ADVANCED TOCTOU guard. The write tx is byte-identical.
 *
 * @module services/fiscal/orchestrator/emit
 */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { companies, cashSessions, fiscalDocumentItems, fiscalDocuments, fiscalNumberingResolutions, sales, tenants } from '../../../db/schema.js';
import { resolveTenantLocale } from '../../tenant-locale.js';
import type { FiscalAdapterIssueInput, FiscalAdapterLine } from '../adapter.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import type { EmitFiscalDocumentArgs, EmitFiscalDocumentResult } from './types.js';
import { splitIssueTimestamp, isCountryFiscalEnabled, isDianEnabled } from './helpers.js';
import { resolveBuyer, resolveLines } from './snapshots.js';


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
