/**
 * Accounting export sub-router (`reports.accounting.*`).
 *
 * Read-only admin surface feeding the accountant hand-off page: one
 * voucher per COMPLETED sale in a date range, with its lines (frozen
 * tax kind + rate), its tender rows, and the emitted fiscal document
 * reference when one exists. The client builds the vendor-specific
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

import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import { router } from '../../init.js';
import { adminProcedure } from '../../middleware/roles.js';
import {
  cashSessions,
  fiscalDocuments,
  salePayments,
  saleItems,
  saleReturns,
  sales,
} from '../../../db/schema.js';
import { accountingVouchersInput } from '../../schemas/reports.js';
import { roundMoney } from '../../../lib/money.js';
import { resolveTenantLocale } from '../../../services/tenant-locale.js';
import {
  calendarDayInTimeZone,
  resolveUtcDayWindow,
} from '../../../services/reports/day-window.js';
import { ensureTenantSite } from '../../middleware/tenantSite.js';

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
}

export interface AccountingVoucher {
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
   * Amount already refunded on this sale. A refund keeps the sale
   * `completed` (it stays historical evidence) and books the money back
   * through a cash movement, so an export that ignored it would have
   * the merchant declare VAT on money it gave back.
   */
  refundAmount: number;
  /**
   * False when the line tax kinds do not add up to the header tax —
   * a header that arrived through sync without its lines, or a
   * data-repair row. The export refuses to build files in that state
   * instead of silently reclassifying tax as income.
   */
  taxReconciled: boolean;
}

export const accountingReportsRouter = router({
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

    const headerRows = await ctx.db
      .select({
        id: sales.id,
        saleNumber: sales.saleNumber,
        createdAt: sales.createdAt,
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
          gte(sales.createdAt, startIso),
          lt(sales.createdAt, endExclusiveIso),
          ...(input.siteId ? [eq(cashSessions.siteId, input.siteId)] : [])
        )
      )
      .orderBy(asc(sales.createdAt), asc(sales.saleNumber))
      .limit(input.limit + 1);

    const truncated = headerRows.length > input.limit;
    const headers = truncated ? headerRows.slice(0, input.limit) : headerRows;
    const saleIds = headers.map(row => row.id);

    const [lineRows, paymentRows, fiscalRows, refundRows] = saleIds.length
      ? await Promise.all([
          ctx.db
            .select({
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
            .where(inArray(saleItems.saleId, saleIds))
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
          ctx.db
            .select({ saleId: saleReturns.saleId, refundAmount: saleReturns.refundAmount })
            .from(saleReturns)
            .where(
              and(eq(saleReturns.tenantId, ctx.tenantId), inArray(saleReturns.saleId, saleIds))
            ),
        ])
      : [[], [], [], []];

    const refundsBySale = new Map<string, number>();
    for (const refund of refundRows) {
      refundsBySale.set(
        refund.saleId,
        roundMoney((refundsBySale.get(refund.saleId) ?? 0) + refund.refundAmount)
      );
    }

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
      bucket.push({ method: payment.method, amount: payment.amount });
      paymentsBySale.set(payment.saleId, bucket);
    }
    const fiscalBySale = new Map<
      string,
      { documentNumber: string | null; cufe: string | null; status: string }
    >();
    // Deterministic winner when a sale ever carries more than one
    // document (a second `kind` for the same sale): newest emission
    // wins instead of whatever the driver returned last.
    const orderedFiscalRows = [...fiscalRows].sort((a, b) =>
      (a.emittedAt ?? '').localeCompare(b.emittedAt ?? '')
    );
    for (const doc of orderedFiscalRows) {
      if (doc.sourceId !== null) {
        fiscalBySale.set(doc.sourceId, {
          documentNumber: doc.documentNumber,
          // A document the adapter has not confirmed still holds the
          // `pending-<nanoid>` placeholder minted at enqueue time;
          // exporting it would hand the accountant a fabricated CUFE.
          cufe: CONFIRMED_FISCAL_STATUSES.has(doc.status) ? doc.cufe : null,
          status: doc.status,
        });
      }
    }

    const vouchers: AccountingVoucher[] = headers.map(row => {
      const lines = linesBySale.get(row.id) ?? [];
      // Split of the header tax by the FROZEN line kind — same
      // bucketing + uniform money-rounding rule the fiscal emitter
      // applies at sale time.
      let ivaAmount = 0;
      let incAmount = 0;
      for (const line of lines) {
        if (line.taxKind === 'inc') {
          incAmount = roundMoney(incAmount + line.taxAmount);
        } else {
          ivaAmount = roundMoney(ivaAmount + line.taxAmount);
        }
      }
      const fiscal = fiscalBySale.get(row.id);
      // The header tax and the line tax kinds must agree; otherwise the
      // IVA/INC split (and any journal built from it) is fiction.
      const taxReconciled = roundMoney(ivaAmount + incAmount) === roundMoney(row.taxAmount);
      return {
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
        payments: paymentsBySale.get(row.id) ?? [],
        fiscalDocumentNumber: fiscal?.documentNumber ?? null,
        fiscalCufe: fiscal?.cufe ?? null,
        fiscalStatus: fiscal?.status ?? null,
        refundAmount: refundsBySale.get(row.id) ?? 0,
        taxReconciled,
      };
    });

    return { vouchers, truncated };
  }),
});
