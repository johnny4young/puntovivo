/**
 * Receipt Renderer (Iter 2 — pure function shared by HTML and ESC/POS targets).
 *
 * Single source of truth for converting a `ReceiptLayout` + sale data
 * into both the HTML used by `webContents.print()` AND the ESC/POS
 * byte stream consumed by thermal printers (Iter 4 will wire the
 * latter to a real driver; for now we emit raw ESC/POS bytes that any
 * commodity 58mm/80mm printer accepts).
 *
 * The function is pure (no I/O, no DOM access, no globals): a given
 * layout + data input always produces the same output bytes. This
 * makes it trivially testable and lets the editor preview the result
 * deterministically before saving.
 *
 * Security model: all variable substitutions are HTML-escaped before
 * concatenation. Even though the Zod schema rejects unknown
 * namespaces, the renderer treats every value as untrusted (defense
 * in depth) — operators editing the layout cannot inject markup that
 * survives `<script>` escaping.
 *
 * @module services/receipt-renderer
 */

import type {
  ReceiptBlock,
  ReceiptLayout,
} from '../trpc/schemas/receiptTemplates.js';
import type { ReceiptTemplateKind } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Render data shape
// ---------------------------------------------------------------------------

export interface RenderCompany {
  name: string;
  taxId: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
}

export interface RenderSaleItem {
  name: string;
  sku?: string | null;
  qty: number;
  unitPrice: number;
  taxPercent: number;
  discount: number;
  total: number;
}

export interface RenderTender {
  method: string;
  amount: number;
  reference?: string | null;
}

export interface RenderSale {
  saleNumber: string;
  cashier?: string | null;
  site?: string | null;
  customer?: string | null;
  customerTaxId?: string | null;
  createdAt: string;
  subtotal: number;
  discount: number;
  taxTotal: number;
  tip: number;
  grandTotal: number;
  changeDue?: number | null;
  notes?: string | null;
  items: RenderSaleItem[];
  tenders: RenderTender[];
}

export interface RenderFiscal {
  cufe?: string | null;
  qrUrl?: string | null;
  resolution?: string | null;
  documentNumber?: string | null;
}

/**
 * Logo is intentionally optional. If not present, the `logo` block
 * renders an empty placeholder in HTML and skips emission in ESC/POS.
 * This keeps the renderer pure and lets templates be safely shared
 * across tenants that may not have configured a logo yet.
 */
export interface RenderData {
  company: RenderCompany;
  sale: RenderSale;
  fiscal?: RenderFiscal;
  logoDataUrl?: string | null;
  /**
   * ENG-017 — resolved tenant locale. When present the renderer
   * formats currency-typed fields (unitPrice, total, subtotal, tax,
   * tenders, change) through `Intl.NumberFormat` so receipts match
   * the tenant's country (COP with 0 decimals for Colombia, USD with
   * 2 for USA, CLP with 0 for Chile, etc.). Optional for backwards
   * compatibility with test callers that synthesise RenderData by
   * hand — when absent the renderer falls back to raw `.toFixed(2)`
   * without a currency symbol (pre-ENG-017 behaviour).
   */
  locale?: ReceiptRenderLocale;
}

/**
 * Subset of `ResolvedLocale` the renderer needs. Kept separate from
 * the full `services/tenant-locale.ts` shape so the renderer can stay
 * pure (no DB imports) — callers resolve the locale once and hand the
 * small payload in.
 */
export interface ReceiptRenderLocale {
  locale: string;
  currency: string;
  legalDecimals: number;
  displayDecimals: number;
}

// ---------------------------------------------------------------------------
// HTML escape + variable substitution
// ---------------------------------------------------------------------------

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => HTML_ESCAPE_MAP[char] ?? char);
}

const VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*\.[a-zA-Z0-9_.]+)\s*\}\}/g;

/**
 * Resolve a dotted path inside a record. Returns undefined if any
 * segment is missing — the renderer treats that as the empty string
 * to keep partially-configured layouts robust (a freshly-installed
 * tenant may not have set `fiscal.cufe` yet, and the receipt should
 * still print cleanly).
 */
function lookupPath(data: RenderData, path: string): unknown {
  const segments = path.split('.');
  let current: unknown = data as unknown as Record<string, unknown>;
  for (const segment of segments) {
    if (current && typeof current === 'object' && segment in current) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

function formatScalar(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value.toString() : '';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return String(value);
}

/**
 * Resolve `{{variable}}` substitutions inside a template string and
 * return the result already HTML-escaped. The function NEVER concats
 * raw user input into HTML — escaping happens in the same call so the
 * caller cannot accidentally bypass it.
 */
export function resolveAndEscape(template: string, data: RenderData): string {
  // Build pieces with explicit string-vs-variable provenance, escape
  // only the variable values, then join. This way literal `<` in the
  // template (e.g. an admin who legitimately wants `<` displayed) is
  // also escaped via the escapeHtml(template) call below — there is no
  // safe path that emits raw markup from this function.
  const parts: string[] = [];
  let cursor = 0;
  for (const match of template.matchAll(VARIABLE_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push(escapeHtml(template.slice(cursor, start)));
    }
    const path = match[1] ?? '';
    const resolved = lookupPath(data, path);
    parts.push(escapeHtml(formatScalar(resolved)));
    cursor = start + match[0].length;
  }
  if (cursor < template.length) {
    parts.push(escapeHtml(template.slice(cursor)));
  }
  return parts.join('');
}

/**
 * Plain-text variant for ESC/POS output. Same semantics as
 * `resolveAndEscape` but without HTML escaping (the printer renders
 * raw bytes; HTML entities would print literally). Variables still
 * resolve through the same whitelist that Zod enforced upstream.
 */
function resolvePlain(template: string, data: RenderData): string {
  return template.replace(VARIABLE_PATTERN, (_, path: string) => {
    return formatScalar(lookupPath(data, path));
  });
}

// ---------------------------------------------------------------------------
// HTML rendering
// ---------------------------------------------------------------------------

const PAPER_WIDTH_PX: Record<string, number> = {
  '58mm': 220,
  '80mm': 300,
  letter: 612,
  a4: 595,
};

export interface ReceiptRenderLabels {
  documentTitle: string;
  itemColumns: {
    name: string;
    qty: string;
    unitPrice: string;
    taxPercent: string;
    discount: string;
    total: string;
  };
  totalsLines: {
    subtotal: string;
    discount: string;
    taxTotal: string;
    tip: string;
    grandTotal: string;
  };
  tendersTable: {
    method: string;
    reference: string;
    amount: string;
    change: string;
  };
}

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
    grandTotal: 'Total',
  },
  tendersTable: {
    method: 'Method',
    reference: 'Reference',
    amount: 'Amount',
    change: 'Change',
  },
};

function alignClass(align?: string): string {
  return align === 'center'
    ? 'align-center'
    : align === 'right'
      ? 'align-right'
      : 'align-left';
}

function renderTextBlockHtml(
  block: Extract<ReceiptBlock, { type: 'text' }>,
  data: RenderData
): string {
  const safe = resolveAndEscape(block.value, data);
  const classes = [`style-${block.style ?? 'normal'}`, alignClass(block.align)];
  if (block.bold) classes.push('bold');
  return `<div class="block block-text ${classes.join(' ')}">${safe}</div>`;
}

function renderLogoBlockHtml(
  block: Extract<ReceiptBlock, { type: 'logo' }>,
  data: RenderData
): string {
  if (!data.logoDataUrl) {
    return `<div class="block block-logo block-logo-empty ${alignClass(block.align)}"></div>`;
  }
  const heightStyle = block.maxHeightMm
    ? ` style="max-height: ${block.maxHeightMm}mm;"`
    : '';
  // The data URL never goes through escapeHtml because it is a
  // tenant-controlled binary asset, not a layout variable. Source of
  // truth: the `logos` table referenced from the company snapshot.
  return `<div class="block block-logo ${alignClass(block.align)}"><img src="${data.logoDataUrl}" alt=""${heightStyle} /></div>`;
}

function renderItemsTableHtml(
  block: Extract<ReceiptBlock, { type: 'itemsTable' }>,
  data: RenderData,
  labels: ReceiptRenderLabels
): string {
  const showHeader = block.showHeader ?? true;
  const headerCells = showHeader
    ? `<thead><tr>${block.columns
        .map(col => `<th class="col-${col}">${escapeHtml(itemColumnLabel(col, labels))}</th>`)
        .join('')}</tr></thead>`
    : '';
  const rowCells = data.sale.items
    .map(item => {
      const cells = block.columns
        .map(col => {
          const text = formatItemCell(col, item, data.locale);
          return `<td class="col-${col}">${escapeHtml(text)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `<div class="block block-items"><table>${headerCells}<tbody>${rowCells}</tbody></table></div>`;
}

function itemColumnLabel(
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

function formatNumber(value: number): string {
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
 */
function formatReceiptAmount(
  value: number,
  locale: ReceiptRenderLocale | undefined
): string {
  if (!Number.isFinite(value)) return '0';
  if (!locale) return value.toFixed(2);
  return new Intl.NumberFormat(locale.locale, {
    style: 'currency',
    currency: locale.currency,
    minimumFractionDigits: locale.displayDecimals,
    maximumFractionDigits: locale.displayDecimals,
  }).format(value);
}

function formatItemCell(
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

function renderTotalsBlockHtml(
  block: Extract<ReceiptBlock, { type: 'totalsBlock' }>,
  data: RenderData,
  labels: ReceiptRenderLabels
): string {
  const rows = block.show
    .map(line => {
      const label = totalsLabel(line, labels);
      const value = totalsValue(line, data);
      return `<tr><td class="totals-label">${escapeHtml(label)}</td><td class="totals-value">${escapeHtml(formatReceiptAmount(value, data.locale))}</td></tr>`;
    })
    .join('');
  return `<div class="block block-totals"><table><tbody>${rows}</tbody></table></div>`;
}

function totalsLabel(
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
    case 'grandTotal':
      return labels.totalsLines.grandTotal;
    default:
      return line;
  }
}

function totalsValue(line: string, data: RenderData): number {
  switch (line) {
    case 'subtotal':
      return data.sale.subtotal;
    case 'discount':
      return data.sale.discount;
    case 'taxTotal':
      return data.sale.taxTotal;
    case 'tip':
      return data.sale.tip;
    case 'grandTotal':
      return data.sale.grandTotal;
    default:
      return 0;
  }
}

function renderTendersTableHtml(
  block: Extract<ReceiptBlock, { type: 'tendersTable' }>,
  data: RenderData,
  labels: ReceiptRenderLabels
): string {
  const rows = data.sale.tenders
    .map(tender => {
      return `<tr><td>${escapeHtml(tender.method)}</td><td>${escapeHtml(tender.reference ?? '')}</td><td class="tender-amount">${escapeHtml(formatReceiptAmount(tender.amount, data.locale))}</td></tr>`;
    })
    .join('');
  const change =
    block.showChange && data.sale.changeDue && data.sale.changeDue > 0
      ? `<tr class="change-row"><td>${escapeHtml(labels.tendersTable.change)}</td><td></td><td class="tender-amount">${escapeHtml(formatReceiptAmount(data.sale.changeDue, data.locale))}</td></tr>`
      : '';
  return `<div class="block block-tenders"><table><thead><tr><th>${escapeHtml(labels.tendersTable.method)}</th><th>${escapeHtml(labels.tendersTable.reference)}</th><th class="tender-amount">${escapeHtml(labels.tendersTable.amount)}</th></tr></thead><tbody>${rows}${change}</tbody></table></div>`;
}

/**
 * Defense-in-depth URL scheme rejection. The Zod schema in
 * `trpc/schemas/receiptTemplates.ts` already rejects literal
 * `javascript:` / `data:` / `vbscript:` / `file:` schemes in
 * `qr.source` and `barcode128.source`, but a layout that uses a
 * variable substitution like `{{fiscal.qrUrl}}` evades that check
 * because the literal portion is empty at validation time. Re-running
 * the check on the *resolved* string here closes that loophole: even
 * if upstream tenant data is ever corrupted to inject a hostile URL
 * scheme, the renderer collapses it to an empty string before the
 * value reaches a phone scanner.
 */
const RESOLVED_URL_SCHEME_BLOCKLIST = /^(javascript|data|vbscript|file):/i;

function safeResolvedScannerSource(template: string, data: RenderData): string {
  const resolved = resolvePlain(template, data);
  if (RESOLVED_URL_SCHEME_BLOCKLIST.test(resolved.trim())) {
    return '';
  }
  return resolved;
}

function renderQrBlockHtml(
  block: Extract<ReceiptBlock, { type: 'qr' }>,
  data: RenderData
): string {
  // We do not generate the QR PNG inline (would require a node lib +
  // bytes embedding); we render a stable placeholder marker that the
  // print handler can swap for a real QR via `<canvas>` at print time.
  // Storing the resolved value in a `data-qr-source` attribute (already
  // escaped) lets the print preview see exactly what will be encoded.
  const resolved = safeResolvedScannerSource(block.source, data);
  const safeSource = escapeHtml(resolved);
  const sizeStyle = block.sizeMm
    ? ` style="width: ${block.sizeMm}mm; height: ${block.sizeMm}mm;"`
    : '';
  return `<div class="block block-qr"><div class="qr-placeholder" data-qr-source="${safeSource}"${sizeStyle}>${safeSource ? '[QR]' : ''}</div></div>`;
}

function renderSeparatorBlockHtml(
  block: Extract<ReceiptBlock, { type: 'separator' }>
): string {
  const char = block.char ?? '-';
  // Repeat enough times to span typical thermal width without
  // overflowing letter paper — pick 32 as a sensible default.
  const repeated = char.repeat(32);
  return `<div class="block block-separator">${escapeHtml(repeated)}</div>`;
}

function renderBarcode128BlockHtml(
  block: Extract<ReceiptBlock, { type: 'barcode128' }>,
  data: RenderData
): string {
  // Code 128 can encode arbitrary ASCII; the same defense-in-depth
  // applies as for QR (a phone barcode app could auto-open a URL).
  const resolved = safeResolvedScannerSource(block.source, data);
  const safeSource = escapeHtml(resolved);
  const heightStyle = block.heightMm
    ? ` style="height: ${block.heightMm}mm;"`
    : '';
  return `<div class="block block-barcode"><div class="barcode-placeholder" data-barcode-source="${safeSource}"${heightStyle}>${safeSource}</div></div>`;
}

function renderBlockHtml(
  block: ReceiptBlock,
  data: RenderData,
  labels: ReceiptRenderLabels
): string {
  switch (block.type) {
    case 'text':
      return renderTextBlockHtml(block, data);
    case 'logo':
      return renderLogoBlockHtml(block, data);
    case 'itemsTable':
      return renderItemsTableHtml(block, data, labels);
    case 'totalsBlock':
      return renderTotalsBlockHtml(block, data, labels);
    case 'tendersTable':
      return renderTendersTableHtml(block, data, labels);
    case 'qr':
      return renderQrBlockHtml(block, data);
    case 'separator':
      return renderSeparatorBlockHtml(block);
    case 'barcode128':
      return renderBarcode128BlockHtml(block, data);
    default: {
      // Exhaustiveness check — TypeScript will flag if a block type is
      // added without a renderer.
      const _exhaustive: never = block;
      void _exhaustive;
      return '';
    }
  }
}

function buildHtmlDocument(
  layout: ReceiptLayout,
  body: string,
  documentTitle: string
): string {
  const widthPx = PAPER_WIDTH_PX[layout.paperWidth] ?? 300;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(documentTitle)}</title><style>
  body{margin:0;padding:8px;font-family:'Courier New',monospace;font-size:11px;color:#000;background:#fff;width:${widthPx}px;}
  .block{margin-bottom:4px;}
  .align-left{text-align:left;}.align-center{text-align:center;}.align-right{text-align:right;}
  .style-title{font-size:14px;font-weight:bold;}
  .style-subtitle{font-size:12px;font-weight:bold;}
  .style-muted{color:#666;}
  .style-monospace{font-family:'Courier New',monospace;}
  .bold{font-weight:bold;}
  table{width:100%;border-collapse:collapse;}
  td,th{padding:2px 0;vertical-align:top;}
  .col-qty,.col-unitPrice,.col-taxPercent,.col-discount,.col-total,.totals-value,.tender-amount{text-align:right;}
  .block-totals td{padding-top:1px;padding-bottom:1px;}
  .block-separator{font-family:monospace;letter-spacing:0;}
  .qr-placeholder,.barcode-placeholder{display:inline-block;border:1px dashed #999;padding:4px;font-family:monospace;font-size:10px;}
  .block-logo img{max-width:100%;}
  .block-logo-empty{min-height:8px;}
  @media print{body{padding:0;}}
</style></head><body>${body}</body></html>`;
}

// ---------------------------------------------------------------------------
// ESC/POS rendering
// ---------------------------------------------------------------------------

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

function bytesFromString(value: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    out.push(code < 128 ? code : 0x3f); // non-ASCII collapses to '?'
  }
  return out;
}

function escposAlign(align: string | undefined): number[] {
  // ESC a n — 0=left, 1=center, 2=right
  const n = align === 'center' ? 1 : align === 'right' ? 2 : 0;
  return [ESC, 0x61, n];
}

function escposBoldOn(): number[] {
  return [ESC, 0x45, 0x01];
}
function escposBoldOff(): number[] {
  return [ESC, 0x45, 0x00];
}
function escposCut(): number[] {
  return [GS, 0x56, 0x00];
}
function escposLine(): number[] {
  return [LF];
}

function renderBlockEscPos(
  block: ReceiptBlock,
  data: RenderData,
  paperWidthChars: number,
  labels: ReceiptRenderLabels
): number[] {
  switch (block.type) {
    case 'text': {
      const text = resolvePlain(block.value, data);
      const out: number[] = [];
      out.push(...escposAlign(block.align));
      const bold = block.bold || block.style === 'title' || block.style === 'subtitle';
      if (bold) out.push(...escposBoldOn());
      out.push(...bytesFromString(text));
      if (bold) out.push(...escposBoldOff());
      out.push(...escposLine());
      return out;
    }
    case 'logo': {
      // Logo emission requires raster mode bytes the upstream driver in
      // Iter 4 will supply (the renderer cannot decode the PNG without
      // a binary dependency). For now the logo space prints a blank
      // line so the layout cadence matches HTML preview.
      return [...escposLine()];
    }
    case 'itemsTable': {
      const out: number[] = [];
      out.push(...escposAlign('left'));
      for (const item of data.sale.items) {
        const namePiece = item.name.padEnd(Math.max(0, paperWidthChars - 16)).slice(0, paperWidthChars - 16);
        const qtyPiece = formatNumber(item.qty).padStart(6);
        const totalPiece = formatReceiptAmount(item.total, data.locale).padStart(10);
        out.push(...bytesFromString(`${namePiece}${qtyPiece}${totalPiece}`));
        out.push(...escposLine());
      }
      return out;
    }
    case 'totalsBlock': {
      const out: number[] = [];
      out.push(...escposAlign('right'));
      for (const line of block.show) {
        const label = totalsLabel(line, labels);
        const value = formatReceiptAmount(totalsValue(line, data), data.locale);
        const padded = `${label}: ${value}`;
        out.push(...bytesFromString(padded));
        out.push(...escposLine());
      }
      return out;
    }
    case 'tendersTable': {
      const out: number[] = [];
      out.push(...escposAlign('left'));
      for (const tender of data.sale.tenders) {
        out.push(
          ...bytesFromString(
            `${tender.method.padEnd(8)} ${formatReceiptAmount(tender.amount, data.locale).padStart(10)}`
          )
        );
        out.push(...escposLine());
      }
      if (block.showChange && data.sale.changeDue && data.sale.changeDue > 0) {
        out.push(
          ...bytesFromString(
            `${labels.tendersTable.change.padEnd(8)} ${formatReceiptAmount(data.sale.changeDue, data.locale).padStart(10)}`
          )
        );
        out.push(...escposLine());
      }
      return out;
    }
    case 'qr': {
      // Real QR generation is part of the EscPosPrinterAdapter (Iter 4
      // — the GS ( k command). Until then we emit a placeholder line
      // so the layout cadence is preserved. Same scheme guard as the
      // HTML branch — a hostile resolved value never reaches the
      // printed strip.
      const resolved = safeResolvedScannerSource(block.source, data);
      return [
        ...escposAlign('center'),
        ...bytesFromString(`[QR: ${resolved}]`),
        ...escposLine(),
      ];
    }
    case 'separator': {
      const char = block.char ?? '-';
      return [
        ...escposAlign('left'),
        ...bytesFromString(char.repeat(paperWidthChars)),
        ...escposLine(),
      ];
    }
    case 'barcode128': {
      const resolved = safeResolvedScannerSource(block.source, data);
      return [
        ...escposAlign('center'),
        ...bytesFromString(`[BC: ${resolved}]`),
        ...escposLine(),
      ];
    }
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return [];
    }
  }
}

function paperWidthCharsFor(width: ReceiptLayout['paperWidth']): number {
  switch (width) {
    case '58mm':
      return 32;
    case '80mm':
      return 48;
    case 'letter':
    case 'a4':
      return 80;
    default:
      return 48;
  }
}

// ---------------------------------------------------------------------------
// Public renderer API
// ---------------------------------------------------------------------------

export interface RenderResult {
  html: string;
  escpos: Uint8Array;
}

export function renderReceipt(
  layout: ReceiptLayout,
  data: RenderData,
  labels: ReceiptRenderLabels = DEFAULT_RECEIPT_RENDER_LABELS
): RenderResult {
  const htmlBody = layout.blocks
    .map(block => renderBlockHtml(block, data, labels))
    .join('\n');
  const html = buildHtmlDocument(layout, htmlBody, labels.documentTitle);

  const widthChars = paperWidthCharsFor(layout.paperWidth);
  const escposBytes: number[] = [];
  // Initialize printer (ESC @)
  escposBytes.push(ESC, 0x40);
  for (const block of layout.blocks) {
    escposBytes.push(...renderBlockEscPos(block, data, widthChars, labels));
  }
  // Feed a few lines and cut
  escposBytes.push(LF, LF, LF, ...escposCut());
  return {
    html,
    escpos: Uint8Array.from(escposBytes),
  };
}

// ---------------------------------------------------------------------------
// Preview data builder
// ---------------------------------------------------------------------------

/**
 * Synthesize a deterministic mock dataset so the editor preview is
 * stable across reloads. The shape matches `RenderData` exactly so the
 * preview path uses the same renderer code path as production.
 */
export function buildPreviewData(_kind: ReceiptTemplateKind): RenderData {
  return {
    company: {
      name: 'Mi Tienda S.A.S.',
      taxId: '900.123.456-7',
      address: 'Cra 7 # 12-34',
      phone: '+57 320 555 1234',
      email: 'contacto@mitienda.co',
      city: 'Bogotá',
    },
    sale: {
      saleNumber: 'V-000123',
      cashier: 'Ana López',
      site: 'Sede Centro',
      customer: 'Juan Pérez',
      customerTaxId: '1.020.456.789',
      createdAt: new Date('2026-04-22T15:30:00-05:00').toISOString(),
      subtotal: 84034,
      discount: 5000,
      taxTotal: 14966,
      tip: 0,
      grandTotal: 94000,
      changeDue: 6000,
      notes: 'Gracias por su compra',
      items: [
        {
          name: 'Café 250g',
          sku: 'CAF-250',
          qty: 2,
          unitPrice: 22000,
          taxPercent: 19,
          discount: 0,
          total: 44000,
        },
        {
          name: 'Pan artesanal',
          sku: 'PAN-A',
          qty: 3,
          unitPrice: 8500,
          taxPercent: 5,
          discount: 1000,
          total: 24500,
        },
        {
          name: 'Empanada de carne',
          sku: 'EMP-CAR',
          qty: 5,
          unitPrice: 3500,
          taxPercent: 8,
          discount: 0,
          total: 17500,
        },
        {
          name: 'Botellón de agua',
          sku: 'AGU-20L',
          qty: 1,
          unitPrice: 8000,
          taxPercent: 0,
          discount: 0,
          total: 8000,
        },
      ],
      tenders: [
        { method: 'cash', amount: 60000, reference: null },
        { method: 'card', amount: 40000, reference: 'AUTH-887766' },
      ],
    },
    fiscal: {
      cufe: 'a1b2c3d4e5f6'.repeat(8),
      qrUrl: 'https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=a1b2c3d4e5f6',
      resolution: 'DIAN 18764000001 — 2024',
      documentNumber: 'FE-V-000123',
    },
    logoDataUrl: null,
  };
}
