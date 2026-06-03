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

import { and, asc, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../../middleware/roles.js';
import {
  fiscalDocumentItems,
  fiscalDocuments,
  fiscalOutbox,
} from '../../../db/schema.js';
import {
  getFiscalDocumentByCufeInput,
  getFiscalXmlInput,
  listFiscalDocumentsInput,
  retryFiscalDocumentInput,
} from '../../schemas/fiscal.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { describeFiscalProvider } from '../../../services/fiscal/registry.js';
import type { FiscalAdapterMaturity } from '../../../services/fiscal/adapter.js';
import {
  getDefaultFiscalWorker,
} from '../../../services/fiscal/fiscal-worker.js';

/**
 * ENG-185 — resolve a stored `providerId` to its pack maturity so the
 * document views label demo/draft documents honestly. An unknown / null
 * provider id defaults to `mock` (most conservative — never reads as
 * production).
 */
function maturityForProvider(
  providerId: string | null | undefined
): FiscalAdapterMaturity {
  if (!providerId) return 'mock';
  return describeFiscalProvider(providerId)?.maturity ?? 'mock';
}
import {
  buildFiscalXmlFilename,
  FISCAL_XML_MIME_ISO_8859_1,
  FISCAL_XML_MIME_UTF8,
  type ServerExportEnvelope,
} from '../../../services/exports/envelope.js';
import { writeAuditLog } from '../../../services/audit-logs.js';

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
  xmlRef: sql<boolean>`${fiscalDocuments.xmlRef} IS NOT NULL`,
} as const;

export const fiscalReportsRouter = router({
  /**
   * Paged list of fiscal documents for the admin Fiscal Documents page
   * and the ENG-065a Operations Center Fiscal Health panel.
   * Tenant-scoped via `ctx.tenantId`. Optional filters: kind, status,
   * source, date range.
   *
   * Read-only — manager + admin gated. The retry mutation
   * (`retryDocument` below) stays admin-only because it advances
   * fiscal document state.
   */
  list: managerOrAdminProcedure
    .input(listFiscalDocumentsInput)
    .query(async ({ ctx, input }) => {
      const conditions = [eq(fiscalDocuments.tenantId, ctx.tenantId)];
      if (input.kind) conditions.push(eq(fiscalDocuments.kind, input.kind));
      if (input.status) conditions.push(eq(fiscalDocuments.status, input.status));
      if (input.source) conditions.push(eq(fiscalDocuments.source, input.source));
      if (input.fromDate) conditions.push(gte(fiscalDocuments.emittedAt, input.fromDate));
      if (input.toDate) conditions.push(lte(fiscalDocuments.emittedAt, input.toDate));

      const rows = await ctx.db
        .select(LIST_SELECT_COLUMNS)
        .from(fiscalDocuments)
        .where(and(...conditions))
        .orderBy(desc(fiscalDocuments.emittedAt))
        .limit(input.limit)
        .offset(input.offset)
        .all();
      // ENG-185 — derive pack maturity per row from the stored providerId
      // so the list never presents a mock/draft document as production.
      const items = rows.map(row => ({
        ...row,
        maturity: maturityForProvider(row.providerId),
      }));
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
   * ENG-103 — Lazy fetch of the signed XML body for a single fiscal
   * document. Returns the canonical `ServerExportEnvelope` (data +
   * filename + mimeType) so the renderer can wrap it in a Blob and
   * trigger the download without re-implementing the URL+anchor
   * dance. Audit row `fiscal.xml.downloaded` is written before the
   * response so the trail is intact even if the network drops the
   * payload mid-transit.
   *
   * Tenant-scoped via `ctx.tenantId`. Cross-tenant access collapses
   * to `FISCAL_DOCUMENT_NOT_FOUND` so the row's existence never
   * leaks. `xmlRef IS NULL` (timbrado pendiente / contingencia)
   * also collapses to the same error — the operator simply gets
   * the same "no XML available" feedback regardless of whether the
   * document is missing or just unsigned.
   *
   * Manager + admin gated. The action is read-only on durable
   * data but emits an audit row, so the role floor matches the
   * other audited fiscal procedures.
   */
  getXml: managerOrAdminProcedure
    .input(getFiscalXmlInput)
    .query(async ({ ctx, input }): Promise<ServerExportEnvelope> => {
      const row = await ctx.db
        .select({
          id: fiscalDocuments.id,
          documentNumber: fiscalDocuments.documentNumber,
          cufe: fiscalDocuments.cufe,
          xmlRef: fiscalDocuments.xmlRef,
          localeCode: fiscalDocuments.localeCode,
        })
        .from(fiscalDocuments)
        .where(
          and(
            eq(fiscalDocuments.tenantId, ctx.tenantId),
            eq(fiscalDocuments.id, input.documentId)
          )
        )
        .get();

      if (!row || !row.xmlRef) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'FISCAL_DOCUMENT_NOT_FOUND',
          message: 'Fiscal document XML not available',
        });
      }

      // `localeCode` is `es-CO`, `es-MX`, `es-CL`, etc. Extract the
      // 2-letter country tag (mirrors the helper used in
      // `sale-read.ts:296`).
      const countryMatch = row.localeCode?.match(/-([A-Za-z]{2})(?:-|$)/);
      const countryCode = countryMatch?.[1]?.toLowerCase() ?? 'xx';

      const filename = buildFiscalXmlFilename({
        countryCode,
        documentNumber: row.documentNumber,
        documentId: row.id,
      });

      // Chile's DTE10 pins ISO-8859-1 in its XML preamble; every other
      // pack we ship today (CO, MX) emits UTF-8. Honor the encoding so
      // the Blob the renderer builds matches the declared charset.
      const mimeType =
        countryCode === 'cl'
          ? FISCAL_XML_MIME_ISO_8859_1
          : FISCAL_XML_MIME_UTF8;

      const xmlByteSize = Buffer.byteLength(
        row.xmlRef,
        countryCode === 'cl' ? 'latin1' : 'utf8'
      );

      writeAuditLog({
        tx: ctx.db,
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        action: 'fiscal.xml.downloaded',
        resourceType: 'fiscal_document',
        resourceId: row.id,
        metadata: {
          cufe: row.cufe,
          documentNumber: row.documentNumber,
          countryCode,
          byteSize: xmlByteSize,
        },
      });

      return {
        data: row.xmlRef,
        filename,
        mimeType,
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
        header: { ...header, maturity: maturityForProvider(header.providerId) },
        lines,
      };
    }),

  /**
   * ENG-057 — Operator-driven manual recovery for a stuck fiscal
   * document. Three behaviors depending on the outbox row state:
   *
   *   - retrying / contingency: re-arm by clearing `next_retry_at`
   *     so the next worker tick claims it immediately. Returns
   *     `{ rearmed: true }`.
   *   - dead_letter / rejected: enqueue a fresh outbox row carrying
   *     the same payload, reset `fiscal_documents.status` to
   *     `pending` so the close-shift gate sees it again. Returns
   *     `{ rearmed: false, requeuedAs }`.
   *   - queued / submitting / accepted: no-op. Returns
   *     `{ rearmed: false }`.
   *
   * After the DB write, the procedure fires a `tickOnce` on the
   * default fiscal worker so the operator does not wait for the
   * next periodic tick.
   *
   * Admin-only. Tenant-scoped via `ctx.tenantId`.
   */
  retryDocument: adminProcedure
    .input(retryFiscalDocumentInput)
    .mutation(async ({ ctx, input }) => {
      const row = await ctx.db
        .select()
        .from(fiscalOutbox)
        .where(
          and(
            eq(fiscalOutbox.tenantId, ctx.tenantId),
            eq(fiscalOutbox.fiscalDocumentId, input.fiscalDocumentId)
          )
        )
        .orderBy(desc(fiscalOutbox.updatedAt), desc(fiscalOutbox.createdAt))
        .get();
      if (!row) {
        throwServerError({
          trpcCode: 'NOT_FOUND',
          errorCode: 'FISCAL_DOCUMENT_NOT_FOUND',
          message: 'Fiscal document has no outbox row',
        });
      }

      const nowIso = new Date().toISOString();
      const worker = getDefaultFiscalWorker();

      if (row.status === 'retrying' || row.status === 'contingency') {
        await ctx.db
          .update(fiscalOutbox)
          .set({ nextRetryAt: null, updatedAt: nowIso })
          .where(
            and(
              eq(fiscalOutbox.id, row.id),
              eq(fiscalOutbox.tenantId, ctx.tenantId)
            )
          );
        // Best-effort drain. The kernel claim_token guards against
        // concurrent ticks if the periodic interval fires here too.
        if (worker) {
          worker.tickOnce(ctx.tenantId).catch(() => {
            /* swallow — tick errors are logged inside the worker */
          });
        }
        return { rearmed: true as const, outboxRowId: row.id };
      }

      if (row.status === 'dead_letter' || row.status === 'rejected') {
        const newOutboxId = nanoid();
        await ctx.db.transaction(tx => {
          tx.insert(fiscalOutbox)
            .values({
              id: newOutboxId,
              tenantId: ctx.tenantId,
              status: 'queued',
              kind: row.kind,
              fiscalDocumentId: row.fiscalDocumentId,
              providerId: row.providerId,
              cufe: null,
              payload: row.payload,
              payloadVersion: row.payloadVersion,
              attempts: 0,
              nextRetryAt: null,
              lastError: null,
              priority: -1, // ahead of regular sales
              claimToken: null,
              lockedAt: null,
              createdAt: nowIso,
              updatedAt: nowIso,
            })
            .run();
          tx.update(fiscalDocuments)
            .set({ status: 'pending', updatedAt: nowIso })
            .where(
              and(
                eq(fiscalDocuments.id, input.fiscalDocumentId),
                eq(fiscalDocuments.tenantId, ctx.tenantId)
              )
            )
            .run();
        });
        if (worker) {
          worker.tickOnce(ctx.tenantId).catch(() => {
            /* swallow */
          });
        }
        return { rearmed: false as const, requeuedAs: newOutboxId };
      }

      // Queued / submitting / accepted: no-op.
      return { rearmed: false as const };
    }),
});

export type FiscalReportsRouter = typeof fiscalReportsRouter;
