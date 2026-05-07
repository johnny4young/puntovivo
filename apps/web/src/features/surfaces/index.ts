/**
 * ENG-069 — Public surface for the multi-surface POS shell on the
 * renderer.
 *
 * @module features/surfaces
 */

export {
  CLIENT_SURFACE_IDS,
  CLIENT_SURFACES_MANIFEST,
  isClientSurfaceId,
  type ClientSurfaceId,
  type ClientSurfaceDescriptor,
} from './manifest';
export { TouchShell } from './TouchShell';
export { KdsShell } from './KdsShell';
export { CustomerDisplayShell } from './CustomerDisplayShell';
export { MobileWaiterShell } from './MobileWaiterShell';
export { TouchHomePlaceholder } from './TouchHomePlaceholder';
export { KdsHomePlaceholder } from './KdsHomePlaceholder';
export { CustomerDisplayHomePlaceholder } from './CustomerDisplayHomePlaceholder';
export { MobileWaiterHomePlaceholder } from './MobileWaiterHomePlaceholder';
