/** Number the server would print: prefix plus the consecutive padded to 10 digits. */
export function numberingDocumentNumber(prefix: string, consecutive: number): string {
  return `${prefix}${consecutive.toString().padStart(10, '0')}`;
}
