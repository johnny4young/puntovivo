/**
 * ENG-020 — Fiscal reports sub-router (`reports.fiscal.*`).
 *
 * Read-only admin surface for the Fiscal Documents page. Lists emitted
 * `fiscal_documents` and looks a single row up by CUFE. Returns the
 * frozen buyer + header + line snapshots directly — NEVER joins
 * `customers` or `products`.
 *
 * ---
 * **ARCHITECTURAL INVARIANT (enforced by `architectural-lint.test.ts`)**:
 *
 *   This file and anything under `trpc/routers/reports/` MUST NOT
 *   import from `customers` or `products`. The whole point of the
 *   buyer / product snapshot columns on `fiscal_documents` +
 *   `fiscal_document_items` is that the fiscal surface is immune to
 *   post-emission mutations of the source rows. A join would silently
 *   re-introduce that coupling; the lint test fails the build if any
 *   routers/reports file names those two identifiers in its import
 *   list.
 * ---
 *
 * Response shapes are minimal and stable — the admin UI renders them
 * directly without mapping. Adding a column means widening this shape
 * AND the table/UI; do not use `select()` (unbounded spread) here.
 *
 * @module trpc/routers/reports/fiscal
 */

import { and, asc, count, desc, eq, gte, lte } from 'drizzle-orm';
import { router } from '../../init.js';
import { adminProcedure } from '../../middleware/roles.js';
import {
  fiscalDocumentItems,
  fiscalDocuments,
} from '../../../db/schema.js';
import {
  getFiscalDocumentByCufeInput,
  listFiscalDocumentsInput,
} from '../../schemas/fiscal.js';
import { throwServerError } from '../../../lib/errorCodes.js';

/** Shape returned by `reports.fiscal.list` — one row per fiscal document. */
const LIST_SELECT_COLUMNS = {
  id: fiscalDocuments.id,
  source: fiscalDocuments.source,
  sourceId: fiscalDocuments.sourceId,
  kind: fiscalDocuments.kind,
  documentNumber: fiscalDocuments.documentNumber,
  consecutive: fiscalDocuments.consecutive,
  cufe: fiscalDocuments.cufe,
  status: fiscalDocuments.status,
  buyerTaxId: fiscalDocuments.buyerTaxId,
  buyerTaxIdTypeCode: fiscalDocuments.buyerTaxIdTypeCode,
  buyerName: fiscalDocuments.buyerName,
  subtotal: fiscalDocuments.subtotal,
  taxAmount: fiscalDocuments.taxAmount,
  totalAmount: fiscalDocuments.totalAmount,
  currencyCode: fiscalDocuments.currencyCode,
  emittedAt: fiscalDocuments.emittedAt,
  providerId: fiscalDocuments.providerId,
  retries: fiscalDocuments.retries,
  // ENG-035b: presence-only flag (boolean) so the list UI knows
  // whether to surface the "Ver XML" affordance per row. The XML
  // body is fetched lazily via `reports.fiscal.getXml` to avoid
  // shipping ~10kb per row through the list query.
  xmlRef: fiscalDocuments.xmlRef,
} as const;

export const fiscalReportsRouter = router({
  /**
   * Paged list of fiscal documents for the admin Fiscal Documents page.
   * Tenant-scoped via `ctx.tenantId`. Optional filters: kind, status,
   * source, date range.
   */
  list: adminProcedure
    .input(listFiscalDocumentsInput)
    .query(async ({ ctx, input }) => {
      const conditions = [eq(fiscalDocuments.tenantId, ctx.tenantId)];
      if (input.kind) conditions.push(eq(fiscalDocuments.kind, input.kind));
      if (input.status) conditions.push(eq(fiscalDocuments.status, input.status));
      if (input.source) conditions.push(eq(fiscalDocuments.source, input.source));
      if (input.fromDate) conditions.push(gte(fiscalDocuments.emittedAt, input.fromDate));
      if (input.toDate) conditions.push(lte(fiscalDocuments.emittedAt, input.toDate));

      const items = await ctx.db
        .select(LIST_SELECT_COLUMNS)
        .from(fiscalDocuments)
        .where(and(...conditions))
        .orderBy(desc(fiscalDocuments.emittedAt))
        .limit(input.limit)
        .offset(input.offset)
        .all();
      const totalRow = await ctx.db
        .select({ total: count() })
        .from(fiscalDocuments)
        .where(and(...conditions))
        .get();

      return {
        items,
        total: totalRow?.total ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  /**
   * Look up a single fiscal document by CUFE (useful for deep-links
   * from receipts, audit logs, or the contingency queue). Returns the
   * header + all lines. Tenant-scoped.
   */
  getByCufe: adminProcedure
    .input(getFiscalDocumentByCufeInput)
    .query(async ({ ctx, input }) => {
      const header = await ctx.db
        .select(LIST_SELECT_COLUMNS)
        .from(fiscalDocuments)
        .where(
          and(
            eq(fiscalDocuments.tenantId, ctx.tenantId),
            eq(fiscalDocuments.cufe, input.cufe)
          )
        )
        .get();
      if (!header) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'FISCAL_DOCUMENT_NOT_FOUND',
          message: 'Fiscal document not found',
        });
      }

      const lines = await ctx.db
        .select({
          id: fiscalDocumentItems.id,
          lineNumber: fiscalDocumentItems.lineNumber,
          productName: fiscalDocumentItems.productName,
          productSku: fiscalDocumentItems.productSku,
          unitMeasureCode: fiscalDocumentItems.unitMeasureCode,
          quantity: fiscalDocumentItems.quantity,
          unitPrice: fiscalDocumentItems.unitPrice,
          discountAmount: fiscalDocumentItems.discountAmount,
          taxRate: fiscalDocumentItems.taxRate,
          taxAmount: fiscalDocumentItems.taxAmount,
          taxCategoryCode: fiscalDocumentItems.taxCategoryCode,
          lineTotal: fiscalDocumentItems.lineTotal,
        })
        .from(fiscalDocumentItems)
        .where(eq(fiscalDocumentItems.fiscalDocumentId, header.id))
        .orderBy(asc(fiscalDocumentItems.lineNumber))
        .all();

      return {
        header,
        lines,
      };
    }),
});

export type FiscalReportsRouter = typeof fiscalReportsRouter;
