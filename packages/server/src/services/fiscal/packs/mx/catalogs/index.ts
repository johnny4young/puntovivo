/**
 * ENG-035a / ENG-035b — Barrel de catálogos SAT para el pack México.
 *
 * Re-exporta los cinco catálogos curados que el adapter
 * MexicoCFDIAdapter consume:
 *
 * - `regimenFiscal` (ENG-035a) → tipos de régimen tributario (601
 *   General PM, 612 PF Empresarial, 626 RESICO, etc.).
 * - `usoCfdi` (ENG-035a) → propósito declarado del comprobante por
 *   el comprador.
 * - `formaPago` (ENG-035a) → método de pago aceptado por el SAT
 *   (01 Efectivo, 04 Tarjeta de crédito, etc.).
 * - `claveUnidad` (ENG-035a) → unidad de medida UN/CEFACT (H87
 *   Pieza, KGM Kilogramo, etc.).
 * - `claveProdServ` (ENG-035b) → clasificación SAT de
 *   producto/servicio (subset curado de 40 claves para retail
 *   LATAM; el catálogo completo de 50k+ queda capturado como
 *   follow-up `ENG-035d`).
 *
 * @module services/fiscal/packs/mx/catalogs
 */

export {
  REGIMEN_FISCAL_CATALOG,
  findRegimenFiscal,
  type RegimenFiscalEntry,
} from './regimenFiscal.js';

export {
  USO_CFDI_CATALOG,
  findUsoCfdi,
  type UsoCfdiEntry,
} from './usoCfdi.js';

export {
  FORMA_PAGO_CATALOG,
  findFormaPago,
  type FormaPagoEntry,
} from './formaPago.js';

export {
  CLAVE_UNIDAD_CATALOG,
  CLAVE_UNIDAD_FALLBACK,
  findClaveUnidad,
  type ClaveUnidadEntry,
} from './claveUnidad.js';

export {
  CLAVE_PROD_SERV_CATALOG,
  CLAVE_PROD_SERV_FALLBACK,
  findClaveProdServ,
  type ClaveProdServEntry,
} from './claveProdServ.js';
