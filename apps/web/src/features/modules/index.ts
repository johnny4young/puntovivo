/**
 * ENG-068 — Public surface for the modules kernel on the renderer.
 *
 * @module features/modules
 */

export {
  CLIENT_MODULE_DEFAULTS,
  CLIENT_MODULE_IDS,
  isClientModuleId,
  type ClientModuleId,
} from './manifest';
export {
  ModulesProvider,
  useIsModuleActive,
  useModulesSnapshot,
} from './ModulesContext';
export { RequireModule } from './RequireModule';
