/**
 * ENG-103 — Server export envelope.
 *
 * Every server procedure that returns a downloadable payload speaks the
 * same shape: `{ data, filename, mimeType }`. The renderer always wraps
 * `data` in a Blob with the declared `mimeType` and triggers the download
 * with the suggested `filename` (no extension guessing, no Blob URL
 * fragment leaking into the saved file).
 *
 * v1 scope — string-only payloads
 * ===============================
 *
 * `data` is intentionally typed as `string`. UTF-8 text (CSV, XML, JSON,
 * plaintext) and ISO-8859-1 text (DTE CL) both survive a tRPC round trip
 * cleanly because tRPC's superjson layer treats them as opaque strings.
 *
 * Binary payloads (Excel `.xlsx`, signed PDFs, ZIP bundles) are
 * deliberately NOT covered by this envelope. The bytes would need to be
 * base64-encoded server-side and decoded client-side, costing ~33% of
 * payload bloat for every download — wasteful when the client already
 * builds the binary today (xlsx via `exceljs`, pdf via `jspdf`, zip via
 * `jszip`). When a future ticket needs server-built binaries, route the
 * download through a Fastify REST endpoint with explicit
 * `Content-Disposition` + `Content-Type` headers instead of widening
 * this type. `ENG-124` (payment settlement v2) is the first plausible
 * caller — its provider statements may need server-side parsing into a
 * branded format we never want the client to re-encode.
 *
 * Filename semantic contract
 * ==========================
 *
 * `filename` always carries an extension (`.xml`, `.csv`, etc.) and
 * follows the `<kind>-<context>-<date|id>.<ext>` pattern documented in
 * the web-side `buildSemanticFilename` helper. Never UUID-like,
 * never extensionless — that mode regression is exactly what this
 * ticket prevents.
 *
 * `mimeType` may include a charset suffix when the encoding is not
 * UTF-8 (`application/xml;charset=iso-8859-1` for DTE CL). The renderer
 * passes the value straight to `new Blob([data], { type: mimeType })`.
 *
 * @module services/exports/envelope
 */

/**
 * Shape returned by every tRPC procedure that emits a downloadable
 * text artifact. The renderer wraps `data` in a Blob keyed by
 * `mimeType` and uses `filename` as the download anchor's `download=`
 * attribute.
 */
export interface ServerExportEnvelope {
  /** The raw text payload (UTF-8 or ISO-8859-1 per `mimeType`). */
  data: string;
  /**
   * Suggested filename including the extension, e.g.
   * `cfdi-mx-FAC-001.xml` or
   * `puntovivo-diagnostic-acme-20260520-123456.zip`.
   */
  filename: string;
  /**
   * MIME type. May carry `;charset=...` when the encoding deviates
   * from UTF-8. The web helper passes it untouched to the Blob
   * constructor.
   */
  mimeType: string;
}

/**
 * Build the server-side suggested filename for a fiscal XML export.
 * Pattern: `cfdi-<country>-<identifier>.xml`. `identifier` is the
 * `documentNumber` (Folio) when present; otherwise falls back to the
 * internal `fiscal_documents.id` so the download is always traceable.
 *
 * The country code is lower-cased so the filename matches the
 * canonical pattern the website export contract documents
 * (`cfdi-mx-FAC-001.xml`, `cfdi-cl-DTE-39-100.xml`).
 */
export function buildFiscalXmlFilename(args: {
  countryCode: string;
  documentNumber: string | null;
  documentId: string;
}): string {
  const country = args.countryCode.trim().toLowerCase() || 'xx';
  const identifier =
    (args.documentNumber ?? '').trim().length > 0
      ? args.documentNumber!.trim()
      : args.documentId.trim();
  // Defensive sanitization: replace path separators + control chars,
  // keep alphanumerics, hyphens, underscores, dots. Spaces become
  // hyphens so the download anchor never gets a multi-token filename
  // that confuses the OS.
  const sanitizedIdentifier = identifier
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1F\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `cfdi-${country}-${sanitizedIdentifier || args.documentId}.xml`;
}

/**
 * Build the server-side suggested filename for a diagnostic ZIP
 * export. Pattern:
 * `puntovivo-diagnostic-<tenantSlug>-<YYYYMMDD-HHMMSS>.zip`. The
 * timestamp is the server's current ISO timestamp collapsed to a
 * filesystem-safe shape.
 */
export function buildDiagnosticZipFilename(args: {
  tenantSlug: string;
  now?: Date;
}): string {
  const tenantSlug = args.tenantSlug.trim().toLowerCase() || 'tenant';
  const sanitizedSlug = tenantSlug
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const now = args.now ?? new Date();
  const yyyy = String(now.getUTCFullYear()).padStart(4, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mi = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  const timestamp = `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
  return `puntovivo-diagnostic-${sanitizedSlug || 'tenant'}-${timestamp}.zip`;
}

/**
 * MIME type used by every fiscal XML download. ISO-8859-1 callers
 * append `;charset=iso-8859-1` directly to the envelope's `mimeType`
 * because the Chilean DTE10 XML preamble pins that encoding.
 */
export const FISCAL_XML_MIME_UTF8 = 'application/xml;charset=utf-8' as const;
export const FISCAL_XML_MIME_ISO_8859_1 =
  'application/xml;charset=iso-8859-1' as const;
