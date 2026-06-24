// ENG-103 — download filename generation + the browser download trigger +
// the semantic filename builder (ENG-178 slice 30).

import { mimeTypeForExtension, type SupportedExportExtension } from './mime';
import type { SemanticExportKind } from './types';

const DOWNLOAD_URL_REVOKE_DELAY_MS = 1000;

/**
 * Generate a filename with optional timestamp.
 *
 * The sanitizer normalizes accents and replaces punctuation in `baseName`
 * (so callers can pass user-facing strings like "sales history") but never
 * touches the trailing `.${extension}` — that is the single source of truth
 * for the extension and must survive unchanged so the browser honors the
 * suggested download name.
 */
export function generateFilename(
  baseName: string,
  extension: string,
  includeTimestamp = true
): string {
  const sanitizedName =
    baseName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase() || 'export';
  const sanitizedExtension =
    extension
      .replace(/^\.+/, '')
      .replace(/[^a-z0-9]/gi, '')
      .toLowerCase() || 'txt';
  if (includeTimestamp) {
    // ISO string has `:` and `.`; swap both for `-` so the filename has
    // exactly one dot — the one before the extension.
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `${sanitizedName}_${timestamp}.${sanitizedExtension}`;
  }
  return `${sanitizedName}.${sanitizedExtension}`;
}

/**
 * Trigger file download in the browser.
 *
 * Revoking the object URL is deferred briefly — revoking it
 * synchronously right after `link.click()` races against the browser's own
 * download pipeline on Firefox / Safari / Electron. When the race is lost
 * the browser falls back to the blob URL fragment as the suggested
 * filename, which has no extension at all ("Unknown", "download", or the
 * UUID portion of the blob URL). The short grace period keeps the semantic
 * `download` filename alive long enough for the OS handoff without leaking
 * the URL for the lifetime of the page.
 *
 * ENG-103 — exported so every download surface in the app routes through
 * the same anchor + revoke pattern. Re-implementing this dance inline (as
 * the v1 fiscal XML modal did) bypasses the cache-friendly revoke delay
 * and risks the extensionless-filename regression on slow Electron
 * channels.
 */
export function downloadFile(content: Blob, filename: string): void {
  const url = URL.createObjectURL(content);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  // `rel="noopener"` keeps the transient anchor from leaking our window
  // reference on the off-chance some popup-blocker rewrites the click into
  // a real navigation.
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_REVOKE_DELAY_MS);
}

export function buildSemanticFilename(
  spec: SemanticExportKind,
  extension: SupportedExportExtension
): string {
  // Validate the extension up-front so the renderer never produces a
  // filename whose MIME type cannot be resolved later.
  void mimeTypeForExtension(extension);

  const baseName = (() => {
    switch (spec.kind) {
      case 'statement':
        return `statement-${spec.provider}-${spec.from}_${spec.to}`;
      case 'ledger': {
        const taxId = spec.taxId?.trim();
        const customerSegment = `${spec.customer}${taxId ? `-${taxId}` : ''}`;
        return `ledger-estadocuenta-${customerSegment}-${spec.date}`;
      }
      case 'diagnostic':
        return `puntovivo-diagnostic-${spec.tenant}-${spec.timestamp}`;
      case 'fiscal':
        return `cfdi-${spec.country}-${spec.documentNumber}`;
      case 'report':
        return `${spec.name}-${spec.date}`;
    }
  })();

  // The legacy `generateFilename` helper adds a timestamp by default;
  // we already encode the relevant date into `baseName`, so the
  // `includeTimestamp=false` form is what the semantic builder wants.
  return generateFilename(baseName, extension, false);
}
