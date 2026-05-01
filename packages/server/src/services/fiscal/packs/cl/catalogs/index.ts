/**
 * ENG-036a — Barrel de catálogos SII para el pack Chile.
 *
 * Re-exporta los tres catálogos curados que el adapter
 * ChileSIIAdapter consume:
 *
 * - `tipoDte` → códigos numéricos del SII para los tipos de
 *   Documento Tributario Electrónico (33 Factura, 39 Boleta,
 *   61 Nota Crédito, etc.).
 * - `giroComercial` → subset curado de CIIU.cl rev 4 (~30 giros
 *   comunes en retail).
 * - `comuna` → subset curado de las 346 comunas chilenas (~35
 *   entradas: 16 capitales regionales + Gran Santiago) +
 *   `COMUNA_FALLBACK = 13101` (Santiago).
 *
 * El catálogo completo de comunas (346) queda parqueado para
 * ENG-036b cuando llegue el modelado XML del DTE.
 *
 * @module services/fiscal/packs/cl/catalogs
 */

export {
  TIPO_DTE_CATALOG,
  findTipoDte,
  type TipoDteEntry,
} from './tipoDte.js';

export {
  GIRO_COMERCIAL_CATALOG,
  findGiroComercial,
  type GiroEntry,
} from './giroComercial.js';

export {
  COMUNA_CATALOG,
  COMUNA_FALLBACK,
  findComuna,
  type ComunaEntry,
} from './comuna.js';
