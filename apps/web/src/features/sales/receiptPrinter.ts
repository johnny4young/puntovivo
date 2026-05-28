import i18next from 'i18next';
import type { TFunction } from 'i18next';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { getRuntimeConfigSync } from '@/lib/runtimeConfigClient';
import type {
  PaymentStatus,
  PaymentMethod,
  SaleItem,
  SalePayment,
  SaleStatus,
} from '@/types';
import type { FiscalDocumentStatus } from '@/components/fiscal/FiscalStatusBadge';
import type { LocalEscPosTransportHint } from '@/types/electron';

/**
 * ENG-058 — Per-fiscal-document data the receipt prints. Mirrors the
 * shape returned by `sales.getById` / `sales.getForReprint` after the
 * `getSaleRecord` widening.
 */
export interface ReceiptFiscalDocument {
  id: string;
  source: 'sale' | 'void' | 'return';
  kind: 'DEE' | 'FEV' | 'NC' | 'ND';
  cufe: string;
  documentNumber: string;
  status: FiscalDocumentStatus;
  /**
   * Country-specific QR payload string (URL for DIAN/SAT, TED for
   * SII). Null when the doc is not in an eligible status, when the
   * CUFE is still a `pending-<nanoid>` placeholder, or when the
   * country pack is not yet implemented.
   */
  qrPayload: string | null;
  xmlRef: string | null;
  resolution: string | null;
  emittedAt: string;
  countryCode: string;
}

type ReceiptSale = {
  saleNumber: string;
  customerName?: string | null;
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  total: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: SaleStatus;
  notes?: string | null;
  createdAt: string;
  items?: SaleItem[];
  // Phase 2 Tier-2 step 5 follow-on — include the tender breakdown on the
  // printed receipt when the sale was settled as a split payment.
  payments?: SalePayment[];
  /**
   * ENG-058 — fiscal proof block(s). Always rendered when present;
   * the section is omitted entirely for non-fiscal sales (DIAN-disabled
   * tenants, drafts, sales emitted before fiscal pack activation).
   */
  fiscalDocuments?: ReceiptFiscalDocument[];
};

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
const CUFE_ELIGIBLE_STATUSES: ReadonlySet<FiscalDocumentStatus> = new Set([
  'accepted',
  'sent',
]);

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

type ReceiptHtmlOptions = {
  autoPrint: boolean;
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return char;
    }
  });
}

function getItemDescription(item: SaleItem): string {
  const productLabel = item.productName ?? item.productSku ?? item.productId;
  const unitLabel = item.unitAbbreviation ?? item.unitName ?? item.unitId ?? 'unit';
  return `${productLabel} (${unitLabel})`;
}

function buildSplitPaymentSection(payments: SalePayment[] | undefined): string {
  // Only render a tender breakdown when the sale was actually split. A single
  // payment row is already fully described by the existing "Payment" meta
  // line — printing a one-row table would be noise.
  //
  // NOTE: the receipt HTML is intentionally English-only for now (mirroring
  // "Customer", "Subtotal", "VAT", "Totals", "Notes", "Items", etc. elsewhere
  // in this file). When the receipt path gets localized, translate these
  // hardcoded strings (Tenders / Method / Reference / Amount) alongside
  // everything else — the TSX side already uses `details.payments*` keys
  // from `sales.json`.
  if (!payments || payments.length <= 1) {
    return '';
  }

  const rows = payments
    .map(payment => {
      const method = escapeHtml(payment.method);
      const amount = escapeHtml(formatCurrency(payment.amount));
      const reference = escapeHtml(payment.reference?.trim() ?? '');
      return `
        <tr>
          <td class="tender-method">${method}</td>
          <td class="tender-reference">${reference || '&mdash;'}</td>
          <td class="tender-amount">${amount}</td>
        </tr>
      `;
    })
    .join('');

  return `
    <section class="tenders">
      <span class="section-label">Tenders</span>
      <table>
        <thead>
          <tr>
            <th>Method</th>
            <th>Reference</th>
            <th class="tender-amount">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>
  `;
}

function buildReceiptRows(items: SaleItem[]): string {
  return items
    .map(item => {
      const description = escapeHtml(getItemDescription(item));
      const quantity = escapeHtml(String(item.quantity));
      const unitPrice = escapeHtml(formatCurrency(item.unitPrice));
      const total = escapeHtml(formatCurrency(item.total));

      return `
        <tr>
          <td class="item-name">${description}</td>
          <td class="item-qty">${quantity}</td>
          <td class="item-price">${unitPrice}</td>
          <td class="item-total">${total}</td>
        </tr>
      `;
    })
    .join('');
}

/**
 * ENG-058 — Render the fiscal proof block(s) for a receipt.
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
async function buildFiscalSection(
  docs: ReceiptFiscalDocument[]
): Promise<string> {
  if (!docs.length) return '';

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
    const showRealCufe =
      CUFE_ELIGIBLE_STATUSES.has(doc.status) && !isPlaceholderCufe(doc.cufe);
    const cufeText = showRealCufe
      ? doc.cufe
      : `(${statusLabel})`;

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

export async function buildSaleReceiptHtml(
  sale: ReceiptSale,
  { autoPrint }: ReceiptHtmlOptions = { autoPrint: false }
): Promise<string> {
  const items = sale.items ?? [];
  const fiscalSection = sale.fiscalDocuments?.length
    ? await buildFiscalSection(sale.fiscalDocuments)
    : '';
  const discountAmount = sale.discountAmount ?? 0;
  const notesSection = sale.notes
    ? `
      <section class="notes">
        <div class="section-label">Notes</div>
        <p>${escapeHtml(sale.notes)}</p>
      </section>
    `
    : '';

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${escapeHtml(`Receipt ${sale.saleNumber}`)}</title>
        <style>
          :root {
            color-scheme: light;
          }

          * {
            box-sizing: border-box;
          }

          body {
            margin: 0;
            padding: 24px 18px;
            background: #ffffff;
            color: #0f172a;
            font-family: "SF Mono", "Roboto Mono", "Menlo", monospace;
            font-size: 12px;
            line-height: 1.45;
          }

          .receipt {
            width: 100%;
            max-width: 360px;
            margin: 0 auto;
          }

          .header,
          .summary,
          .notes,
          .meta {
            border-bottom: 1px dashed #cbd5e1;
            padding-bottom: 12px;
            margin-bottom: 12px;
          }

          .brand {
            font-size: 20px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          .receipt-number {
            margin-top: 4px;
            font-size: 14px;
            font-weight: 700;
          }

          .muted,
          .section-label {
            color: #475569;
          }

          .section-label {
            display: block;
            margin-bottom: 4px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }

          .meta-grid,
          .summary-grid {
            display: grid;
            gap: 6px;
          }

          .meta-row,
          .summary-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
          }

          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12px;
          }

          th,
          td {
            padding: 6px 0;
            vertical-align: top;
            border-bottom: 1px dotted #e2e8f0;
          }

          th {
            text-align: left;
            color: #475569;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.1em;
            text-transform: uppercase;
          }

          .item-name {
            width: 46%;
            padding-right: 8px;
          }

          .item-qty,
          .item-price,
          .item-total {
            text-align: right;
            white-space: nowrap;
          }

          .total-row {
            font-size: 14px;
            font-weight: 700;
          }

          .tenders {
            border-bottom: 1px dashed #cbd5e1;
            padding-bottom: 12px;
            margin-bottom: 12px;
          }

          .tender-method {
            text-transform: capitalize;
          }

          .tender-amount {
            text-align: right;
            white-space: nowrap;
          }

          .tender-reference {
            color: #475569;
            font-size: 11px;
          }

          .footer {
            text-align: center;
            color: #475569;
            font-size: 11px;
          }

          .receipt-fiscal {
            border-bottom: 1px dashed #cbd5e1;
            padding-bottom: 12px;
            margin-bottom: 12px;
          }

          .receipt-fiscal-status {
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }

          .receipt-fiscal-cufe {
            font-family: "SF Mono", "Roboto Mono", "Menlo", monospace;
            font-size: 10px;
            word-break: break-all;
            text-align: right;
            max-width: 240px;
          }

          .receipt-fiscal-qr {
            display: block;
            margin: 12px auto 0;
            width: 120px;
            height: 120px;
          }

          @media print {
            body {
              padding: 10px;
            }
          }
        </style>
      </head>
      <body>
        <main class="receipt">
          <header class="header">
            <div class="brand">Puntovivo</div>
            <div class="receipt-number">${escapeHtml(sale.saleNumber)}</div>
            <div class="muted">${escapeHtml(formatDateTime(sale.createdAt))}</div>
          </header>

          <section class="meta">
            <span class="section-label">Sale Info</span>
            <div class="meta-grid">
              <div class="meta-row">
                <span class="muted">Customer</span>
                <span>${escapeHtml(sale.customerName ?? 'Walk-in')}</span>
              </div>
              <div class="meta-row">
                <span class="muted">Payment</span>
                <span>${escapeHtml(sale.paymentMethod)} / ${escapeHtml(sale.paymentStatus)}</span>
              </div>
              <div class="meta-row">
                <span class="muted">Status</span>
                <span>${escapeHtml(sale.status)}</span>
              </div>
            </div>
          </section>

          <table>
            <thead>
              <tr>
                <th>Item</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${buildReceiptRows(items)}
            </tbody>
          </table>

          <section class="summary">
            <span class="section-label">Totals</span>
            <div class="summary-grid">
              <div class="summary-row">
                <span class="muted">Subtotal</span>
                <span>${escapeHtml(formatCurrency(sale.subtotal))}</span>
              </div>
              <div class="summary-row">
                <span class="muted">VAT</span>
                <span>${escapeHtml(formatCurrency(sale.taxAmount))}</span>
              </div>
              ${
                discountAmount > 0
                  ? `
                    <div class="summary-row">
                      <span class="muted">Discount</span>
                      <span>- ${escapeHtml(formatCurrency(discountAmount))}</span>
                    </div>
                  `
                  : ''
              }
              <div class="summary-row total-row">
                <span>Total</span>
                <span>${escapeHtml(formatCurrency(sale.total))}</span>
              </div>
            </div>
          </section>

          ${buildSplitPaymentSection(sale.payments)}

          ${fiscalSection}

          ${notesSection}

          <footer class="footer">
            <p>Items: ${items.length}</p>
            <p>Thank you for your purchase.</p>
          </footer>
        </main>
        ${
          autoPrint
            ? `
              <script>
                window.addEventListener('load', () => {
                  window.print();
                });
              </script>
            `
            : ''
        }
      </body>
    </html>
  `;
}

async function openBrowserPrintWindow(receiptHtml: string): Promise<void> {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=420,height=720');

  if (!printWindow) {
    throw new Error('Unable to open the print window. Check the browser popup settings.');
  }

  printWindow.document.open();
  printWindow.document.write(receiptHtml);
  printWindow.document.close();
}

/**
 * ENG-062 — receipt print dispatcher with ESC/POS branch + system
 * fallback. The renderer first asks the server (`printReceipt`)
 * which path to take based on the registered printer driver:
 *
 *   - `system-fallback`: no escpos peripheral registered → print
 *     via the legacy HTML path exactly like before.
 *   - `printed`: server-side ESC/POS bytes flushed; nothing else
 *     to do here.
 *   - `fallback`: ESC/POS attempt failed (USB unplug / TCP
 *     unreachable) → fall through to the legacy HTML path so the
 *     cashier never loses a receipt; the caller (SalesPage) is
 *     responsible for surfacing a translated toast about the
 *     fallback.
 *
 * `escposDispatcher` is supplied by the caller as a thin tRPC
 * mutation wrapper so this module stays unaware of the trpc client
 * shape (and the existing 10 tests in receiptPrinter.test.ts that
 * never imported tRPC continue to pass untouched).
 */
export type EscPosDispatchOutcome =
  | { status: 'printed' }
  | { status: 'system-fallback' }
  | { status: 'fallback'; error?: string | undefined; errorMessage?: string | undefined };

// ENG-179b — explicit `| undefined` on optional fields.
export interface PrintSaleReceiptOptions {
  /**
   * When supplied, called first to attempt the ESC/POS path. Returns
   * the server's dispatch outcome which steers whether to also
   * trigger the legacy HTML path.
   */
  escposDispatcher?: (() => Promise<EscPosDispatchOutcome>) | undefined;
  /**
   * Called when the ESC/POS attempt fails and the renderer falls
   * back to the legacy HTML path. The SalesPage uses this to fire a
   * translated toast.
   */
  onEscposFallback?: ((outcome: { error?: string | undefined; errorMessage?: string | undefined }) => void) | undefined;
}

export async function printSaleReceipt(
  sale: ReceiptSale,
  options: PrintSaleReceiptOptions = {}
): Promise<void> {
  const { escposDispatcher, onEscposFallback } = options;

  // ENG-062 — server-side ESC/POS branch. When the active printer
  // is escpos and the bytes flush, we are done; otherwise we fall
  // through to the legacy HTML path that has shipped since ENG-014.
  if (escposDispatcher) {
    try {
      const outcome = await escposDispatcher();
      if (outcome.status === 'printed') return;
      if (outcome.status === 'fallback') {
        onEscposFallback?.({
          error: outcome.error,
          errorMessage: outcome.errorMessage,
        });
      }
      // For system-fallback (and the fallback case above) we
      // continue into the legacy HTML path below.
    } catch {
      // The server-side dispatcher itself rejected (network, schema,
      // etc.). Treat as fallback so the cashier still gets a
      // printed receipt via the legacy path.
      onEscposFallback?.({ error: 'DISPATCHER_REJECTED' });
    }
  }

  if (window.electron?.printReceipt) {
    const html = await buildSaleReceiptHtml(sale, { autoPrint: false });
    const result = await window.electron.printReceipt(html);

    if (!result.success) {
      throw new Error(result.error || 'Unable to print the receipt');
    }

    return;
  }

  const html = await buildSaleReceiptHtml(sale, { autoPrint: true });
  await openBrowserPrintWindow(html);
}

/**
 * ENG-074b — Hub-client local hardware bridge fork.
 *
 * In `device_local` / `site_hub` modes the dispatch is server-side
 * (`peripherals.printReceipt` mutation) — the byte builder, the
 * `resolveTransport` call, and the actual write all happen inside
 * the Authority Node process. In `hub_client` mode the renderer is
 * the Authority Node ONLY for hardware: the hub returns the bytes
 * via `peripherals.buildReceiptBytes` and this terminal pipes them
 * through `window.electron.peripherals.dispatchLocalEscpos` to its
 * locally-attached printer. Both helpers below collapse that
 * decision into a single `() => Promise<EscPosDispatchOutcome>` so
 * the call sites stay simple.
 *
 * The bridge result maps to the same outcome union the existing
 * `printSaleReceipt` consumer already handles:
 *   - bridge success → `printed`
 *   - hub returned no peripheral → `system-fallback`
 *   - bridge missing OR hub fetch failed OR write failed
 *     → `fallback` (caller's `onEscposFallback` toasts a translated
 *     message; the legacy HTML path runs anyway).
 *
 * Per ADR-0008 rule 6, the helpers themselves NEVER write to any
 * operational table. They are a pure routing decision plus an IPC
 * call.
 */

/** Server `peripherals.buildReceiptBytes` query result projection. */
export interface HubReceiptBytesPayload {
  status: 'ready' | 'system-fallback';
  bytes: number[];
  transportHint: LocalEscPosTransportHint | null;
}

/** Server `peripherals.buildDrawerKickBytes` query result projection. */
export interface HubDrawerBytesPayload {
  status: 'ready' | 'no-drawer-registered';
  bytes: number[];
  transportHint: LocalEscPosTransportHint | null;
}

export interface CreateEscposReceiptDispatcherInput {
  /**
   * Server-managed dispatch closure. Used in `device_local` /
   * `site_hub`. Typically a `peripherals.printReceipt` mutation
   * wrapper that returns `EscPosDispatchOutcome`.
   */
  serverPrint: () => Promise<EscPosDispatchOutcome>;
  /**
   * Hub bytes fetch closure. Used in `hub_client`. Typically a
   * `peripherals.buildReceiptBytes` query call. Receives no args
   * because the closure already binds `{saleId, siteId}`.
   */
  fetchHubReceiptBytes: () => Promise<HubReceiptBytesPayload>;
}

/**
 * Build the receipt-print dispatcher consumed by `printSaleReceipt`.
 * Pure function: the runtime mode is read once per call so a stale
 * cache cannot pin the wrong branch.
 */
export function createEscposReceiptDispatcher({
  serverPrint,
  fetchHubReceiptBytes,
}: CreateEscposReceiptDispatcherInput): () => Promise<EscPosDispatchOutcome> {
  return async () => {
    const cfg = getRuntimeConfigSync();
    if (cfg.authorityMode !== 'hub_client') {
      return serverPrint();
    }
    const bridge = window.electron?.peripherals?.dispatchLocalEscpos;
    if (!bridge) {
      return { status: 'fallback', error: 'BRIDGE_UNAVAILABLE' };
    }
    let payload: HubReceiptBytesPayload;
    try {
      payload = await fetchHubReceiptBytes();
    } catch (err) {
      return {
        status: 'fallback',
        error: 'HUB_BYTES_FETCH_FAILED',
        errorMessage: err instanceof Error ? err.message : undefined,
      };
    }
    if (
      payload.status !== 'ready' ||
      payload.bytes.length === 0 ||
      !payload.transportHint
    ) {
      return { status: 'system-fallback' };
    }
    const result = await bridge({
      bytes: payload.bytes,
      transport: payload.transportHint,
    });
    if (result.success) return { status: 'printed' };
    return {
      status: 'fallback',
      error: result.errorCode ?? 'BRIDGE_DISPATCH_FAILED',
      errorMessage: result.error,
    };
  };
}

// ENG-179b — explicit `| undefined` on optional fields.
/** Cash-drawer kick outcome shape mirrored from server `kickCashDrawer`. */
export type DrawerKickOutcome =
  | { status: 'ok' }
  | { status: 'no-drawer-registered' }
  | { status: 'error'; error?: string | undefined; errorMessage?: string | undefined }
  | { status: 'failed'; error?: string | undefined; errorMessage?: string | undefined };

export interface DispatchDrawerKickInput {
  /** Server-managed drawer kick. Used in `device_local` / `site_hub`. */
  serverKick: () => Promise<DrawerKickOutcome>;
  /** Hub bytes fetch. Used in `hub_client`. */
  fetchHubDrawerBytes: () => Promise<HubDrawerBytesPayload>;
}

/**
 * Dispatch a cash-drawer kick respecting the runtime authority mode.
 * Same routing decision as `createEscposReceiptDispatcher` but for
 * the manager-only drawer-kick action.
 */
export async function dispatchDrawerKick({
  serverKick,
  fetchHubDrawerBytes,
}: DispatchDrawerKickInput): Promise<DrawerKickOutcome> {
  const cfg = getRuntimeConfigSync();
  if (cfg.authorityMode !== 'hub_client') {
    return serverKick();
  }
  const bridge = window.electron?.peripherals?.dispatchLocalEscpos;
  if (!bridge) {
    return { status: 'failed', error: 'BRIDGE_UNAVAILABLE' };
  }
  let payload: HubDrawerBytesPayload;
  try {
    payload = await fetchHubDrawerBytes();
  } catch (err) {
    return {
      status: 'failed',
      error: 'HUB_BYTES_FETCH_FAILED',
      errorMessage: err instanceof Error ? err.message : undefined,
    };
  }
  if (payload.status === 'no-drawer-registered') {
    return { status: 'no-drawer-registered' };
  }
  if (payload.bytes.length === 0 || !payload.transportHint) {
    return { status: 'failed', error: 'EMPTY_PAYLOAD' };
  }
  const result = await bridge({
    bytes: payload.bytes,
    transport: payload.transportHint,
  });
  if (result.success) return { status: 'ok' };
  return {
    status: 'failed',
    error: result.errorCode ?? 'BRIDGE_DISPATCH_FAILED',
    errorMessage: result.error,
  };
}
