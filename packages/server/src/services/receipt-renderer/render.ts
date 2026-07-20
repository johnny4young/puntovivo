/**
 * Receipt renderer public orchestrator.
 *
 * extracted verbatim from the former single-file
 * `services/receipt-renderer.ts`. `renderReceipt` maps the layout blocks
 * through the HTML + ESC/POS renderers and wraps the HTML document;
 * `buildPreviewData` synthesizes the deterministic editor-preview dataset.
 * Re-exported by the barrel under the same names the two importers use.
 *
 * @module services/receipt-renderer/render
 */
import type { ReceiptLayout } from '../../trpc/schemas/receiptTemplates.js';
import type { ReceiptTemplateKind } from '../../db/schema.js';
import type { ReceiptRenderLabels, RenderData, RenderResult } from './types.js';
import { DEFAULT_RECEIPT_RENDER_LABELS } from './labels.js';
import { buildHtmlDocument, renderBlockHtml } from './html-blocks.js';
import { ESC, LF, escposCut, paperWidthCharsFor, renderBlockEscPos } from './escpos.js';

export function renderReceipt(
  layout: ReceiptLayout,
  data: RenderData,
  labels: ReceiptRenderLabels = DEFAULT_RECEIPT_RENDER_LABELS
): RenderResult {
  const htmlBody = layout.blocks.map(block => renderBlockHtml(block, data, labels)).join('\n');
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
      city: null,
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
      // non-zero preview tip so template designers can
      // visualise how the line renders. The runtime renderer pulls
      // the real tip from `sales.tip_amount`.
      tip: 5000,
      // non-zero preview service charge mirrors the tip
      // pattern. Real values come from `sales.service_charge_amount` +
      // `service_charge_rate`. 8403 ≈ 10% of subtotal 84034 keeps the
      // preview math self-consistent.
      serviceCharge: 8403,
      serviceChargeRate: 10,
      grandTotal: 107403,
      changeDue: 1000,
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
