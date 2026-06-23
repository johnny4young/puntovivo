/**
 * ENG-075 Authority Node topology projection: devices + pairing codes +
 * health summary read for the Operations Center Authority tab.
 *
 * @module services/devices/authority/topology
 */

import { and, desc, eq } from 'drizzle-orm';
import type { RuntimeConfig } from '../../../config/runtime.js';
import type { DatabaseInstance } from '../../../db/index.js';
import { devicePairingCodes, devices, sites } from '../../../db/schema.js';
import { countActiveDevices, getCurrentSchemaVersion } from '../../../lib/runtimeMetadata.js';
import { deriveHealthStatus, inferAuthorityRole } from './helpers.js';
import type { AuthorityDeviceSummary, AuthorityTopology } from './types.js';

export async function getAuthorityTopology(
  db: DatabaseInstance,
  tenantId: string,
  runtime: RuntimeConfig,
  now: Date = new Date()
): Promise<AuthorityTopology> {
  const rows = await db
    .select({
      id: devices.id,
      name: devices.name,
      kind: devices.kind,
      authorityRole: devices.authorityRole,
      pairedSiteId: devices.pairedSiteId,
      pairedSiteName: sites.name,
      lastSeenAt: devices.lastSeenAt,
      appVersion: devices.appVersion,
      dbSchemaVersion: devices.dbSchemaVersion,
      isActive: devices.isActive,
      createdAt: devices.createdAt,
    })
    .from(devices)
    .leftJoin(sites, and(eq(sites.id, devices.pairedSiteId), eq(sites.tenantId, tenantId)))
    .where(eq(devices.tenantId, tenantId))
    .orderBy(desc(devices.isActive), desc(devices.lastSeenAt), desc(devices.createdAt));

  const deviceSummaries = rows.map(row => {
    const authorityRole = row.authorityRole ?? inferAuthorityRole(row.kind);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind,
      authorityRole,
      pairedSiteId: row.pairedSiteId,
      pairedSiteName: row.pairedSiteName,
      lastSeenAt: row.lastSeenAt,
      appVersion: row.appVersion,
      dbSchemaVersion: row.dbSchemaVersion,
      healthStatus: deriveHealthStatus(row, now),
      isActive: row.isActive,
      createdAt: row.createdAt,
    } satisfies AuthorityDeviceSummary;
  });

  const pairingRows = await db
    .select({
      id: devicePairingCodes.id,
      siteId: devicePairingCodes.siteId,
      siteName: sites.name,
      deviceName: devicePairingCodes.deviceName,
      status: devicePairingCodes.status,
      expiresAt: devicePairingCodes.expiresAt,
      claimedByDeviceId: devicePairingCodes.claimedByDeviceId,
      claimedAt: devicePairingCodes.claimedAt,
      createdAt: devicePairingCodes.createdAt,
    })
    .from(devicePairingCodes)
    .leftJoin(sites, and(eq(sites.id, devicePairingCodes.siteId), eq(sites.tenantId, tenantId)))
    .where(eq(devicePairingCodes.tenantId, tenantId))
    .orderBy(desc(devicePairingCodes.createdAt))
    .limit(20);

  const summary = deviceSummaries.reduce(
    (acc, device) => {
      acc.total += 1;
      if (device.healthStatus === 'online') acc.online += 1;
      if (device.healthStatus === 'stale') acc.stale += 1;
      if (device.healthStatus === 'revoked') acc.revoked += 1;
      if (device.authorityRole === 'hub_client') acc.hubClients += 1;
      if (device.authorityRole === 'authority_node') acc.authorityNodes += 1;
      if (device.authorityRole === 'web_client') acc.webClients += 1;
      return acc;
    },
    {
      total: 0,
      online: 0,
      stale: 0,
      revoked: 0,
      hubClients: 0,
      authorityNodes: 0,
      webClients: 0,
    }
  );

  return {
    runtime: {
      authorityMode: runtime.authorityMode,
      hubUrl: runtime.hubUrl,
      siteId: runtime.siteId,
      deviceId: runtime.deviceId,
      bindHost: runtime.bindHost,
      bindPort: runtime.bindPort,
      allowedLanOrigins: runtime.allowedLanOrigins,
    },
    hub: {
      dbSchemaVersion: getCurrentSchemaVersion(db),
      activeDeviceCount: countActiveDevices(db),
      tenantActiveDeviceCount: deviceSummaries.filter(device => device.isActive).length,
    },
    summary,
    devices: deviceSummaries,
    pairingCodes: pairingRows.map(row => ({
      ...row,
      status:
        row.status === 'pending' && Date.parse(row.expiresAt) <= now.getTime()
          ? 'expired'
          : row.status,
    })),
  };
}
