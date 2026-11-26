import { openHtmlInPrintWindow } from './printWindow';

/** Popup features for printable documents; `openHtmlInPrintWindow` strips the
 *  opener-hardening flags because they would hide a blocked popup from us. */
export const PRINT_WINDOW_FEATURES = 'noopener,noreferrer,width=480,height=720';

/** Every printer reports a blocked print window with this exact copy. */
export const PRINT_WINDOW_BLOCKED_MESSAGE =
  'Unable to open the print window. Check the browser popup settings.';

/**
 * Escape a value before interpolating it into a printable HTML document.
 *
 * Single-sourced for the receipt printers (`orders`, `quotations`) so an
 * escaping fix cannot drift between documents.
 */
export function escapeHtml(value: string): string {
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

/**
 * `<style>` tag shared by the narrow receipt documents.
 *
 * The page chrome is identical across printers; only the table's item columns
 * differ, so each document passes its own `td.item-*` rules. Everything else —
 * page, header, meta/summary grids, totals row and print padding — stays
 * single-sourced here so a layout fix lands in every document at once.
 */
export function buildReceiptStyleTag(itemColumnRules: string): string {
  return `
        <style>
          :root { color-scheme: light; }
          * { box-sizing: border-box; }
          body {
            margin: 0;
            padding: 24px 18px;
            background: #ffffff;
            color: #0f172a;
            font-family: "SF Mono", "Roboto Mono", "Menlo", monospace;
            font-size: 12px;
            line-height: 1.45;
          }
          .receipt { width: 100%; max-width: 420px; margin: 0 auto; }
          .header, .summary, .notes, .meta {
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
          .kicker {
            color: #475569;
            font-size: 10px;
            letter-spacing: 0.16em;
            text-transform: uppercase;
            margin-bottom: 2px;
          }
          .receipt-number {
            margin-top: 4px;
            font-size: 14px;
            font-weight: 700;
          }
          .muted, .section-label { color: #475569; }
          .section-label {
            display: block;
            margin-bottom: 4px;
            font-size: 10px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }
          .meta-grid, .summary-grid { display: grid; gap: 6px; }
          .meta-row, .summary-row {
            display: flex;
            justify-content: space-between;
            gap: 12px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 12px;
          }
          th, td {
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
          }${itemColumnRules}          .total-row { font-size: 14px; font-weight: 700; }
          .footer {
            text-align: center;
            color: #475569;
            font-size: 11px;
          }
          @media print { body { padding: 10px; } }
        </style>`;
}

/** Script appended to the browser copy so it prints itself once loaded. */
export const AUTO_PRINT_SCRIPT = `
              <script>
                window.addEventListener('load', () => {
                  window.print();
                });
              </script>
            `;

export type PrintBridgeFailureCode = 'popupBlocked' | 'desktopBridgeFailed' | 'unknown';

export interface PrintHtmlDocumentOptions {
  /** Builds the document; the bridge decides `autoPrint` per transport. */
  buildHtml: (options: { autoPrint: boolean }) => string | Promise<string>;
  /** The printer's own error type, so its public `code` contract stays stable. */
  createError: (code: PrintBridgeFailureCode, message: string) => Error;
  /** Fallback copy when the desktop bridge reports no message of its own. */
  desktopBridgeFailedMessage: string;
  unknownErrorMessage: string;
  /** A cancelled native print dialog is an operator choice, not a failure. */
  cancelledDialogIsSuccess?: boolean;
  /** Override popup window features when a wider layout needs more room. */
  windowFeatures?: string;
}

/**
 * Print a self-contained HTML document through the desktop bridge, falling back
 * to the browser's blob print window.
 *
 * Shared by the receipt printers so a fix to the transport (cancellation
 * handling, popup detection, error mapping) cannot diverge between documents.
 * The caller keeps its own typed error class and messages; this only decides
 * which failure happened.
 */
export async function printHtmlDocument({
  buildHtml,
  createError,
  desktopBridgeFailedMessage,
  unknownErrorMessage,
  cancelledDialogIsSuccess = false,
  windowFeatures = PRINT_WINDOW_FEATURES,
}: PrintHtmlDocumentOptions): Promise<void> {
  if (window.electron?.printReceipt) {
    const result = await window.electron.printReceipt(await buildHtml({ autoPrint: false }));

    if (!result.success) {
      if (cancelledDialogIsSuccess && result.errorCode === 'PRINT_CANCELLED') return;
      throw createError('desktopBridgeFailed', result.error || desktopBridgeFailedMessage);
    }

    return;
  }

  let printWindow: Window | null;
  try {
    printWindow = openHtmlInPrintWindow(await buildHtml({ autoPrint: true }), {
      features: windowFeatures,
    });
  } catch {
    throw createError('unknown', unknownErrorMessage);
  }

  if (!printWindow) {
    throw createError('popupBlocked', PRINT_WINDOW_BLOCKED_MESSAGE);
  }
}
