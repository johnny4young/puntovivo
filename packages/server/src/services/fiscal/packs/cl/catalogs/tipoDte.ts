/**
 * ENG-036a — Catálogo SII de tipos de DTE (Documento Tributario
 * Electrónico).
 *
 * El SII publica una lista cerrada de códigos numéricos para
 * identificar el tipo de comprobante. En el POS retail los códigos
 * relevantes son:
 *
 * - 33 / 34 — Factura electrónica (afecta / exenta de IVA).
 * - 39 / 41 — Boleta electrónica (afecta / exenta).
 * - 52 — Guía de despacho electrónica (movimiento de inventario,
 *   no es venta).
 * - 56 / 61 — Notas (débito / crédito) sobre un DTE previo.
 *
 * El catálogo es estático en compilación. ENG-036b decide si
 * migra a una DB table cuando llegue el modelado XML del DTE
 * (ahí va a hacer falta validar el código en el armado del
 * comprobante).
 *
 * @module services/fiscal/packs/cl/catalogs/tipoDte
 */

export interface TipoDteEntry {
  /** Código SII numérico, p. ej. 33. */
  code: number;
  /** Nombre oficial del SII. */
  name: string;
  /**
   * Categoría operativa (no es del SII; sirve para que la UI
   * agrupe los códigos por familia).
   */
  category: 'invoice' | 'receipt' | 'note' | 'shipping';
}

/**
 * Subset curado para retail. Cubre todos los DTE que un POS típico
 * emite. Los DTE especializados (110 Factura de exportación, 46
 * Factura de compra, etc.) no shipan en ENG-036a; ENG-036b los
 * agrega si llega a haber operadores B2B mayoristas.
 */
export const TIPO_DTE_CATALOG: ReadonlyArray<TipoDteEntry> = [
  { code: 33, name: 'Factura electrónica', category: 'invoice' },
  { code: 34, name: 'Factura no afecta o exenta electrónica', category: 'invoice' },
  { code: 39, name: 'Boleta electrónica', category: 'receipt' },
  { code: 41, name: 'Boleta no afecta o exenta electrónica', category: 'receipt' },
  { code: 52, name: 'Guía de despacho electrónica', category: 'shipping' },
  { code: 56, name: 'Nota de débito electrónica', category: 'note' },
  { code: 61, name: 'Nota de crédito electrónica', category: 'note' },
];

/**
 * Búsqueda case-sensitive por código SII. Devuelve `undefined` si
 * el código no está en el catálogo curado — el caller decide si
 * caer al modelado completo (ENG-036b) o rechazar.
 */
export function findTipoDte(code: number): TipoDteEntry | undefined {
  return TIPO_DTE_CATALOG.find(entry => entry.code === code);
}
