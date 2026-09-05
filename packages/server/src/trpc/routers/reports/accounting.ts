/**
 * Accounting export sub-router (`reports.accounting.*`).
 *
 * Read-only admin surface feeding the accountant hand-off page: one
 * voucher per accounting event in a date range: completed sales are
 * dated by checkout completion and returns by their own creation time.
 * Each event carries the source sale's frozen lines and tenders plus the
 * event's emitted fiscal document reference when one exists. The client builds the vendor-specific
 * files (Siigo template, balanced journal entries, generic CSV) from
 * these rows — the server ships data, not formats.
 *
 * ---
 * **ARCHITECTURAL INVARIANT (enforced by `architectural-lint.test.ts`)**:
 * nothing under `trpc/routers/reports/` may import `customers` or
 * `products`. This router reads the SALE-TIME SNAPSHOTS
 * (`customerNameSnapshot`, `customerTaxIdSnapshot`,
 * `productNameSnapshot`, `productSkuSnapshot`, frozen `taxKind`) so an
 * exported voucher can never drift when the source rows are edited
 * later — the same immutability contract the fiscal surface holds.
 * ---
 *
 * @module trpc/routers/reports/accounting
 */

import { TRPCError } from '@trpc/server';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import { router } from '../../init.js';
import { adminProcedure } from '../../middleware/roles.js';
import {
  cashSessions,
  fiscalDocuments,
  saleItemTaxComponents,
  saleReturnItems,
  saleReturnItemTaxComponents,
  saleReturnPaymentAllocations,
  salePayments,
  saleItems,
  saleReturns,
  sales,
} from '../../../db/schema.js';
import {
  accountingPucAccountsInput,
  accountingRememberSiteInput,
  accountingVouchersInput,
} from '../../schemas/reports.js';
import { roundMoney } from '../../../lib/money.js';
import { resolveTenantLocale } from '../../../services/tenant-locale.js';
import {
  calendarDayInTimeZone,
  resolveUtcDayWindow,
} from '../../../services/reports/day-window.js';
import { ensureTenantSite } from '../../middleware/tenantSite.js';
import {
  ACCOUNTING_EXPORT_SETTINGS_VERSION,
  ACCOUNTING_PUC_DEFAULTS_VERSION,
  DEFAULT_ACCOUNTING_PUC_ACCOUNTS,
  resolveAccountingExportSettings,
  writeAccountingLastSite,
  writeAccountingPucAccounts,
} from '../../../services/accounting-export-settings.js';

/**
 * Statuses where the stored CUFE is the real one the adapter returned.
 * Every other status (pending, contingency, rejected, voided) still
 * carries the placeholder minted when the consecutive was reserved.
 */
const CONFIRMED_FISCAL_STATUSES = new Set([
  'accepted',
  'sent',
  'notified_correction',
  'partial_send',
]);

export interface AccountingVoucherLine {
  productNameSnapshot: string | null;
  productSkuSnapshot: string | null;
  quantity: number;
  unitPrice: number;
  discount: number;
  taxRate: number;
  taxKind: 'iva' | 'inc';
  taxAmount: number;
  total: number;
}

export interface AccountingVoucherPayment {
  method: string;
  amount: number;
  /**
   * Refund destination. Null only for ordinary sale tenders; return
   * allocations always freeze the actual refund destination.
   */
  destination?: 'cash' | 'receivable' | 'external' | 'loyalty' | 'store_credit' | null;
}

export interface AccountingVoucher {
  kind: 'sale' | 'refund';
  /** Sale id for sales, sale-return id for refund events. */
  eventId: string;
  saleNumber: string;
  createdAt: string;
  /**
   * Tenant-local calendar day (YYYY-MM-DD) of the sale. The exported
   * files date rows from THIS, never from the browser clock: a
   * workstation in another timezone would otherwise write rows dated
   * into a closed accounting period.
   */
  localDate: string;
  siteNameSnapshot: string | null;
  customerNameSnapshot: string | null;
  customerTaxIdSnapshot: string | null;
  currencyCode: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  tipAmount: number;
  serviceChargeAmount: number;
  total: number;
  /** IVA portion of taxAmount, from the frozen line tax kinds. */
  ivaAmount: number;
  /** INC portion of taxAmount, from the frozen line tax kinds. */
  incAmount: number;
  lines: AccountingVoucherLine[];
  payments: AccountingVoucherPayment[];
  fiscalDocumentNumber: string | null;
  /**
   * Only present once the country adapter accepted the document. A
   * reserved-but-unemitted row still carries a `pending-<nanoid>`
   * placeholder, which must never reach an accountant's importer as a
   * fiscal reference.
   */
  fiscalCufe: string | null;
  /** Emission status, so the export can label an unconfirmed document. */
  fiscalStatus: string | null;
  /**
   * Amount booked by this refund event; zero for sale events.
   */
  refundAmount: number;
  /**
   * False when the line tax kinds do not add up to the header tax —
   * a header that arrived through sync without its lines, or a
   * data-repair row. The export refuses to build files in that state
   * instead of silently reclassifying tax as income.
   */
  taxReconciled: boolean;
  /**
   * False when a refund's frozen payment allocations do not add up to
   * its refund amount. Sale vouchers are always true because an unpaid
   * sale balance is deliberately posted as accounts receivable by the
   * journal builder; refund destinations must instead be explicit.
   */
  paymentReconciled: boolean;
}

export const accountingReportsRouter = router({
  settings: adminProcedure.query(async ({ ctx }) => {
    const settings = await resolveAccountingExportSettings(ctx.db, ctx.tenantId);
    let lastSiteId = settings.lastSiteId;
    if (lastSiteId) {
      try {
        await ensureTenantSite(ctx.db, ctx.tenantId, lastSiteId);
      } catch (error) {
        if (!(error instanceof TRPCError) || error.code !== 'NOT_FOUND') {
          throw error;
        }
        // A deleted or cross-tenant id in a legacy JSON blob is not a valid
        // preference. Return the honest multi-site default without mutating
        // state during a read.
        lastSiteId = null;
      }
    }
    return {
      schemaVersion: ACCOUNTING_EXPORT_SETTINGS_VERSION,
      pucDefaultsVersion: ACCOUNTING_PUC_DEFAULTS_VERSION,
      accounts: settings.accounts,
      defaults: DEFAULT_ACCOUNTING_PUC_ACCOUNTS,
      lastSiteId,
    };
  }),

  updateAccounts: adminProcedure
    .input(accountingPucAccountsInput)
    .mutation(async ({ ctx, input }) => {
      const settings = await writeAccountingPucAccounts(ctx.db, ctx.tenantId, input);
      return {
        schemaVersion: settings.schemaVersion,
        pucDefaultsVersion: settings.pucDefaultsVersion,
        accounts: settings.accounts,
      };
    }),

  rememberSite: adminProcedure
    .input(accountingRememberSiteInput)
    .mutation(async ({ ctx, input }) => {
      if (input.siteId) {
        await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      }
      const settings = await writeAccountingLastSite(ctx.db, ctx.tenantId, input.siteId);
      return { lastSiteId: settings.lastSiteId };
    }),

  vouchers: adminProcedure.input(accountingVouchersInput).query(async ({ ctx, input }) => {
    if (input.siteId) {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    }

    // Tenant-local calendar days → half-open UTC window, the same
    // resolution the day-close report uses. Without it a Bogota month
    // would start and end five hours off and never reconcile with the
    // day-close evidence the operator signs.
    const locale = await resolveTenantLocale(ctx.db, ctx.tenantId);
    const { startIso } = resolveUtcDayWindow(input.from, locale.timezone);
    // The `to` day is INCLUSIVE, so the window ends where that day ends.
    const { endExclusiveIso } = resolveUtcDayWindow(input.to, locale.timezone);
    // A parked draft may be opened in one accounting period and paid
    // in another. Completion is the voucher date; created-at is only
    // the fallback for rows written before checkout timing shipped.
    const completedAt = sql<string>`coalesce(${sales.checkoutCompletedAt}, ${sales.createdAt})`;

    const saleHeaderRows = await ctx.db
      .select({
        saleId: sales.id,
        saleNumber: sales.saleNumber,
        createdAt: completedAt,
        siteNameSnapshot: sales.siteNameSnapshot,
        customerNameSnapshot: sales.customerNameSnapshot,
        customerTaxIdSnapshot: sales.customerTaxIdSnapshot,
        currencyCode: sales.currencyCode,
        subtotal: sales.subtotal,
        discountAmount: sales.discountAmount,
        taxAmount: sales.taxAmount,
        tipAmount: sales.tipAmount,
        serviceChargeAmount: sales.serviceChargeAmount,
        total: sales.total,
      })
      .from(sales)
      // The sale's site lives on its cash session; a completed sale
      // always carries one (schema CHECK), so the inner join only
      // narrows drafts — which the status filter already excludes.
      .innerJoin(
        cashSessions,
        and(eq(sales.cashSessionId, cashSessions.id), eq(cashSessions.tenantId, ctx.tenantId))
      )
      .where(
        and(
          eq(sales.tenantId, ctx.tenantId),
          eq(sales.status, 'completed'),
          gte(completedAt, startIso),
          lt(completedAt, endExclusiveIso),
          ...(input.siteId ? [eq(cashSessions.siteId, input.siteId)] : [])
        )
      )
      .orderBy(asc(completedAt), asc(sales.saleNumber))
      .limit(input.limit + 1);

    const refundHeaderRows = await ctx.db
      .select({
        eventId: saleReturns.id,
        saleId: sales.id,
        saleNumber: sales.saleNumber,
        createdAt: saleReturns.createdAt,
        siteNameSnapshot: sales.siteNameSnapshot,
        customerNameSnapshot: sales.customerNameSnapshot,
        customerTaxIdSnapshot: sales.customerTaxIdSnapshot,
        currencyCode: saleReturns.currencyCode,
        subtotal: saleReturns.subtotal,
        discountAmount: saleReturns.discountAmount,
        taxAmount: saleReturns.taxAmount,
        tipAmount: saleReturns.tipAmount,
        serviceChargeAmount: saleReturns.serviceChargeAmount,
        total: saleReturns.refundAmount,
        refundAmount: saleReturns.refundAmount,
      })
      .from(saleReturns)
      .innerJoin(sales, and(eq(saleReturns.saleId, sales.id), eq(sales.tenantId, ctx.tenantId)))
      .innerJoin(
        cashSessions,
        and(eq(sales.cashSessionId, cashSessions.id), eq(cashSessions.tenantId, ctx.tenantId))
      )
      .where(
        and(
          eq(saleReturns.tenantId, ctx.tenantId),
          eq(sales.status, 'completed'),
          gte(saleReturns.createdAt, startIso),
          lt(saleReturns.createdAt, endExclusiveIso),
          ...(input.siteId ? [eq(cashSessions.siteId, input.siteId)] : [])
        )
      )
      .orderBy(asc(saleReturns.createdAt), asc(sales.saleNumber))
      .limit(input.limit + 1);

    const eventCandidates = [
      ...saleHeaderRows.map(row => ({
        ...row,
        kind: 'sale' as const,
        eventId: row.saleId,
        refundAmount: 0,
      })),
      ...refundHeaderRows.map(row => ({ ...row, kind: 'refund' as const })),
    ].sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) ||
        a.saleNumber.localeCompare(b.saleNumber) ||
        a.kind.localeCompare(b.kind)
    );
    const truncated = eventCandidates.length > input.limit;
    const headers = eventCandidates.slice(0, input.limit);
    const saleIds = [...new Set(headers.map(row => row.saleId))];
    const returnIds = headers.filter(row => row.kind === 'refund').map(row => row.eventId);

    const [
      lineRows,
      paymentRows,
      returnLineRows,
      returnPaymentRows,
      saleTaxComponentRows,
      returnTaxComponentRows,
      saleFiscalRows,
      returnFiscalRows,
    ] = saleIds.length
      ? await Promise.all([
          ctx.db
            .select({
              id: saleItems.id,
              saleId: saleItems.saleId,
              productNameSnapshot: saleItems.productNameSnapshot,
              productSkuSnapshot: saleItems.productSkuSnapshot,
              quantity: saleItems.quantity,
              unitPrice: saleItems.unitPrice,
              discount: saleItems.discount,
              taxRate: saleItems.taxRate,
              taxKind: saleItems.taxKind,
              taxAmount: saleItems.taxAmount,
              total: saleItems.total,
            })
            .from(saleItems)
            .innerJoin(sales, and(eq(saleItems.saleId, sales.id), eq(sales.tenantId, ctx.tenantId)))
            .where(and(eq(sales.tenantId, ctx.tenantId), inArray(saleItems.saleId, saleIds)))
            .orderBy(asc(saleItems.id)),
          ctx.db
            .select({
              saleId: salePayments.saleId,
              method: salePayments.method,
              amount: salePayments.amount,
            })
            .from(salePayments)
            .where(
              and(eq(salePayments.tenantId, ctx.tenantId), inArray(salePayments.saleId, saleIds))
            )
            .orderBy(asc(salePayments.id)),
          returnIds.length > 0
            ? ctx.db
                .select({
                  id: saleReturnItems.id,
                  saleReturnId: saleReturnItems.saleReturnId,
                  productNameSnapshot: saleReturnItems.productNameSnapshot,
                  productSkuSnapshot: saleReturnItems.productSkuSnapshot,
                  quantity: saleReturnItems.quantity,
                  unitPrice: saleReturnItems.unitPrice,
                  discount: saleReturnItems.discountRate,
                  taxRate: saleReturnItems.taxRate,
                  taxKind: saleReturnItems.taxKind,
                  taxAmount: saleReturnItems.taxAmount,
                  total: saleReturnItems.total,
                })
                .from(saleReturnItems)
                .where(
                  and(
                    eq(saleReturnItems.tenantId, ctx.tenantId),
                    inArray(saleReturnItems.saleReturnId, returnIds)
                  )
                )
                .orderBy(asc(saleReturnItems.id))
            : Promise.resolve([]),
          returnIds.length > 0
            ? ctx.db
                .select({
                  saleReturnId: saleReturnPaymentAllocations.saleReturnId,
                  method: saleReturnPaymentAllocations.originalMethod,
                  destination: saleReturnPaymentAllocations.destination,
                  amount: saleReturnPaymentAllocations.amount,
                })
                .from(saleReturnPaymentAllocations)
                .where(
                  and(
                    eq(saleReturnPaymentAllocations.tenantId, ctx.tenantId),
                    inArray(saleReturnPaymentAllocations.saleReturnId, returnIds)
                  )
                )
                .orderBy(asc(saleReturnPaymentAllocations.id))
            : Promise.resolve([]),
          ctx.db
            .select({
              saleId: saleItems.saleId,
              saleItemId: saleItemTaxComponents.saleItemId,
              taxKind: saleItemTaxComponents.taxKind,
              taxAmount: saleItemTaxComponents.taxAmount,
            })
            .from(saleItemTaxComponents)
            .innerJoin(saleItems, eq(saleItemTaxComponents.saleItemId, saleItems.id))
            .innerJoin(sales, and(eq(saleItems.saleId, sales.id), eq(sales.tenantId, ctx.tenantId)))
            .where(
              and(
                eq(saleItemTaxComponents.tenantId, ctx.tenantId),
                eq(sales.tenantId, ctx.tenantId),
                inArray(saleItems.saleId, saleIds)
              )
            )
            .orderBy(asc(saleItemTaxComponents.saleItemId), asc(saleItemTaxComponents.position)),
          returnIds.length > 0
            ? ctx.db
                .select({
                  saleReturnId: saleReturnItems.saleReturnId,
                  saleReturnItemId: saleReturnItemTaxComponents.saleReturnItemId,
                  taxKind: saleReturnItemTaxComponents.taxKind,
                  taxAmount: saleReturnItemTaxComponents.taxAmount,
                })
                .from(saleReturnItemTaxComponents)
                .innerJoin(
                  saleReturnItems,
                  and(
                    eq(saleReturnItemTaxComponents.saleReturnItemId, saleReturnItems.id),
                    eq(saleReturnItems.tenantId, ctx.tenantId)
                  )
                )
                .where(
                  and(
                    eq(saleReturnItemTaxComponents.tenantId, ctx.tenantId),
                    eq(saleReturnItems.tenantId, ctx.tenantId),
                    inArray(saleReturnItems.saleReturnId, returnIds)
                  )
                )
                .orderBy(
                  asc(saleReturnItemTaxComponents.saleReturnItemId),
                  asc(saleReturnItemTaxComponents.position)
                )
            : Promise.resolve([]),
          ctx.db
            .select({
              sourceId: fiscalDocuments.sourceId,
              documentNumber: fiscalDocuments.documentNumber,
              cufe: fiscalDocuments.cufe,
              status: fiscalDocuments.status,
              emittedAt: fiscalDocuments.emittedAt,
            })
            .from(fiscalDocuments)
            .where(
              and(
                eq(fiscalDocuments.tenantId, ctx.tenantId),
                eq(fiscalDocuments.source, 'sale'),
                inArray(fiscalDocuments.sourceId, saleIds)
              )
            ),
          returnIds.length > 0
            ? ctx.db
                .select({
                  sourceId: fiscalDocuments.sourceId,
                  documentNumber: fiscalDocuments.documentNumber,
                  cufe: fiscalDocuments.cufe,
                  status: fiscalDocuments.status,
                  emittedAt: fiscalDocuments.emittedAt,
                })
                .from(fiscalDocuments)
                .where(
                  and(
                    eq(fiscalDocuments.tenantId, ctx.tenantId),
                    eq(fiscalDocuments.source, 'return'),
                    inArray(fiscalDocuments.sourceId, returnIds)
                  )
                )
            : Promise.resolve([]),
        ])
      : [[], [], [], [], [], [], [], []];

    const linesBySale = new Map<string, AccountingVoucherLine[]>();
    for (const line of lineRows) {
      const bucket = linesBySale.get(line.saleId) ?? [];
      bucket.push({
        productNameSnapshot: line.productNameSnapshot,
        productSkuSnapshot: line.productSkuSnapshot,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        taxRate: line.taxRate,
        taxKind: line.taxKind,
        taxAmount: line.taxAmount,
        total: line.total,
      });
      linesBySale.set(line.saleId, bucket);
    }
    const paymentsBySale = new Map<string, AccountingVoucherPayment[]>();
    for (const payment of paymentRows) {
      const bucket = paymentsBySale.get(payment.saleId) ?? [];
      bucket.push({ method: payment.method, amount: payment.amount, destination: null });
      paymentsBySale.set(payment.saleId, bucket);
    }
    const linesByReturn = new Map<string, AccountingVoucherLine[]>();
    for (const line of returnLineRows) {
      const bucket = linesByReturn.get(line.saleReturnId) ?? [];
      bucket.push({
        productNameSnapshot: line.productNameSnapshot,
        productSkuSnapshot: line.productSkuSnapshot,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        discount: line.discount,
        taxRate: line.taxRate,
        taxKind: line.taxKind,
        taxAmount: line.taxAmount,
        total: line.total,
      });
      linesByReturn.set(line.saleReturnId, bucket);
    }
    const paymentsByReturn = new Map<string, AccountingVoucherPayment[]>();
    for (const payment of returnPaymentRows) {
      const bucket = paymentsByReturn.get(payment.saleReturnId) ?? [];
      bucket.push({
        method: payment.method,
        amount: payment.amount,
        destination: payment.destination,
      });
      paymentsByReturn.set(payment.saleReturnId, bucket);
    }
    const legacyReturnIds = new Set(
      returnLineRows
        .filter(line => line.id.startsWith(`legacy-return-item:${line.saleReturnId}:`))
        .map(line => line.saleReturnId)
    );
    const resolveReturnPayments = (
      saleReturnId: string,
      refundAmount: number
    ): AccountingVoucherPayment[] => {
      const payments = [...(paymentsByReturn.get(saleReturnId) ?? [])];
      if (!legacyReturnIds.has(saleReturnId)) {
        return payments;
      }

      // Migration 0052 could only preserve the persisted tenders of a legacy
      // sale. When that sale was partially paid, its remaining balance was an
      // accounting receivable rather than a sale_payment row. Reconstruct that
      // missing side only for rows carrying the migration's stable legacy id;
      // a short allocation on a new return remains visible to the exporter.
      const allocatedAmount = payments.reduce(
        (sum, payment) => (payment.amount > 0 ? roundMoney(sum + payment.amount) : sum),
        0
      );
      const receivableAmount = roundMoney(refundAmount - allocatedAmount);
      if (receivableAmount > 0) {
        payments.push({
          method: 'credit',
          destination: 'receivable',
          amount: receivableAmount,
        });
      }
      return payments;
    };
    const buildFiscalMap = (
      rows: typeof saleFiscalRows
    ): Map<string, { documentNumber: string | null; cufe: string | null; status: string }> => {
      const result = new Map<
        string,
        { documentNumber: string | null; cufe: string | null; status: string }
      >();
      const orderedRows = [...rows].sort((a, b) =>
        (a.emittedAt ?? '').localeCompare(b.emittedAt ?? '')
      );
      for (const doc of orderedRows) {
        if (doc.sourceId !== null) {
          result.set(doc.sourceId, {
            documentNumber: doc.documentNumber,
            cufe: CONFIRMED_FISCAL_STATUSES.has(doc.status) ? doc.cufe : null,
            status: doc.status,
          });
        }
      }
      return result;
    };
    const fiscalBySale = buildFiscalMap(saleFiscalRows);
    const fiscalByReturn = buildFiscalMap(returnFiscalRows);

    type TaxSplit = { ivaAmount: number; incAmount: number };
    const addTax = (
      target: Map<string, TaxSplit>,
      parentId: string,
      taxKind: 'iva' | 'inc',
      amount: number
    ): void => {
      const split = target.get(parentId) ?? { ivaAmount: 0, incAmount: 0 };
      if (taxKind === 'inc') {
        split.incAmount = roundMoney(split.incAmount + amount);
      } else {
        split.ivaAmount = roundMoney(split.ivaAmount + amount);
      }
      target.set(parentId, split);
    };

    // Normalized components are authoritative. The summary columns remain a
    // compatibility fallback only for legacy lines that have no components.
    // Mixing both would double-count every post-migration sale.
    const taxBySale = new Map<string, TaxSplit>();
    const saleLinesWithComponents = new Set<string>();
    for (const component of saleTaxComponentRows) {
      saleLinesWithComponents.add(component.saleItemId);
      addTax(taxBySale, component.saleId, component.taxKind, component.taxAmount);
    }
    for (const line of lineRows) {
      if (!saleLinesWithComponents.has(line.id)) {
        addTax(taxBySale, line.saleId, line.taxKind, line.taxAmount);
      }
    }

    const taxByReturn = new Map<string, TaxSplit>();
    const returnLinesWithComponents = new Set<string>();
    for (const component of returnTaxComponentRows) {
      returnLinesWithComponents.add(component.saleReturnItemId);
      addTax(taxByReturn, component.saleReturnId, component.taxKind, component.taxAmount);
    }
    for (const line of returnLineRows) {
      if (!returnLinesWithComponents.has(line.id)) {
        addTax(taxByReturn, line.saleReturnId, line.taxKind, line.taxAmount);
      }
    }

    const vouchers: AccountingVoucher[] = headers.map(row => {
      const lines =
        row.kind === 'sale'
          ? (linesBySale.get(row.saleId) ?? [])
          : (linesByReturn.get(row.eventId) ?? []);
      // Split by the frozen normalized components when present; legacy lines
      // fall back to their single summary tax kind.
      const { ivaAmount, incAmount } =
        (row.kind === 'sale' ? taxBySale.get(row.saleId) : taxByReturn.get(row.eventId)) ??
        ({ ivaAmount: 0, incAmount: 0 } satisfies TaxSplit);
      const fiscal =
        row.kind === 'sale' ? fiscalBySale.get(row.saleId) : fiscalByReturn.get(row.eventId);
      // The header tax and the line tax kinds must agree; otherwise the
      // IVA/INC split (and any journal built from it) is fiction.
      const taxReconciled = roundMoney(ivaAmount + incAmount) === roundMoney(row.taxAmount);
      const payments =
        row.kind === 'sale'
          ? (paymentsBySale.get(row.saleId) ?? [])
          : resolveReturnPayments(row.eventId, row.refundAmount);
      const allocatedRefundAmount = payments.reduce(
        (sum, payment) => roundMoney(sum + payment.amount),
        0
      );
      const paymentReconciled =
        row.kind === 'sale' ||
        (payments.every(payment => Number.isFinite(payment.amount) && payment.amount >= 0) &&
          allocatedRefundAmount === roundMoney(row.refundAmount));
      return {
        kind: row.kind,
        eventId: row.eventId,
        saleNumber: row.saleNumber,
        createdAt: row.createdAt,
        localDate: calendarDayInTimeZone(new Date(row.createdAt), locale.timezone),
        siteNameSnapshot: row.siteNameSnapshot,
        customerNameSnapshot: row.customerNameSnapshot,
        customerTaxIdSnapshot: row.customerTaxIdSnapshot,
        currencyCode: row.currencyCode,
        subtotal: row.subtotal,
        discountAmount: row.discountAmount,
        taxAmount: row.taxAmount,
        tipAmount: row.tipAmount,
        serviceChargeAmount: row.serviceChargeAmount,
        total: row.total,
        ivaAmount,
        incAmount,
        lines,
        payments,
        fiscalDocumentNumber: fiscal?.documentNumber ?? null,
        fiscalCufe: fiscal?.cufe ?? null,
        fiscalStatus: fiscal?.status ?? null,
        refundAmount: row.refundAmount,
        taxReconciled,
        paymentReconciled,
      };
    });

    return { vouchers, truncated };
  }),
});
