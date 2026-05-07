/**
 * ENG-068 — Module activation kernel barrel.
 */
export {
  MODULE_IDS,
  MODULES_MANIFEST,
  MODULES_SCHEMA_VERSION,
  buildModulesBlob,
  isModuleId,
  resolveModulesState,
  visibleDescriptors,
  type ModuleDescriptor,
  type ModuleId,
} from './manifest.js';
