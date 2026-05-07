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
// ENG-036b — DTE 1.0 emission surface.
export {
  allocateNextFolio,
  peekActiveCaf,
  type ChileFolioAllocation,
  type PeekActiveCafResult,
} from './caf-allocator.js';
export {
  serializeDte10,
  prettyPrintDte,
  type SerializedDte10,
} from './dte10-xml.js';
export {
  computeDteTotals,
  mapInternalKindToTipoDte,
  mapPaymentMethodToFmaPago,
  mapUnitToUnmdItem,
  roundClp,
  TASA_IVA_CL,
  type DteTotals,
  type FmaPago,
} from './mappings.js';
