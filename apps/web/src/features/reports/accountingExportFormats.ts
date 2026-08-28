/**
 * Pure builders for the accountant hand-off files. Three formats from
 * the same `reports.accounting.vouchers` payload:
 *
 * - Siigo Nube "facturas de venta" template: the 31 documented columns
 *   (A–AE) in their exact order, one row per sale LINE, chunked at the
 *   documented 500-row-per-file limit. Company-specific Siigo codes
 *   (tax code, seller id, voucher type) cannot be known here — those
 *   columns ship empty for the accountant to fill or map.
 * - Balanced journal entries (comprobante contable): one entry per
 *   sale or refund event — sales book tender debits and refunds reverse
 *   the source accounts on their own event date, over editable default PUC accounts. Designed for Alegra's
 *   column-mapping import; debits always equal credits by
 *   construction.
 * - Generic voucher lines: every field flat, for World Office or any
 *   template-mapping import.
 *
 * Builders are PURE (no i18n, no Date.now) so tests pin the column
 * contract byte-for-byte; the page provides localized filenames.
 */

import type { AppRouter } from '@puntovivo/server';
import type { inferRouterOutputs } from '@trpc/server';

type RouterOutputs = inferRouterOutputs<AppRouter>;
export type AccountingVoucher =
  RouterOutputs['reports']['accounting']['vouchers']['vouchers'][number];

/** Documented Siigo Nube limit per uploaded file. */
export const SIIGO_MAX_ROWS_PER_FILE = 500;

/**
 * The 31 template columns (A–AE) of Siigo Nube's facturas-de-venta
 * import, in their exact documented order. Do not reorder or rename:
 * the claim of this export is byte-order fidelity to the template.
 */
export const SIIGO_INVOICE_COLUMNS = [
  'Tipo de comprobante',
  'Consecutivo',
  'Identificación tercero',
  'Sucursal',
  'Código centro/subcentro de costos',
  'Fecha de elaboración',
  'Sigla Moneda',
  'Tasa de cambio',
  'Nombre contacto',
  'Email Contacto',
  'Orden de compra',
  'Orden de entrega',
  'Fecha orden de entrega',
  'Código producto',
  'Descripción producto',
  'Identificación vendedor',
  'Código de Bodega',
  'Cantidad producto',
  'Valor unitario',
  'Valor Descuento',
  'Base AIU',
  'Identificación ingreso para terceros',
  'Código impuesto cargo',
  'Código impuesto cargo dos',
  'Código impuesto retención',
  'Código ReteICA',
  'Código ReteIVA',
  'Código forma de pago',
  'Valor forma de pago',
  'Fecha Vencimiento',
  'Observaciones',
] as const;

/**
 * `DD/MM/AAAA` from the TENANT-LOCAL calendar day the server resolved.
 * Deliberately not derived from the ISO instant with browser-local
 * getters: a workstation in another timezone would date rows into a
 * neighbouring (possibly closed) accounting period.
 */
function siigoDate(localDate: string): string {
  const [year, month, day] = localDate.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Numeric consecutive for the Siigo template. Puntovivo sale numbers
 * are `<prefix><6-digit body>` and the prefix is PER SITE by design
 * (AGENTS.md: `(tenant, sale_number)` is unique, the numeric body is
 * not), so only the TRAILING digit run is the consecutive — stripping
 * every non-digit would fold `VTA-N-000123` and `VTA-S-000123` (and
 * any prefix containing digits, e.g. `FE1`) onto the same number and
 * Siigo would merge two invoices into one document.
 */
export function siigoConsecutive(saleNumber: string): string {
  const trailing = /(\d+)$/.exec(saleNumber)?.[1];
  if (trailing === undefined) return saleNumber;
  // Sale numbers are `<prefix><6-digit body>`, and a prefix may itself
  // end in a digit (a DIAN resolution prefix like `FE1`), so the body
  // is the LAST SIX digits — never the whole trailing run.
  const body = trailing.length > 6 ? trailing.slice(-6) : trailing;
  const normalized = body.replace(/^0+(?=\d)/, '');
  return normalized.length > 0 ? normalized : body;
}

/**
 * Sale numbers whose Siigo consecutive collides. The numeric body is
 * only unique PER SITE (AGENTS.md mandates per-site prefixes), and
 * Siigo groups rows into one document by Consecutivo — so a range
 * mixing sites would silently merge two invoices. Sucursal cannot
 * disambiguate them (Siigo expects a 3-character NUMERIC branch code
 * that only the company knows), so the export refuses instead: the
 * operator exports one site at a time.
 */
export function findSiigoConsecutiveCollisions(vouchers: AccountingVoucher[]): string[] {
  const bySaleNumber = new Map<string, Set<string>>();
  for (const voucher of vouchers) {
    if (voucher.kind !== 'sale') continue;
    const consecutive = siigoConsecutive(voucher.saleNumber);
    const bucket = bySaleNumber.get(consecutive) ?? new Set<string>();
    bucket.add(voucher.saleNumber);
    bySaleNumber.set(consecutive, bucket);
  }
  return [...bySaleNumber.entries()]
    .filter(([, saleNumbers]) => saleNumbers.size > 1)
    .map(([consecutive]) => consecutive)
    .sort();
}

export interface SiigoRow {
  cells: string[];
}

/**
 * One row per sale line in the Siigo column order. The per-invoice
 * payment (Código/Valor forma de pago) repeats on every row of that
 * invoice — Siigo groups rows into one document by Consecutivo.
 * Multi-tender sales report the SUMMED tender in Valor forma de pago
 * with an empty payment code for the accountant to split; the
 * observaciones column carries the original sale number + fiscal ref.
 */
export function buildSiigoInvoiceRows(vouchers: AccountingVoucher[]): SiigoRow[] {
  const rows: SiigoRow[] = [];
  for (const voucher of vouchers) {
    if (voucher.kind !== 'sale') continue;
    // Rounded like every other monetary accumulation in the product;
    // a raw reduce serializes `99.99999999999999` into the file.
    const paymentTotal = round2(voucher.payments.reduce((sum, payment) => sum + payment.amount, 0));
    const observations = [
      voucher.saleNumber,
      // Only cite the fiscal document when the adapter confirmed it —
      // a reserved-but-unemitted consecutive is not a reference the
      // accountant can file.
      voucher.fiscalCufe && voucher.fiscalDocumentNumber
        ? `Doc ${voucher.fiscalDocumentNumber}`
        : null,
    ]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 300);
    voucher.lines.forEach((line, lineIndex) => {
      const isFirstLine = lineIndex === 0;
      // The header-level discount belongs to the invoice, not to a
      // line; Siigo has no header discount column, so it rides on the
      // first line's Valor Descuento together with that line's own
      // discount. Dropping it would make the imported invoice total
      // disagree with the electronic document already filed with DIAN.
      // sale_items.discount is a PERCENTAGE, while Siigo expects a
      // monetary Valor Descuento. Convert from the frozen gross line
      // value before adding the invoice-level amount once.
      const grossLineAmount = round2(line.unitPrice * line.quantity);
      const lineDiscountAmount = round2(grossLineAmount * (line.discount / 100));
      const discountCell = round2(lineDiscountAmount + (isFirstLine ? voucher.discountAmount : 0));
      rows.push({
        cells: [
          '', // Tipo de comprobante — company-specific Siigo code
          siigoConsecutive(voucher.saleNumber),
          voucher.customerTaxIdSnapshot ?? '222222222222', // consumidor final
          '', // Sucursal — company-specific 3-character numeric code
          '', // Centro de costos
          siigoDate(voucher.localDate),
          voucher.currencyCode === 'COP' ? '' : voucher.currencyCode,
          '', // Tasa de cambio
          '', // Nombre contacto
          '', // Email contacto
          '', // Orden de compra
          '', // Orden de entrega
          '', // Fecha orden de entrega
          line.productSkuSnapshot ?? '',
          line.productNameSnapshot ?? '',
          '', // Identificación vendedor — company-specific
          '', // Código de bodega
          String(line.quantity),
          String(line.unitPrice),
          discountCell > 0 ? String(discountCell) : '',
          '', // Base AIU
          '', // Ingreso para terceros
          '', // Código impuesto cargo — company-specific
          '', // Código impuesto cargo dos
          '', // Código impuesto retención
          '', // Código ReteICA
          '', // Código ReteIVA
          '', // Código forma de pago — company-specific
          // Valor forma de pago is a per-ROW allocation, not a header
          // total: repeating it on continuation lines would register
          // the tender once per line and leave a phantom credit on the
          // third party.
          isFirstLine ? String(paymentTotal) : '',
          '', // Fecha vencimiento
          observations,
        ],
      });
    });
  }
  return rows;
}

/**
 * Split rows into files honoring the documented 500-row limit. Files
 * prefer to break on an invoice boundary so one document lands whole;
 * a SINGLE invoice longer than the limit is still split, because a
 * 600-row file is rejected by Siigo outright — an over-limit file is
 * worse than a split document the accountant merges.
 */
export function chunkSiigoRows(rows: SiigoRow[]): SiigoRow[][] {
  // Group by Consecutivo first so packing decisions know how long each
  // invoice is (rows of one invoice are contiguous by construction).
  const invoices: SiigoRow[][] = [];
  let currentInvoice: SiigoRow[] = [];
  let currentConsecutive: string | null = null;
  for (const row of rows) {
    const consecutive = row.cells[1] ?? '';
    if (currentInvoice.length > 0 && consecutive !== currentConsecutive) {
      invoices.push(currentInvoice);
      currentInvoice = [];
    }
    currentInvoice.push(row);
    currentConsecutive = consecutive;
  }
  if (currentInvoice.length > 0) invoices.push(currentInvoice);

  const chunks: SiigoRow[][] = [];
  let chunk: SiigoRow[] = [];
  for (const invoice of invoices) {
    if (invoice.length > SIIGO_MAX_ROWS_PER_FILE) {
      // A single invoice longer than the limit must still be split:
      // Siigo rejects an over-limit file outright, so a split document
      // the accountant merges beats an upload that never lands.
      if (chunk.length > 0) {
        chunks.push(chunk);
        chunk = [];
      }
      for (let index = 0; index < invoice.length; index += SIIGO_MAX_ROWS_PER_FILE) {
        chunks.push(invoice.slice(index, index + SIIGO_MAX_ROWS_PER_FILE));
      }
      continue;
    }
    if (chunk.length + invoice.length > SIIGO_MAX_ROWS_PER_FILE) {
      chunks.push(chunk);
      chunk = [];
    }
    chunk.push(...invoice);
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

export interface AccountingPucAccounts {
  paymentMethods: Record<'cash' | 'card' | 'transfer' | 'credit' | 'other', string>;
  income: string;
  iva: string;
  inc: string;
  tips: string;
  /** Accounts receivable for the unpaid remainder of a partial sale. */
  receivable: string;
  /** Refunds already returned to the customer (sales returns). */
  refunds: string;
}

export interface JournalEntryRow {
  /** Voucher grouping key (the sale number). */
  voucher: string;
  date: string;
  thirdPartyId: string;
  thirdPartyName: string;
  account: string;
  description: string;
  debit: number;
  credit: number;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function paymentAccount(accounts: AccountingPucAccounts, method: string): string {
  return method === 'cash' ||
    method === 'card' ||
    method === 'transfer' ||
    method === 'credit' ||
    method === 'other'
    ? accounts.paymentMethods[method]
    : accounts.paymentMethods.other;
}

/**
 * One balanced entry per accounting event. A sale debits its tenders
 * (plus any receivable) and credits IVA, INC, tips and net income. A
 * refund is a separate voucher dated by the return: it debits the
 * proportional tax/tip plus the sales-return account and credits the
 * original tender accounts. Remainders keep each voucher balanced to
 * the cent regardless of component rounding.
 */
export function buildJournalEntries(
  vouchers: AccountingVoucher[],
  accounts: AccountingPucAccounts
): JournalEntryRow[] {
  const rows: JournalEntryRow[] = [];
  for (const voucher of vouchers) {
    const date = siigoDate(voucher.localDate);
    const thirdPartyId = voucher.customerTaxIdSnapshot ?? '222222222222';
    const thirdPartyName = voucher.customerNameSnapshot ?? 'Consumidor final';
    const base = {
      voucher:
        voucher.kind === 'refund'
          ? `${voucher.saleNumber}-DEV-${voucher.eventId.slice(-8)}`
          : voucher.saleNumber,
      date,
      thirdPartyId,
      thirdPartyName,
    };

    if (voucher.kind === 'refund') {
      const refundAmount = round2(voucher.refundAmount);
      if (refundAmount <= 0) continue;
      const ratio = voucher.total > 0 ? Math.min(1, refundAmount / voucher.total) : 0;
      const ivaReversal = round2(voucher.ivaAmount * ratio);
      const incReversal = round2(voucher.incAmount * ratio);
      const tipReversal = round2(voucher.tipAmount * ratio);
      const incomeReversal = round2(refundAmount - ivaReversal - incReversal - tipReversal);

      if (incomeReversal !== 0) {
        rows.push({
          ...base,
          account: accounts.refunds,
          description: `Devolución venta ${voucher.saleNumber}`,
          debit: incomeReversal > 0 ? incomeReversal : 0,
          credit: incomeReversal < 0 ? round2(-incomeReversal) : 0,
        });
      }
      if (ivaReversal > 0) {
        rows.push({
          ...base,
          account: accounts.iva,
          description: `Reversión IVA venta ${voucher.saleNumber}`,
          debit: ivaReversal,
          credit: 0,
        });
      }
      if (incReversal > 0) {
        rows.push({
          ...base,
          account: accounts.inc,
          description: `Reversión INC venta ${voucher.saleNumber}`,
          debit: incReversal,
          credit: 0,
        });
      }
      if (tipReversal > 0) {
        rows.push({
          ...base,
          account: accounts.tips,
          description: `Reversión propina venta ${voucher.saleNumber}`,
          debit: tipReversal,
          credit: 0,
        });
      }

      const positivePayments = voucher.payments.filter(payment => payment.amount > 0);
      const paymentTotal = round2(
        positivePayments.reduce((sum, payment) => sum + payment.amount, 0)
      );
      const refundPayments =
        paymentTotal > 0 ? positivePayments : [{ method: 'cash', amount: refundAmount }];
      let credited = 0;
      refundPayments.forEach((payment, index) => {
        const amount =
          index === refundPayments.length - 1
            ? round2(refundAmount - credited)
            : round2(refundAmount * (payment.amount / (paymentTotal || refundAmount)));
        if (amount <= 0) return;
        credited = round2(credited + amount);
        rows.push({
          ...base,
          account: paymentAccount(accounts, payment.method),
          description: `Reembolso venta ${voucher.saleNumber} · ${payment.method}`,
          debit: 0,
          credit: amount,
        });
      });
      continue;
    }

    const payments =
      voucher.payments.length > 0 ? voucher.payments : [{ method: 'other', amount: voucher.total }];
    let debited = 0;
    let tendered = 0;
    for (const payment of payments) {
      const amount = round2(payment.amount);
      if (amount === 0) continue;
      debited = round2(debited + amount);
      tendered = round2(tendered + amount);
      rows.push({
        ...base,
        account: paymentAccount(accounts, payment.method),
        description: `Venta ${voucher.saleNumber} · ${payment.method}`,
        debit: amount > 0 ? amount : 0,
        // A negative tender (split refund) posts as a credit so the
        // entry still balances.
        credit: amount < 0 ? round2(-amount) : 0,
      });
    }

    // Whatever the customer did not tender is a receivable, not lost
    // income: a partial payment must still post the full invoice value.
    const receivable = round2(voucher.total - tendered);
    if (receivable > 0) {
      rows.push({
        ...base,
        account: accounts.receivable,
        description: `Saldo por cobrar venta ${voucher.saleNumber}`,
        debit: receivable,
        credit: 0,
      });
      debited = round2(debited + receivable);
    }
    if (voucher.ivaAmount > 0) {
      rows.push({
        ...base,
        account: accounts.iva,
        description: `IVA venta ${voucher.saleNumber}`,
        debit: 0,
        credit: round2(voucher.ivaAmount),
      });
    }
    if (voucher.incAmount > 0) {
      rows.push({
        ...base,
        account: accounts.inc,
        description: `INC venta ${voucher.saleNumber}`,
        debit: 0,
        credit: round2(voucher.incAmount),
      });
    }
    if (voucher.tipAmount > 0) {
      rows.push({
        ...base,
        account: accounts.tips,
        description: `Propina venta ${voucher.saleNumber}`,
        debit: 0,
        credit: round2(voucher.tipAmount),
      });
    }
    const income = round2(debited - voucher.ivaAmount - voucher.incAmount - voucher.tipAmount);
    if (income !== 0) {
      rows.push({
        ...base,
        account: accounts.income,
        description: `Ingreso venta ${voucher.saleNumber}`,
        debit: income < 0 ? round2(-income) : 0,
        credit: income > 0 ? income : 0,
      });
    }
  }
  return rows;
}

export interface GenericVoucherRow {
  eventType: 'sale' | 'refund';
  eventId: string;
  saleNumber: string;
  date: string;
  site: string;
  customerName: string;
  customerTaxId: string;
  product: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  lineDiscount: number;
  taxKind: string;
  taxRate: number;
  taxAmount: number;
  lineTotal: number;
  saleSubtotal: number;
  saleDiscount: number;
  saleIva: number;
  saleInc: number;
  saleTip: number;
  saleServiceCharge: number;
  saleTotal: number;
  paymentMethods: string;
  currency: string;
  fiscalDocument: string;
  fiscalCufe: string;
  /** Emission status; blank when the sale has no fiscal document. */
  fiscalStatus: string;
}

/** Flat per-line rows for template-mapping imports (World Office and
 * any system with a column-mapping importer). */
export function buildGenericVoucherRows(vouchers: AccountingVoucher[]): GenericVoucherRow[] {
  const rows: GenericVoucherRow[] = [];
  for (const voucher of vouchers) {
    const refundRatio =
      voucher.kind === 'refund' && voucher.total > 0
        ? Math.min(1, voucher.refundAmount / voucher.total)
        : 1;
    const sign = voucher.kind === 'refund' ? -1 : 1;
    const paymentMethods = voucher.payments
      .map(payment => `${payment.method}:${round2(payment.amount * refundRatio * sign)}`)
      .join(' | ');
    for (const line of voucher.lines) {
      rows.push({
        eventType: voucher.kind,
        eventId: voucher.eventId,
        saleNumber: voucher.saleNumber,
        date: voucher.localDate,
        site: voucher.siteNameSnapshot ?? '',
        customerName: voucher.customerNameSnapshot ?? '',
        customerTaxId: voucher.customerTaxIdSnapshot ?? '',
        product: line.productNameSnapshot ?? '',
        sku: line.productSkuSnapshot ?? '',
        quantity: round2(line.quantity * refundRatio * sign),
        unitPrice: line.unitPrice,
        lineDiscount: line.discount,
        taxKind: line.taxKind,
        taxRate: line.taxRate,
        taxAmount: round2(line.taxAmount * refundRatio * sign),
        lineTotal: round2(line.total * refundRatio * sign),
        saleSubtotal: round2(voucher.subtotal * refundRatio * sign),
        saleDiscount: round2(voucher.discountAmount * refundRatio * sign),
        saleIva: round2(voucher.ivaAmount * refundRatio * sign),
        saleInc: round2(voucher.incAmount * refundRatio * sign),
        saleTip: round2(voucher.tipAmount * refundRatio * sign),
        saleServiceCharge: round2(voucher.serviceChargeAmount * refundRatio * sign),
        saleTotal: voucher.kind === 'refund' ? round2(-voucher.refundAmount) : voucher.total,
        paymentMethods,
        currency: voucher.currencyCode,
        fiscalDocument: voucher.fiscalDocumentNumber ?? '',
        fiscalCufe: voucher.fiscalCufe ?? '',
        fiscalStatus: voucher.fiscalStatus ?? '',
      });
    }
  }
  return rows;
}
