/**
 * Shared format helpers for CFDI 4.0 serialization (ENG-035b): SAT
 * Fecha formatting + attribute name sanitization.
 *
 * @module services/fiscal/packs/mx/cfdi40-xml/format
 */

/**
 * El SAT exige Fecha en formato `YYYY-MM-DDTHH:mm:ss` SIN zona
 * horaria explícita (la zona se asume del LugarExpedicion). El
 * orchestrator nos pasa issueDate `YYYY-MM-DD` + issueTime
 * `HH:mm:ssZ`; armamos el formato SAT.
 */
export function formatFechaCfdi(issueDate: string, issueTime: string): string {
  // issueTime puede traer 'Z' al final. El SAT no acepta zona;
  // limpiamos cualquier sufijo de timezone.
  const cleanTime = issueTime.replace(/Z$/, '').replace(/[+-]\d{2}:?\d{2}$/, '');
  return `${issueDate}T${cleanTime}`;
}

/**
 * Limpia caracteres que el SAT rechaza dentro de atributos XML.
 * Anexo 20 acepta letras, dígitos, espacio, y un set acotado de
 * símbolos. Los caracteres XML reservados (& < > " ') ya los
 * escapa fast-xml-parser; aquí solo normalizamos espacios y
 * recortamos casos extremos.
 */
export function sanitizeName(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 254);
}
