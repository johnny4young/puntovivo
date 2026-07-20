/**
 * Catálogo SUBDERE de comunas de Chile (subset curado).
 *
 * El SII pide el código de comuna del lugar de emisión en cada
 * DTE. El catálogo oficial de la SUBDERE (Subsecretaría de
 * Desarrollo Regional) tiene 346 comunas; aquí incluimos un
 * subset de ~35 entradas con las capitales regionales + las
 * comunas más pobladas del Gran Santiago (que cubre ~70% de la
 * población chilena).
 *
 * Los códigos siguen el formato `RRPCC` donde:
 * - `RR` = código de región (01-16).
 * - `PCC` = código de provincia + comuna dentro de la región.
 *
 * Ejemplo: `13101` = Región Metropolitana (13) + Provincia
 * Santiago (1) + Comuna Santiago (01).
 *
 * El catálogo completo (346 comunas) queda parqueado para
 * el modelado XML del DTE va a necesitar match exacto
 * de la comuna del lugar de emisión, ahí decidimos si lo
 * shippeamos como TS module gigante o como DB table con seed.
 *
 * @module services/fiscal/packs/cl/catalogs/comuna
 */

export interface ComunaEntry {
  /** Código SUBDERE de 5 dígitos. */
  code: number;
  /** Nombre oficial. */
  name: string;
  /** Región a la que pertenece la comuna. */
  region: string;
}

/**
 * Default cuando no hay match: Santiago (13101). Se usa como
 * fallback en el armado de DTE cuando la comuna del lugar de
 * emisión no está en el catálogo curado.  refina cuando
 * llega el catálogo completo.
 */
export const COMUNA_FALLBACK = 13101;

/**
 * 35 entradas curadas: 16 capitales regionales + las 19 comunas
 * más pobladas del Gran Santiago.
 */
export const COMUNA_CATALOG: ReadonlyArray<ComunaEntry> = [
  // Región Metropolitana (Gran Santiago)
  { code: 13101, name: 'Santiago', region: 'Metropolitana de Santiago' },
  { code: 13102, name: 'Cerrillos', region: 'Metropolitana de Santiago' },
  { code: 13103, name: 'Cerro Navia', region: 'Metropolitana de Santiago' },
  { code: 13105, name: 'Conchalí', region: 'Metropolitana de Santiago' },
  { code: 13107, name: 'Estación Central', region: 'Metropolitana de Santiago' },
  { code: 13110, name: 'La Cisterna', region: 'Metropolitana de Santiago' },
  { code: 13111, name: 'La Florida', region: 'Metropolitana de Santiago' },
  { code: 13114, name: 'Las Condes', region: 'Metropolitana de Santiago' },
  { code: 13115, name: 'Lo Barnechea', region: 'Metropolitana de Santiago' },
  { code: 13117, name: 'Lo Espejo', region: 'Metropolitana de Santiago' },
  { code: 13119, name: 'Macul', region: 'Metropolitana de Santiago' },
  { code: 13120, name: 'Maipú', region: 'Metropolitana de Santiago' },
  { code: 13123, name: 'Ñuñoa', region: 'Metropolitana de Santiago' },
  { code: 13125, name: 'Peñalolén', region: 'Metropolitana de Santiago' },
  { code: 13126, name: 'Providencia', region: 'Metropolitana de Santiago' },
  { code: 13128, name: 'Quilicura', region: 'Metropolitana de Santiago' },
  { code: 13131, name: 'San Bernardo', region: 'Metropolitana de Santiago' },
  { code: 13132, name: 'San Joaquín', region: 'Metropolitana de Santiago' },
  { code: 13133, name: 'San Miguel', region: 'Metropolitana de Santiago' },
  { code: 13201, name: 'Puente Alto', region: 'Metropolitana de Santiago' },

  // Capitales regionales del país (1 por región)
  { code: 1101, name: 'Iquique', region: 'Tarapacá' },
  { code: 2101, name: 'Antofagasta', region: 'Antofagasta' },
  { code: 3101, name: 'Copiapó', region: 'Atacama' },
  { code: 4101, name: 'La Serena', region: 'Coquimbo' },
  { code: 5109, name: 'Valparaíso', region: 'Valparaíso' },
  { code: 6101, name: 'Rancagua', region: "Libertador General Bernardo O'Higgins" },
  { code: 7101, name: 'Talca', region: 'Maule' },
  { code: 8101, name: 'Concepción', region: 'Biobío' },
  { code: 9112, name: 'Temuco', region: 'La Araucanía' },
  { code: 10101, name: 'Puerto Montt', region: 'Los Lagos' },
  { code: 11101, name: 'Coyhaique', region: 'Aysén' },
  { code: 12101, name: 'Punta Arenas', region: 'Magallanes y Antártica Chilena' },
  { code: 14101, name: 'Valdivia', region: 'Los Ríos' },
  { code: 15101, name: 'Arica', region: 'Arica y Parinacota' },
  { code: 16101, name: 'Chillán', region: 'Ñuble' },
];

/**
 * Búsqueda por código SUBDERE.
 */
export function findComuna(code: number): ComunaEntry | undefined {
  return COMUNA_CATALOG.find(entry => entry.code === code);
}
