import type { EditorReceiptLayout, ReceiptBlockKind } from './defaultLayouts';

/**
 * Block kinds offered in the add-block menu, in display order.
 * puts `wordmark` near the top so operators see it first when composing
 * the header band of a thermal layout.
 */
export const BLOCK_KINDS: ReceiptBlockKind[] = [
  'logo',
  // wordmark sits at the top so operators see it first when
  // composing the header band of a thermal layout.
  'wordmark',
  'text',
  'metaTable',
  'itemsTable',
  'totalsBlock',
  'tendersTable',
  'qr',
  'separator',
  'barcode128',
  // pass 1 (item #5) — Puntovivo-branded footer.
  'appFooter',
];

/** Paper-width presets exposed in the layout-settings select. */
export const PAPER_WIDTHS: EditorReceiptLayout['paperWidth'][] = ['58mm', '80mm', 'letter', 'a4'];

/** Selectable columns for an `itemsTable` block (BlockForm checkbox grid). */
export const ITEMS_TABLE_COLUMNS = [
  'name',
  'qty',
  'unitPrice',
  'taxPercent',
  'discount',
  'total',
] as const;

/** Selectable lines for a `totalsBlock` block (BlockForm checkbox grid). */
export const TOTALS_LINES = [
  'subtotal',
  'discount',
  'taxTotal',
  'tip',
  // service charge line, paired with `RenderSale.serviceCharge`.
  'serviceCharge',
  'grandTotal',
] as const;
