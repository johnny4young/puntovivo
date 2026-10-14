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
 * browser to apply the usual navigation security model. Detach the blank
 * window's opener before navigating: the noopener feature returns null even
 * when a popup opens, so it cannot be used to detect blocked print windows.
 */
export function openHtmlInPrintWindow(
  html: string,
  options: OpenHtmlPrintWindowOptions = {}
): Window | null {
  const policy = '<meta name="referrer" content="no-referrer">';
  const privateHtml = /<head\b[^>]*>/i.test(html)
    ? html.replace(/<head\b[^>]*>/i, `$&${policy}`)
    : `${policy}${html}`;
  const blob = new Blob([privateHtml], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const features = (options.features ?? '')
    .split(',')
    .filter(feature => !/^\s*(noopener|noreferrer)(\s*=.*)?\s*$/i.test(feature))
    .join(',');
  const printWindow = window.open('', options.target ?? '_blank', features);

  if (!printWindow) {
    URL.revokeObjectURL(url);
    return null;
  }

  try {
    printWindow.opener = null;
    printWindow.location.replace(url);
  } catch {
    printWindow.close();
    URL.revokeObjectURL(url);
    return null;
  }

  window.setTimeout(
    () => URL.revokeObjectURL(url),
    options.revokeDelayMs ?? PRINT_WINDOW_BLOB_REVOKE_DELAY_MS
  );
  return printWindow;
}
