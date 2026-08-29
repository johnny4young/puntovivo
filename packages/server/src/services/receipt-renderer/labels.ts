/**
 * Receipt renderer label + branding constants.
 *
 * extracted verbatim from the former single-file
 * `services/receipt-renderer.ts`. `WORDMARK_TAGLINE` gained `export` so the
 * HTML + ESC/POS block renderers can share it; `APP_FOOTER_METADATA` and
 * `DEFAULT_RECEIPT_RENDER_LABELS` were already exported (public surface).
 *
 * @module services/receipt-renderer/labels
 */
import type { ReceiptRenderLabels } from './types.js';

/**
 * pass 1 (item #5) — Puntovivo-branded `appFooter` block
 * metadata. These constants are intentionally stable across tenants:
 * the footer is a product identification surface (Siigo / Alegra
 * parallel) and not a per-tenant setting. If white-label mode is ever
 * needed, it becomes a separate change.
 *
 * Customer receipts deliberately omit a runtime version. Device and support
 * diagnostics already expose the real application version; a static value in
 * the customer footer would become false as soon as a release is cut.
 */
export const APP_FOOTER_METADATA = {
  appName: 'Puntovivo',
  appUrl: 'puntovivo.co',
  appSupport: 'soporte@puntovivo.co',
} as const;
export const WORDMARK_TAGLINE = 'CONSOLA RETAIL';

export const DEFAULT_RECEIPT_RENDER_LABELS: ReceiptRenderLabels = {
  documentTitle: 'Receipt',
  itemColumns: {
    name: 'Item',
    qty: 'Qty',
    unitPrice: 'Price',
    taxPercent: 'Tax %',
    discount: 'Disc.',
    total: 'Total',
  },
  totalsLines: {
    subtotal: 'Subtotal',
    discount: 'Discount',
    taxTotal: 'Tax',
    taxIva: 'IVA',
    taxInc: 'INC',
    tip: 'Tip',
    serviceCharge: 'Service',
    grandTotal: 'Total',
  },
  tendersTable: {
    method: 'Method',
    reference: 'Reference',
    amount: 'Amount',
    change: 'Change',
    methods: {
      cash: 'Cash',
      card: 'Card',
      transfer: 'Transfer',
      credit: 'Credit',
      other: 'Other',
    },
  },
};
