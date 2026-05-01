/**
 * Pack fiscal de México — exports públicos.
 *
 * @module services/fiscal/packs/mx
 */
export { MexicoCFDIAdapter } from './mexico-adapter.js';
export {
  readMxFiscalSettings,
  buildMxFiscalSettingsPatch,
  mergeMxFiscalSettingsIntoTenantSettings,
  type MxFiscalSettings,
} from './settings.js';
export {
  validateRfc,
  type RfcValidationResult,
  type RfcKind,
} from './rfc.js';
export {
  REGIMEN_FISCAL_CATALOG,
  USO_CFDI_CATALOG,
  FORMA_PAGO_CATALOG,
  CLAVE_UNIDAD_CATALOG,
  CLAVE_UNIDAD_FALLBACK,
  findRegimenFiscal,
  findUsoCfdi,
  findFormaPago,
  findClaveUnidad,
} from './catalogs/index.js';
