/**
 * Pack fiscal de Chile — exports públicos.
 *
 * @module services/fiscal/packs/cl
 */
export { ChileSIIAdapter } from './chile-adapter.js';
export {
  readClFiscalSettings,
  buildClFiscalSettingsPatch,
  mergeClFiscalSettingsIntoTenantSettings,
  type ClFiscalSettings,
} from './settings.js';
export {
  validateRut,
  type RutValidationResult,
  type RutKind,
} from './rut.js';
export {
  TIPO_DTE_CATALOG,
  GIRO_COMERCIAL_CATALOG,
  COMUNA_CATALOG,
  COMUNA_FALLBACK,
  findTipoDte,
  findGiroComercial,
  findComuna,
} from './catalogs/index.js';
