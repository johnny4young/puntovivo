/**
 * Catálogo SAT c_ClaveUnidad (subset curado).
 *
 * El SAT publica un catálogo enorme con más de 3500 unidades de
 * medida basadas en el estándar UN/CEFACT. La mayoría son
 * irrelevantes para retail (unidades industriales, de medición
 * científica, etc.). Aquí incluimos un subset de ~25 unidades que
 * cubren los productos típicos de un POS LATAM.
 *
 * El SAT exige que cada concepto del CFDI lleve un `ClaveUnidad`
 * válido. Cuando el catálogo interno de Puntovivo (`units` table)
 * no tiene un mapeo explícito,  cae a `H87` (Pieza) como
 * fallback seguro — es el código más genérico que el SAT acepta
 * para mercancía contable por unidad.
 *
 * El mapeo `unit interno → ClaveUnidad` no vive aquí; vive en
 * cuando se modele el armado del XML CFDI. Por ahora
 * sólo exponemos el catálogo + el constante de fallback.
 *
 * @module services/fiscal/packs/mx/catalogs/claveUnidad
 */

export interface ClaveUnidadEntry {
  /** Código SAT alfanumérico de 2-4 caracteres, p. ej. 'H87'. */
  code: string;
  /** Descripción oficial. */
  name: string;
  /** Símbolo abreviado, útil para UI. */
  symbol?: string;
}

/**
 * Fallback estándar para productos sin mapeo explícito. El SAT
 * acepta H87 como unidad genérica de mercancía contable por unidad
 * el equivalente a "cada uno" en POS retail.
 */
export const CLAVE_UNIDAD_FALLBACK = 'H87';

export const CLAVE_UNIDAD_CATALOG: ReadonlyArray<ClaveUnidadEntry> = [
  { code: 'H87', name: 'Pieza', symbol: 'pza' },
  { code: 'EA', name: 'Elemento', symbol: 'ea' },
  { code: 'KGM', name: 'Kilogramo', symbol: 'kg' },
  { code: 'GRM', name: 'Gramo', symbol: 'g' },
  { code: 'MGM', name: 'Miligramo', symbol: 'mg' },
  { code: 'TNE', name: 'Tonelada métrica', symbol: 't' },
  { code: 'LTR', name: 'Litro', symbol: 'L' },
  { code: 'MLT', name: 'Mililitro', symbol: 'mL' },
  { code: 'GLL', name: 'Galón', symbol: 'gal' },
  { code: 'MTR', name: 'Metro', symbol: 'm' },
  { code: 'CMT', name: 'Centímetro', symbol: 'cm' },
  { code: 'MMT', name: 'Milímetro', symbol: 'mm' },
  { code: 'KMT', name: 'Kilómetro', symbol: 'km' },
  { code: 'MTK', name: 'Metro cuadrado', symbol: 'm²' },
  { code: 'MTQ', name: 'Metro cúbico', symbol: 'm³' },
  { code: 'XBX', name: 'Caja', symbol: 'caja' },
  { code: 'XPK', name: 'Paquete', symbol: 'pkt' },
  { code: 'XPX', name: 'Tarima', symbol: 'tarima' },
  { code: 'XBE', name: 'Atado', symbol: 'atado' },
  { code: 'XCJ', name: 'Bote', symbol: 'bote' },
  { code: 'XBO', name: 'Botella', symbol: 'btl' },
  { code: 'XSA', name: 'Saco', symbol: 'saco' },
  { code: 'HUR', name: 'Hora', symbol: 'h' },
  { code: 'DAY', name: 'Día', symbol: 'd' },
  { code: 'MIN', name: 'Minuto', symbol: 'min' },
];

export function findClaveUnidad(code: string): ClaveUnidadEntry | undefined {
  return CLAVE_UNIDAD_CATALOG.find(entry => entry.code === code);
}
