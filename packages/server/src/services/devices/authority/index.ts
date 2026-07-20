/**
 * Authority Node service — public barrel.
 *
 * Re-assembles the per-concern modules into the original public surface
 * (5 types + 5 functions) so importers resolve unchanged.
 *
 * @module services/devices/authority
 */

export type {
  AuthorityHealthStatus,
  PairingCodeCreated,
  AuthorityDeviceSummary,
  AuthorityPairingSummary,
  AuthorityTopology,
} from './types.js';
export { inferAuthorityRole, assertTenantSite } from './helpers.js';
export { createPairingCode, claimPairingCodeForDevice } from './pairing.js';
export { getAuthorityTopology } from './topology.js';
