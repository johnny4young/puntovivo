/**
 * Receipt renderer formatting helpers (currency, dates, item/totals cells,
 * paper width, alignment).
 *
 * ENG-178 — extracted verbatim from the former single-file
 * `services/receipt-renderer.ts`. These were module-private; they gain `export`
 * so the HTML + ESC/POS block modules and the eval-context builder share them.
 * Import leaf relative to the block renderers (depends only on types + the
 * external print-tokens / template-expression utilities).
 *
 * @module services/receipt-renderer/format-helpers
 */
import type { ReceiptLayout } from '../../trpc/schemas/receiptTemplates.js';
import { PRINT_TOKENS } from '../print-tokens.js';
import { applyDatePattern } from '../template-expression.js';
import type {
  ReceiptRenderLabels,
  ReceiptRenderLocale,
  RenderData,
  RenderSaleItem,
} from './types.js';

export const PAPER_WIDTH_PX: Record<ReceiptLayout['paperWidth'], number> = {
  '58mm': PRINT_TOKENS.paper58mmDots,
  '80mm': PRINT_TOKENS.paper80mmDots,
  letter: 612,
  a4: 595,
};

export function alignClass(align?: string): string {
  return align === 'center'
    ? 'align-center'
    : align === 'right'
      ? 'align-right'
      : 'align-left';
}

export function itemColumnLabel(
  column: string,
  labels: ReceiptRenderLabels
): string {
  switch (column) {
    case 'name':
      return labels.itemColumns.name;
    case 'qty':
      return labels.itemColumns.qty;
    case 'unitPrice':
      return labels.itemColumns.unitPrice;
    case 'taxPercent':
      return labels.itemColumns.taxPercent;
    case 'discount':
      return labels.itemColumns.discount;
    case 'total':
      return labels.itemColumns.total;
    default:
      return column;
  }
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(2);
}

/**
 * ENG-017 — format a currency amount honoring the tenant's resolved
 * locale. When `locale` is missing (legacy test callers), falls back
 * to raw `.toFixed(2)` without a symbol so the pre-ENG-017 contract
 * keeps working. When present, `Intl.NumberFormat` produces the
 * country-correct output (COP = `$ 1.234`, USD = `$1,234.50`,
 * CLP = `$ 1.234`).
 *
 * ENG-016 pass 3 — `decimalsOverride` lets the `{{ currency(value, n) }}`
 * template function pin a specific decimal count regardless of the
 * tenant locale (useful when a receipt deliberately wants `123.00` even
 * for COP, or `123` even for USD).
 */
export function formatReceiptAmount(
  value: number,
  locale: ReceiptRenderLocale | undefined,
  decimalsOverride?: number
): string {
  if (!Number.isFinite(value)) return '0';
  const fallbackDecimals =
    decimalsOverride !== undefined ? decimalsOverride : 2;
  if (!locale) return value.toFixed(fallbackDecimals);
  const decimals =
    decimalsOverride !== undefined
      ? decimalsOverride
      : locale.displayDecimals;
  return new Intl.NumberFormat(locale.locale, {
    style: 'currency',
    currency: locale.currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * ENG-016 pass 3 — Format a date for `{{ date(value, pattern?) }}`.
 * Coerces ISO strings, Date instances, and unix-ms numbers to a Date,
 * then runs `applyDatePattern` against the tenant's `dateFormat` (when
 * available) or `yyyy-MM-dd` (the deterministic fallback). Returns the
 * empty string when the input cannot be parsed — keeps the receipt
 * clean for partially-configured tenants.
 */
export function formatTemplateDate(
  value: unknown,
  pattern: string | undefined
): string {
  let date: Date | null = null;
  if (value instanceof Date) {
    date = Number.isFinite(value.getTime()) ? value : null;
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    date = new Date(value);
  } else if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) {
      const candidate = new Date(trimmed);
      date = Number.isFinite(candidate.getTime()) ? candidate : null;
    }
  }
  if (!date) return '';
  return applyDatePattern(date, pattern ?? 'yyyy-MM-dd');
}

export function formatItemCell(
  column: string,
  item: RenderSaleItem,
  locale: ReceiptRenderLocale | undefined
): string {
  switch (column) {
    case 'name':
      return item.name;
    case 'qty':
      return formatNumber(item.qty);
    case 'unitPrice':
      return formatReceiptAmount(item.unitPrice, locale);
    case 'taxPercent':
      return `${formatNumber(item.taxPercent)}%`;
    case 'discount':
      return formatNumber(item.discount);
    case 'total':
      return formatReceiptAmount(item.total, locale);
    default:
      return '';
  }
}

export function totalsLabel(
  line: string,
  labels: ReceiptRenderLabels
): string {
  switch (line) {
    case 'subtotal':
      return labels.totalsLines.subtotal;
    case 'discount':
      return labels.totalsLines.discount;
    case 'taxTotal':
      return labels.totalsLines.taxTotal;
    case 'tip':
      return labels.totalsLines.tip;
    case 'serviceCharge':
      return labels.totalsLines.serviceCharge;
    case 'grandTotal':
      return labels.totalsLines.grandTotal;
    default:
      return line;
  }
}

export function totalsValue(line: string, data: RenderData): number {
  switch (line) {
    case 'subtotal':
      return data.sale.subtotal;
    case 'discount':
      return data.sale.discount;
    case 'taxTotal':
      return data.sale.taxTotal;
    case 'tip':
      return data.sale.tip;
    case 'serviceCharge':
      return data.sale.serviceCharge;
    case 'grandTotal':
      return data.sale.grandTotal;
    default:
      return 0;
  }
}
