/**
 * Customer-facing plain-text receipt renderer.
 *
 * The output follows the same immutable layout, labels, and render data used
 * by HTML and ESC/POS. It intentionally has no access to sale costs, margins,
 * audit events, recovery state, or any other operator-only record.
 */
import type { ReceiptBlock, ReceiptLayout } from '../../trpc/schemas/receiptTemplates.js';
import { APP_FOOTER_METADATA, WORDMARK_TAGLINE } from './labels.js';
import { resolvePlain } from './escape-resolve.js';
import {
  formatItemCell,
  formatReceiptAmount,
  itemColumnLabel,
  tenderMethodLabel,
  totalsLabel,
  totalsValue,
} from './format-helpers.js';
import { safeResolvedScannerSource } from './scanner-urls.js';
import type { ReceiptRenderLabels, RenderData } from './types.js';

function renderFiscalEvidenceText(data: RenderData): string[] {
  const documents = data.fiscalDocuments ?? (data.fiscal ? [data.fiscal] : []);
  return documents.flatMap(document => {
    const labels = document.evidenceLabels ?? {
      document: 'Document',
      status: 'Status',
      maturity: 'Maturity',
      resolution: 'Resolution',
      identifier: 'Fiscal identifier',
    };
    return [
      '------------------------',
      document.documentNumber ? `${labels.document}: ${document.documentNumber}` : '',
      document.statusLabel ? `${labels.status}: ${document.statusLabel}` : '',
      document.maturityLabel ? `${labels.maturity}: ${document.maturityLabel}` : '',
      document.resolution ? `${labels.resolution}: ${document.resolution}` : '',
      document.cufe ? `${labels.identifier}: ${document.cufe}` : '',
      document.nonCertifiedNotice ?? '',
    ].filter(Boolean);
  });
}

function renderBlockText(
  block: ReceiptBlock,
  data: RenderData,
  labels: ReceiptRenderLabels
): string[] {
  switch (block.type) {
    case 'text':
      return [resolvePlain(block.value, data)];
    case 'logo':
      return [];
    case 'itemsTable': {
      const header =
        block.showHeader === false
          ? []
          : [block.columns.map(column => itemColumnLabel(column, labels)).join(' | ')];
      const rows = data.sale.items.map(item =>
        block.columns.map(column => formatItemCell(column, item, data.locale)).join(' | ')
      );
      return [...header, ...rows];
    }
    case 'totalsBlock':
      return block.show.map(
        line =>
          `${totalsLabel(line, labels)}: ${formatReceiptAmount(totalsValue(line, data), data.locale)}`
      );
    case 'tendersTable': {
      const rows = data.sale.tenders.map(tender =>
        [
          tenderMethodLabel(tender.method, labels),
          tender.reference ?? '',
          formatReceiptAmount(tender.amount, data.locale),
        ]
          .filter(Boolean)
          .join(' | ')
      );
      if (block.showChange && data.sale.changeDue && data.sale.changeDue > 0) {
        rows.push(
          `${labels.tendersTable.change}: ${formatReceiptAmount(data.sale.changeDue, data.locale)}`
        );
      }
      return rows;
    }
    case 'qr':
    case 'barcode128': {
      const source = safeResolvedScannerSource(block.source, data);
      return source ? [source] : [];
    }
    case 'separator':
      return [(block.char ?? '-').repeat(32)];
    case 'appFooter':
      return block.show === false
        ? []
        : [APP_FOOTER_METADATA.appName, APP_FOOTER_METADATA.appUrl, APP_FOOTER_METADATA.appSupport];
    case 'wordmark':
      return block.show === false
        ? []
        : [APP_FOOTER_METADATA.appName.toLowerCase(), WORDMARK_TAGLINE];
    case 'metaTable':
      return block.rows.flatMap(row => {
        const value = resolvePlain(row.value, data);
        return value ? [`${resolvePlain(row.key, data)}: ${value}`] : [];
      });
    default: {
      const _exhaustive: never = block;
      void _exhaustive;
      return [];
    }
  }
}

export function renderReceiptPlainText(
  layout: ReceiptLayout,
  data: RenderData,
  labels: ReceiptRenderLabels
): string {
  return [
    ...layout.blocks.flatMap(block => renderBlockText(block, data, labels)),
    ...renderFiscalEvidenceText(data),
  ]
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}
