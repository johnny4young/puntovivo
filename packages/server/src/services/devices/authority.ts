/**
 * ENG-075 — Authority Node device pairing and health projection.
 *
 * Pairing codes are tenant-scoped, one-time, and stored only as a
 * SHA-256 hash. The Operations Center Authority tab reads the topology
 * projection from this module so diagnostics export and UI stay aligned.
 *
 * @module services/devices/authority
 */

import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { RuntimeConfig } from '../../config/runtime.js';
import type { DatabaseInstance } from '../../db/index.js';
import {
  devicePairingCodes,
  devices,
  sites,
  type DeviceAuthorityRole,
  type DeviceKind,
  type DevicePairingCodeStatus,
} from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { countActiveDevices, getCurrentSchemaVersion } from '../../lib/runtimeMetadata.js';

const PAIRING_CODE_TTL_MINUTES = 10;
const MAX_PAIRING_CODE_TTL_MINUTES = 60;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_LENGTH = 8;
const DEVICE_STALE_AFTER_MS = 15 * 60 * 1000;

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

export function inferAuthorityRole(kind: DeviceKind): DeviceAuthorityRole {
  if (kind === 'hub_client') return 'hub_client';
  if (kind === 'web') return 'web_client';
  return 'authority_node';
}

function normalizePairingCode(code: string): string {
  return code.replace(/[\s-]/g, '').trim().toUpperCase();
}

function hashPairingCode(tenantId: string, code: string): string {
  return createHash('sha256')
    .update(`${tenantId}:${normalizePairingCode(code)}`)
    .digest('hex');
}

function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

function generatePairingCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
  }
  return formatPairingCode(code);
}

function addMinutes(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

function clampTtl(minutes: number | undefined): number {
  if (!Number.isFinite(minutes)) return PAIRING_CODE_TTL_MINUTES;
  return Math.max(1, Math.min(Math.trunc(minutes ?? PAIRING_CODE_TTL_MINUTES), MAX_PAIRING_CODE_TTL_MINUTES));
}

function deriveHealthStatus(
  row: { isActive: boolean; lastSeenAt: string | null },
  now: Date
): AuthorityHealthStatus {
  if (!row.isActive) return 'revoked';
  if (!row.lastSeenAt) return 'stale';
  const lastSeenMs = Date.parse(row.lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) return 'stale';
  return now.getTime() - lastSeenMs > DEVICE_STALE_AFTER_MS ? 'stale' : 'online';
}

async function expirePendingCodes(db: DatabaseInstance, tenantId: string, now: Date): Promise<void> {
  const nowIso = now.toISOString();
  await db
    .update(devicePairingCodes)
    .set({ status: 'expired', updatedAt: nowIso })
    .where(
      and(
        eq(devicePairingCodes.tenantId, tenantId),
        eq(devicePairingCodes.status, 'pending'),
        lte(devicePairingCodes.expiresAt, nowIso)
      )
    );
}

export async function assertTenantSite(
  db: DatabaseInstance,
  tenantId: string,
  siteId: string
): Promise<{ id: string; name: string }> {
  const site = await db
    .select({ id: sites.id, name: sites.name, isActive: sites.isActive })
    .from(sites)
    .where(and(eq(sites.id, siteId), eq(sites.tenantId, tenantId)))
    .get();

  if (!site || site.isActive === false) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'AUTHORITY_SITE_NOT_FOUND',
      message: 'Pairing site was not found for this tenant',
      details: { siteId },
    });
  }

  return { id: site.id, name: site.name };
}

export async function createPairingCode(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    createdByUserId: string;
    deviceName?: string;
    expiresInMinutes?: number;
  },
  now: Date = new Date()
): Promise<PairingCodeCreated> {
  await assertTenantSite(db, args.tenantId, args.siteId);
  await expirePendingCodes(db, args.tenantId, now);

  const ttl = clampTtl(args.expiresInMinutes);
  const expiresAt = addMinutes(now, ttl).toISOString();
  const createdAt = now.toISOString();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = generatePairingCode();
    const codeHash = hashPairingCode(args.tenantId, code);
    const existing = await db
      .select({ id: devicePairingCodes.id })
      .from(devicePairingCodes)
      .where(eq(devicePairingCodes.codeHash, codeHash))
      .get();
    if (existing) continue;

    const id = nanoid();
    await db.insert(devicePairingCodes).values({
      id,
      tenantId: args.tenantId,
      siteId: args.siteId,
      codeHash,
      deviceName: args.deviceName ?? null,
      status: 'pending',
      createdByUserId: args.createdByUserId,
      claimedByDeviceId: null,
      expiresAt,
      claimedAt: null,
      createdAt,
      updatedAt: createdAt,
    });
    return { id, code, siteId: args.siteId, expiresAt };
  }

  throw new Error('Unable to allocate unique device pairing code');
}

export async function claimPairingCodeForDevice(
  db: DatabaseInstance,
  args: { tenantId: string; code: string; deviceId: string },
  now: Date = new Date()
): Promise<{ deviceId: string; siteId: string }> {
  const codeHash = hashPairingCode(args.tenantId, args.code);
  const row = await db
    .select({
      id: devicePairingCodes.id,
      tenantId: devicePairingCodes.tenantId,
      siteId: devicePairingCodes.siteId,
      status: devicePairingCodes.status,
      expiresAt: devicePairingCodes.expiresAt,
    })
    .from(devicePairingCodes)
    .where(
      and(
        eq(devicePairingCodes.tenantId, args.tenantId),
        eq(devicePairingCodes.codeHash, codeHash)
      )
    )
    .get();

  if (!row) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'AUTHORITY_PAIRING_CODE_INVALID',
      message: 'Pairing code is invalid',
    });
  }

  if (row.status !== 'pending') {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'AUTHORITY_PAIRING_CODE_USED',
      message: 'Pairing code has already been used or revoked',
      details: { status: row.status },
    });
  }

  if (Date.parse(row.expiresAt) <= now.getTime()) {
    await db
      .update(devicePairingCodes)
      .set({ status: 'expired', updatedAt: now.toISOString() })
      .where(eq(devicePairingCodes.id, row.id));
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'AUTHORITY_PAIRING_CODE_EXPIRED',
      message: 'Pairing code has expired',
    });
  }

  const device = await db
    .select({ id: devices.id, kind: devices.kind, isActive: devices.isActive })
    .from(devices)
    .where(and(eq(devices.tenantId, args.tenantId), eq(devices.id, args.deviceId)))
    .get();

  if (!device || !device.isActive) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'DEVICE_NOT_REGISTERED',
      message: 'Device is not registered for this tenant',
      details: { deviceId: args.deviceId },
    });
  }

  if (device.kind !== 'hub_client') {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'AUTHORITY_DEVICE_NOT_REVOKABLE',
      message: 'Only hub client devices can consume pairing codes',
      details: { deviceId: args.deviceId, kind: device.kind },
    });
  }

  const nowIso = now.toISOString();
  db.transaction(tx => {
    const claimResult = tx
      .update(devicePairingCodes)
      .set({
        status: 'claimed',
        claimedByDeviceId: args.deviceId,
        claimedAt: nowIso,
        updatedAt: nowIso,
      })
      .where(and(eq(devicePairingCodes.id, row.id), eq(devicePairingCodes.status, 'pending')))
      .run();

    if (claimResult.changes !== 1) {
      throwServerError({
        trpcCode: 'CONFLICT',
        errorCode: 'AUTHORITY_PAIRING_CODE_USED',
        message: 'Pairing code has already been used or revoked',
        details: { status: row.status },
      });
    }

    tx.update(devices)
      .set({
        authorityRole: 'hub_client',
        pairedSiteId: row.siteId,
        lastSeenAt: nowIso,
        updatedAt: nowIso,
      })
      .where(and(eq(devices.tenantId, args.tenantId), eq(devices.id, args.deviceId)))
      .run();
  });

  return { deviceId: args.deviceId, siteId: row.siteId };
}

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
