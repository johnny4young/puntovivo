// canonical MIME registry + extension lookup ( slice 30).

/**
 * Canonical MIME registry per extension. Single source of
 * truth so every download surface agrees on the type to declare to
 * `Blob` (and indirectly to `Content-Type` when the renderer uploads
 * via FormData). The Map is intentionally typed as `Record` of a
 * literal union so adding a new extension is a one-line TS change.
 *
 * Charset suffixes (e.g. `;charset=iso-8859-1`) live on the server
 * envelope for that specific document — the client passes the server
 * value through untouched. Do NOT bake charsets into this table.
 */
export const MIME_BY_EXT = {
  csv: 'text/csv;charset=utf-8',
  xml: 'application/xml;charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  zip: 'application/zip',
  json: 'application/json;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
} as const satisfies Record<string, string>;

export type SupportedExportExtension = keyof typeof MIME_BY_EXT;

/**
 * Throw helper for the registry. The renderer should never construct a
 * Blob with an extension we do not know — if it tries, we want a loud
 * error at the call site instead of a silent `application/octet-stream`
 * download with the wrong icon in the OS file picker.
 */
export function mimeTypeForExtension(extension: string): string {
  const normalized = extension.replace(/^\.+/, '').toLowerCase() as SupportedExportExtension;
  const mime = MIME_BY_EXT[normalized];
  if (!mime) {
    throw new Error(
      `Unsupported export extension: "${extension}". Allowed: ${Object.keys(MIME_BY_EXT).join(
        ', '
      )}`
    );
  }
  return mime;
}
