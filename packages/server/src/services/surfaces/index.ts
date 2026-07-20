/**
 * Public surface for the multi-surface POS shell kernel.
 *
 * @module services/surfaces
 */

export {
  SURFACE_IDS,
  SURFACES_MANIFEST,
  isSurfaceId,
  assertSurfaceManifestIntegrity,
  type SurfaceId,
  type SurfaceDescriptor,
  type SurfaceRoleSet,
} from './manifest.js';
