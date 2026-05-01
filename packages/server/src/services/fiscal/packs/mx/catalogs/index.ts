/**
 * ENG-035a — Barrel de catálogos SAT para el pack México.
 *
 * Re-exporta los cuatro catálogos curados que el adapter
 * MexicoCFDIAdapter consume:
 *
 * - `regimenFiscal` → tipos de régimen tributario (601 General PM,
 *   612 PF Empresarial, 626 RESICO, etc.).
 * - `usoCfdi` → propósito declarado del comprobante por el comprador.
 * - `formaPago` → método de pago aceptado por el SAT (01 Efectivo,
 *   04 Tarjeta de crédito, etc.).
 * - `claveUnidad` → unidad de medida UN/CEFACT (H87 Pieza, KGM
 *   Kilogramo, etc.).
 *
 * El catálogo `claveProdServ` (50k entradas, requiere refresh
 * desde la API del SAT) NO ship en ENG-035a; queda capturado para
 * ENG-035b junto con el modelado XML CFDI 4.0.
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
