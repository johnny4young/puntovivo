// fiscal proof section of the sale receipt ( slice 29).

import i18next from 'i18next';
import type { TFunction } from 'i18next';
import type { FiscalDocumentStatus } from '@/components/fiscal/FiscalStatusBadge';
import { escapeHtml } from './escape';
import type { ReceiptFiscalDocument } from './types';

function isPlaceholderCufe(cufe: string | null | undefined): boolean {
  if (!cufe) return true;
  return cufe.startsWith('pending-');
}

/**
 * Mirrors `qr-builder.ts::QR_ELIGIBLE_STATUSES`. The CUFE is rendered in
 * full ONLY when the document is in a status the provider has acknowledged
 * (`accepted` or `sent`) AND the cufe is no longer the placeholder. Other
 * statuses (`pending` / `contingency` / `rejected`) render the status copy
 * after the CUFE label so the receipt never claims acceptance based on a
 * placeholder string.
 */
const CUFE_ELIGIBLE_STATUSES: ReadonlySet<FiscalDocumentStatus> = new Set(['accepted', 'sent']);

function normalizeFiscalCountryCode(countryCode: string): string {
  return countryCode.toUpperCase();
}

function getFiscalAuthorityLabel(t: TFunction, countryCode: string): string {
  const normalized = normalizeFiscalCountryCode(countryCode);
  return t(`receipts:fiscal.authority.${normalized}`, {
    defaultValue: normalized,
  });
}

function getFiscalIdentifierLabelKey(countryCode: string): string {
  switch (normalizeFiscalCountryCode(countryCode)) {
    case 'MX':
      return 'receipts:fiscal.uuidLabel';
    case 'CL':
      return 'receipts:fiscal.tedLabel';
    default:
      return 'receipts:fiscal.cufeLabel';
  }
}

/**
 * Render the fiscal proof block(s) for a receipt.
 *
 * Always prints document number + kind + status copy. Conditionally
 * prints the full CUFE (only when status='accepted' AND the cufe is
 * not the `pending-<nanoid>` placeholder; otherwise prints `(<status
 * label>)`). Conditionally prints a QR PNG (only when `qrPayload`
 * is non-null — the server's `buildFiscalQrPayload` already gates
 * on status + placeholder).
 *
 * The QR PNG is generated via dynamic-imported `qrcode` so the
 * library never lands in the main app bundle — only loaded when
 * a fiscal sale is actually being printed.
 *
 * Status copy is the SINGLE SOURCE OF TRUTH for the fiscal section.
 * The receipt never infers "Aceptado" from CUFE presence — a
 * contingency document always says "Contingencia" prominently.
 */
export async function buildFiscalSection(docs: ReceiptFiscalDocument[]): Promise<string> {
  if (!docs.length) return '';

  // `receipts` + `fiscal` are lazy namespaces; ensure they are
  // loaded before `getFixedT` reads them so a receipt printed from a screen
  // that never mounted them (e.g. straight after a sale) renders real copy
  // instead of raw keys.
  await i18next.loadNamespaces(['receipts', 'fiscal']);
  const t = i18next.getFixedT(null, ['receipts', 'fiscal']);

  // Lazy-load qrcode only when we need at least one QR.
  const someNeedsQr = docs.some(d => d.qrPayload != null);
  let toDataURL: ((text: string, options?: object) => Promise<string>) | null = null;
  if (someNeedsQr) {
    const qrcodeMod = await import('qrcode');
    toDataURL = qrcodeMod.toDataURL;
  }

  const blocks: string[] = [];
  for (const doc of docs) {
    const statusLabel = t(`fiscal:status.${doc.status}`);
    const kindLabel = t(`fiscal:kind.${doc.kind}`, { defaultValue: doc.kind });
    const sourceLabel = t(`receipts:fiscal.source.${doc.source}`);
    const authorityLabel = getFiscalAuthorityLabel(t, doc.countryCode);
    const showRealCufe = CUFE_ELIGIBLE_STATUSES.has(doc.status) && !isPlaceholderCufe(doc.cufe);
    const cufeText = showRealCufe ? doc.cufe : `(${statusLabel})`;

    let qrImg = '';
    if (doc.qrPayload && toDataURL) {
      try {
        const dataUrl = await toDataURL(doc.qrPayload, {
          errorCorrectionLevel: 'M',
          margin: 1,
          scale: 6,
        });
        qrImg = `<img class="receipt-fiscal-qr" src="${dataUrl}" alt="${escapeHtml(
          t('receipts:fiscal.qrCaption', { authority: authorityLabel })
        )}" />`;
      } catch {
        // Encoding failure must NEVER block the print. Fall back to no QR;
        // the status copy + document number stay rendered.
        qrImg = '';
      }
    }

    blocks.push(`
      <section class="receipt-fiscal">
        <div class="section-label">${escapeHtml(t('receipts:fiscal.sectionTitle'))}</div>
        <div class="meta-grid">
          <div class="meta-row">
            <span class="muted">${escapeHtml(t('receipts:fiscal.kindLabel'))}</span>
            <span>${escapeHtml(kindLabel)}</span>
          </div>
          <div class="meta-row">
            <span class="muted">${escapeHtml(t('receipts:fiscal.documentNumber'))}</span>
            <span>${escapeHtml(doc.documentNumber)}</span>
          </div>
          <div class="meta-row">
            <span class="muted">${escapeHtml(t('receipts:fiscal.statusLabel'))}</span>
            <span class="receipt-fiscal-status">${escapeHtml(statusLabel)}</span>
          </div>
          <div class="meta-row receipt-fiscal-cufe-row">
            <span class="muted">${escapeHtml(t(getFiscalIdentifierLabelKey(doc.countryCode)))}</span>
            <span class="receipt-fiscal-cufe">${escapeHtml(cufeText)}</span>
          </div>
          <div class="meta-row receipt-fiscal-source-row">
            <span class="muted">${escapeHtml(t('receipts:fiscal.sourceLabel'))}</span>
            <span>${escapeHtml(sourceLabel)}</span>
          </div>
        </div>
        ${qrImg}
      </section>
    `);
  }

  return blocks.join('\n');
}
