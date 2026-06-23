/**
 * Public types for the ENG-075 Authority Node pairing + topology service.
 *
 * @module services/devices/authority/types
 */

import type { RuntimeConfig } from '../../../config/runtime.js';
import type {
  DeviceAuthorityRole,
  DeviceKind,
  DevicePairingCodeStatus,
} from '../../../db/schema.js';

export type AuthorityHealthStatus = 'online' | 'stale' | 'revoked';

export interface PairingCodeCreated {
  id: string;
  code: string;
  siteId: string;
  expiresAt: string;
}

export interface AuthorityDeviceSummary {
  id: string;
  name: string;
  kind: DeviceKind;
  authorityRole: DeviceAuthorityRole;
  pairedSiteId: string | null;
  pairedSiteName: string | null;
  lastSeenAt: string | null;
  appVersion: string | null;
  dbSchemaVersion: number | null;
  healthStatus: AuthorityHealthStatus;
  isActive: boolean;
  createdAt: string;
}

export interface AuthorityPairingSummary {
  id: string;
  siteId: string;
  siteName: string | null;
  deviceName: string | null;
  status: DevicePairingCodeStatus;
  expiresAt: string;
  claimedByDeviceId: string | null;
  claimedAt: string | null;
  createdAt: string;
}

export interface AuthorityTopology {
  runtime: {
    authorityMode: RuntimeConfig['authorityMode'];
    hubUrl: string | null;
    siteId: string | null;
    deviceId: string | null;
    bindHost: string;
    bindPort: number;
    allowedLanOrigins: string[];
  };
  hub: {
    dbSchemaVersion: number | null;
    activeDeviceCount: number;
    tenantActiveDeviceCount: number;
  };
  summary: {
    total: number;
    online: number;
    stale: number;
    revoked: number;
    hubClients: number;
    authorityNodes: number;
    webClients: number;
  };
  devices: AuthorityDeviceSummary[];
  pairingCodes: AuthorityPairingSummary[];
}
