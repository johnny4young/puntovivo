export const PRINT_WINDOW_BLOB_REVOKE_DELAY_MS = 30_000;

export interface OpenHtmlPrintWindowOptions {
  target?: string;
  features?: string;
  revokeDelayMs?: number;
}

/**
 * Open a self-contained printable HTML document without `document.write`.
 *
 * Blob URLs keep the print payload out of the current document's DOM, allow the
 * browser to apply the usual navigation security model, and pair naturally with
 * `noopener,noreferrer` so print popups cannot retain access to the opener.
 */
export function openHtmlInPrintWindow(
  html: string,
  options: OpenHtmlPrintWindowOptions = {}
): Window | null {
  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const printWindow = window.open(
    url,
    options.target ?? '_blank',
    options.features ?? 'noopener,noreferrer'
  );

  if (!printWindow) {
    URL.revokeObjectURL(url);
    return null;
  }

  window.setTimeout(
    () => URL.revokeObjectURL(url),
    options.revokeDelayMs ?? PRINT_WINDOW_BLOB_REVOKE_DELAY_MS
  );
  return printWindow;
}
