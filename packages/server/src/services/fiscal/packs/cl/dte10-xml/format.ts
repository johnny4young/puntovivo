/**
 * Shared format helpers for DTE 1.0 serialization (ENG-036b): TSTED
 * timestamp + SII text/name sanitization.
 *
 * @module services/fiscal/packs/cl/dte10-xml/format
 */

/**
 * SII expects FE in `YYYY-MM-DD` format. The TED.TSTED slot uses ISO
 * timestamp `YYYY-MM-DDTHH:mm:ss` without timezone (SII assumes
 * Chile/Continental).
 */
export function combineTimestamp(issueDate: string, issueTime: string): string {
  const cleanTime = issueTime.replace(/Z$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
  return `${issueDate}T${cleanTime}`;
}

/**
 * Limpia caracteres que el SII rechaza dentro de elementos XML.
 * SII acepta latin1 + un set acotado de símbolos. Los caracteres
 * XML reservados (& < > " ') ya los escapa fast-xml-parser; aquí
 * solo normalizamos espacios y recortamos al maxLength.
 */
export function sanitizeText(value: string, maxLength: number): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

export function sanitizeName(value: string): string {
  return sanitizeText(value, 100);
}
