/**
 * Receipt renderer label + branding constants.
 *
 * ENG-178 — extracted verbatim from the former single-file
 * `services/receipt-renderer.ts`. `WORDMARK_TAGLINE` gained `export` so the
 * HTML + ESC/POS block renderers can share it; `APP_FOOTER_METADATA` and
 * `DEFAULT_RECEIPT_RENDER_LABELS` were already exported (public surface).
 *
 * @module services/receipt-renderer/labels
 */
import type { ReceiptRenderLabels } from './types.js';

/**
 * ENG-016 pass 1 (item #5) — Puntovivo-branded `appFooter` block
 * metadata. These constants are intentionally stable across tenants:
 * the footer is a product identification surface (Siigo / Alegra
 * parallel) and not a per-tenant setting. If white-label mode is ever
 * needed, it becomes a separate ticket.
 *
 * `appName` + `appVersion` are split so downstream tests can pin the
 * version independently of the `package.json` read — the renderer
 * never imports `process.env` or the filesystem to keep the function
 * pure.
 */
export const APP_FOOTER_METADATA = {
  appName: 'Puntovivo',
  appVersion: '1.0.0',
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
    tip: 'Tip',
    serviceCharge: 'Service',
    grandTotal: 'Total',
  },
  tendersTable: {
    method: 'Method',
    reference: 'Reference',
    amount: 'Amount',
    change: 'Change',
  },
};
