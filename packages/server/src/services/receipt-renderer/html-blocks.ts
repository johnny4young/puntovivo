/**
 * Receipt renderer HTML block renderers + document builder.
 *
 * extracted verbatim from the former single-file
 * `services/receipt-renderer.ts`. The per-block `render*BlockHtml` functions
 * stay module-private (only `renderBlockHtml` dispatches to them); the
 * dispatcher + `buildHtmlDocument` are exported for the orchestrator.
 * thermal CSS,  logo re-escape, and  QR fallback move byte-for-byte.
 *
 * @module services/receipt-renderer/html-blocks
 */
import type { ReceiptBlock, ReceiptLayout } from '../../trpc/schemas/receiptTemplates.js';
import { PRINT_TOKENS } from '../print-tokens.js';
import { encodeQrSvg } from '../qr-encoder.js';
import type { ReceiptRenderLabels, RenderData } from './types.js';
import { APP_FOOTER_METADATA, WORDMARK_TAGLINE } from './labels.js';
import { escapeHtml, resolveAndEscape } from './escape-resolve.js';
import {
  PAPER_WIDTH_PX,
  alignClass,
  formatItemCell,
  formatReceiptAmount,
  itemColumnLabel,
  totalsLabel,
  totalsValue,
} from './format-helpers.js';
import {
  QR_DEFAULT_PIXEL_SIZE,
  QR_MM_TO_PX,
  QR_MODULE_SPANS,
  safeResolvedScannerSource,
} from './scanner-urls.js';

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
  const heightStyle = block.maxHeightMm ? ` style="max-height: ${block.maxHeightMm}mm;"` : '';
  // vector 3 — defense in depth on top of the Zod
  // `imageUrl` refine in `trpc/schemas/logos.ts`. The data URL is
  // tenant-controlled but still ends up inside an attribute value
  // loaded by `printWindow.loadURL('data:text/html;...')`; escape it
  // so a malformed entry (or a value that bypassed validation in a
  // future code path) cannot break out of the `src=""` quotes.
  return `<div class="block block-logo ${alignClass(block.align)}"><img src="${escapeHtml(data.logoDataUrl)}" alt=""${heightStyle} /></div>`;
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

function renderTotalsBlockHtml(
  block: Extract<ReceiptBlock, { type: 'totalsBlock' }>,
  data: RenderData,
  labels: ReceiptRenderLabels
): string {
  const rows = block.show
    .map(line => {
      const label = totalsLabel(line, labels);
      const value = totalsValue(line, data);
      // flag the grand-total row so the thermal CSS can apply
      // the 1pt black top/bottom border + 14pt weight from the
      // design-system thermal preview rules.
      const rowClass = line === 'grandTotal' ? ' class="grand-total"' : '';
      return `<tr${rowClass}><td class="totals-label">${escapeHtml(label)}</td><td class="totals-value">${escapeHtml(formatReceiptAmount(value, data.locale))}</td></tr>`;
    })
    .join('');
  return `<div class="block block-totals"><table><tbody>${rows}</tbody></table></div>`;
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

function renderQrBlockHtml(block: Extract<ReceiptBlock, { type: 'qr' }>, data: RenderData): string {
  // emit a real inline SVG QR when the resolved source is
  // present; fall back to the  CSS placeholder when the source
  // is empty (no fiscal data yet) or the encoder rejects the payload
  // (too long for the chosen EC level). The placeholder keeps the
  // editor preview footprint stable so designers see a consistent
  // silhouette regardless of which path lands.
  const resolved = safeResolvedScannerSource(block.source, data);
  const safeSource = escapeHtml(resolved);
  const sizeStyle = block.sizeMm
    ? ` style="width: ${block.sizeMm}mm; height: ${block.sizeMm}mm;"`
    : '';
  if (!safeSource) {
    return `<div class="block block-qr"><div class="qr-placeholder qr-placeholder-empty" data-qr-source=""${sizeStyle}></div></div>`;
  }
  const pixelSize = block.sizeMm ? Math.round(block.sizeMm * QR_MM_TO_PX) : QR_DEFAULT_PIXEL_SIZE;
  const svg = encodeQrSvg(resolved, { pixelSize });
  if (!svg) {
    // Encoder rejected (payload too large or invalid); keep the
    // receipt printable with the  silhouette.
    return `<div class="block block-qr"><div class="qr-placeholder" data-qr-source="${safeSource}"${sizeStyle}>${QR_MODULE_SPANS}<span class="qr-finder qr-finder-tl"></span><span class="qr-finder qr-finder-tr"></span><span class="qr-finder qr-finder-bl"></span></div></div>`;
  }
  return `<div class="block block-qr"><div class="qr-svg" data-qr-source="${safeSource}"${sizeStyle}>${svg}</div></div>`;
}

function renderSeparatorBlockHtml(block: Extract<ReceiptBlock, { type: 'separator' }>): string {
  const char = block.char ?? '-';
  // Repeat enough times to span typical thermal width without
  // overflowing letter paper — pick 32 as a sensible default.
  const repeated = char.repeat(32);
  return `<div class="block block-separator">${escapeHtml(repeated)}</div>`;
}

/**
 * pass 1 (item #5) — HTML renderer for the Puntovivo-branded
 * footer block. Outputs three lines (name+version, URL, support contact)
 * from `APP_FOOTER_METADATA`. `show: false` collapses the block to an
 * empty string so admins can toggle the branding off without removing
 * the block.
 */
function renderAppFooterBlockHtml(block: Extract<ReceiptBlock, { type: 'appFooter' }>): string {
  if (block.show === false) return '';
  const align = alignClass(block.align ?? 'center');
  const { appName, appVersion, appUrl, appSupport } = APP_FOOTER_METADATA;
  const line1 = escapeHtml(`${appName} ${appVersion}`);
  const line2 = escapeHtml(appUrl);
  const line3 = escapeHtml(appSupport);
  return `<div class="block block-app-footer ${align}"><div>${line1}</div><div>${line2}</div><div>${line3}</div></div>`;
}

/**
 * HTML renderer for the canonical `puntovivo·` wordmark.
 *
 * Emits a sans-serif lockup with regular `punto` + bold `vivo` + a
 * square dot, sized to fit the active paper, followed by the handoff
 * tagline. Layout keeps the wordmark itself on one line with
 * `text-transform: lowercase` so the brand reads consistently
 * regardless of the source CSS the editor preview overrides. `show`
 * defaults to `true`; `show: false` collapses the block.
 */
function renderWordmarkBlockHtml(block: Extract<ReceiptBlock, { type: 'wordmark' }>): string {
  if (block.show === false) return '';
  const align = alignClass(block.align ?? 'center');
  return `<div class="block block-wordmark ${align}"><div class="wordmark">punto<b>vivo</b><span class="wordmark-dot"></span></div><div class="wordmark-tagline">${WORDMARK_TAGLINE}</div></div>`;
}

/**
 * HTML renderer for the 2-column key/value meta band.
 *
 * Each row renders as `<dt>` + `<dd>` inside a `<dl>`. The bound CSS
 * grids the pair so the value column lines up flush right and keeps
 * `tabular-nums`. Rows whose value resolves to an empty string after
 * interpolation are dropped to avoid blank `| |` lines on the printed
 * strip.
 */
function renderMetaTableBlockHtml(
  block: Extract<ReceiptBlock, { type: 'metaTable' }>,
  data: RenderData
): string {
  const rows = block.rows
    .map(row => {
      const resolvedValue = resolveAndEscape(row.value, data);
      if (!resolvedValue) return '';
      const resolvedKey = resolveAndEscape(row.key, data);
      return `<dt class="meta-key">${resolvedKey}</dt><dd class="meta-value">${resolvedValue}</dd>`;
    })
    .filter(Boolean)
    .join('');
  if (!rows) return '';
  return `<div class="block block-meta"><dl class="meta-grid">${rows}</dl></div>`;
}

function renderBarcode128BlockHtml(
  block: Extract<ReceiptBlock, { type: 'barcode128' }>,
  data: RenderData
): string {
  // Code 128 can encode arbitrary ASCII; the same defense-in-depth
  // applies as for QR (a phone barcode app could auto-open a URL).
  const resolved = safeResolvedScannerSource(block.source, data);
  const safeSource = escapeHtml(resolved);
  const heightStyle = block.heightMm ? ` style="height: ${block.heightMm}mm;"` : '';
  return `<div class="block block-barcode"><div class="barcode-placeholder" data-barcode-source="${safeSource}"${heightStyle}>${safeSource}</div></div>`;
}

export function renderBlockHtml(
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
    case 'appFooter':
      return renderAppFooterBlockHtml(block);
    case 'wordmark':
      return renderWordmarkBlockHtml(block);
    case 'metaTable':
      return renderMetaTableBlockHtml(block, data);
    default: {
      // Exhaustiveness check — TypeScript will flag if a block type is
      // added without a renderer.
      const _exhaustive: never = block;
      void _exhaustive;
      return '';
    }
  }
}

export function buildHtmlDocument(
  layout: ReceiptLayout,
  body: string,
  documentTitle: string
): string {
  const widthPx = PAPER_WIDTH_PX[layout.paperWidth] ?? 300;
  const is80mm = layout.paperWidth === '80mm';
  // adopt the design-system thermal preview rules
  // (`preview/25-print-thermal.html` from the print specification):
  // * 1-bit only: pure #000 on #fff, no grays, no gradients.
  // * Monospace everywhere; tabular-nums on every numeric column so
  // amounts line up under poor ESC/POS rendering.
  // * Body 11pt, grand total 14pt, min 10pt label size.
  // * Grand-total row gets a thick black top + bottom border so it
  // reads as the dominant value when scanning the strip quickly.
  // Tokens come from `PRINT_TOKENS` (mirrors `apps/web/src/styles/theme.css`
  // `--print-*` properties); update both surfaces together.
  const mono = PRINT_TOKENS.monoFace;
  const brand = PRINT_TOKENS.brandFace;
  const dotSize = is80mm ? '8px' : '6px';
  const wordmarkSize = is80mm ? '28px' : '22px';
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" /><title>${escapeHtml(documentTitle)}</title><style>
  body{margin:0;padding:8px;font-family:${mono};font-size:${PRINT_TOKENS.bodySize};line-height:1.35;color:${PRINT_TOKENS.ink};background:${PRINT_TOKENS.paper};width:${widthPx}px;font-variant-numeric:tabular-nums;}
  .block{margin-bottom:6px;}
  .align-left{text-align:left;}.align-center{text-align:center;}.align-right{text-align:right;}
  .style-title{font-size:13pt;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;}
  .style-subtitle{font-size:${PRINT_TOKENS.bodySize};font-weight:700;}
  .style-muted{color:${PRINT_TOKENS.ink};font-size:${PRINT_TOKENS.minSize};}
  .style-monospace{font-family:${mono};}
  .bold{font-weight:700;}
  table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;}
  td,th{padding:2px 0;vertical-align:top;}
  .col-qty,.col-unitPrice,.col-taxPercent,.col-discount,.col-total,.totals-value,.tender-amount{text-align:right;font-variant-numeric:tabular-nums;}
  .block-totals td{padding-top:1px;padding-bottom:1px;}
  .block-totals tr.grand-total td{border-top:1px solid ${PRINT_TOKENS.ink};border-bottom:1px solid ${PRINT_TOKENS.ink};font-size:${PRINT_TOKENS.totalSize};font-weight:700;padding-top:4px;padding-bottom:4px;letter-spacing:0.02em;}
  .block-separator{font-family:${mono};letter-spacing:0;}
  .qr-svg{display:inline-block;line-height:0;background:${PRINT_TOKENS.paper};color:${PRINT_TOKENS.ink};}
  .qr-svg svg{width:100%;height:100%;display:block;shape-rendering:crispEdges;}
  .qr-placeholder{display:inline-block;position:relative;width:78px;height:78px;border:4px solid ${PRINT_TOKENS.paper};outline:1px solid ${PRINT_TOKENS.ink};background:${PRINT_TOKENS.paper};}
  .qr-placeholder-empty{background:${PRINT_TOKENS.paper};}
  .qr-module{position:absolute;width:6px;height:6px;background:${PRINT_TOKENS.ink};}
  .qr-finder{position:absolute;width:18px;height:18px;background:${PRINT_TOKENS.paper};border:4px solid ${PRINT_TOKENS.ink};box-sizing:border-box;}
  .qr-finder-tl{top:4px;left:4px;}
  .qr-finder-tr{top:4px;right:4px;}
  .qr-finder-bl{bottom:4px;left:4px;}
  .barcode-placeholder{display:inline-block;border:1px dashed ${PRINT_TOKENS.ink};padding:4px;font-family:${mono};font-size:${PRINT_TOKENS.minSize};}
  .block-logo img{max-width:100%;image-rendering:pixelated;}
  .block-logo-empty{min-height:8px;}
  .block-wordmark{padding-bottom:8px;border-bottom:1px solid ${PRINT_TOKENS.ink};margin-bottom:8px;}
  .wordmark{font-family:${brand};font-weight:400;font-size:${wordmarkSize};letter-spacing:0;text-transform:lowercase;line-height:1;display:inline-block;}
  .wordmark b{font-weight:700;}
  .wordmark-dot{display:inline-block;width:${dotSize};height:${dotSize};background:${PRINT_TOKENS.ink};margin-left:4px;vertical-align:middle;}
  .wordmark-tagline{font-family:${brand};font-size:${PRINT_TOKENS.minSize};font-weight:700;letter-spacing:0;margin-top:4px;}
  .block-meta .meta-grid{display:grid;grid-template-columns:auto 1fr;column-gap:8px;row-gap:2px;margin:0;font-size:${PRINT_TOKENS.minSize};}
  .block-meta .meta-key{font-weight:700;}
  .block-meta .meta-value{margin:0;text-align:right;font-variant-numeric:tabular-nums;}
  @media print{body{padding:0;}}
</style></head><body>${body}</body></html>`;
}
