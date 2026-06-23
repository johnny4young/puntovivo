/**
 * ENG-075 pairing-code lifecycle: create + claim (claim is ENG-168
 * transactional with an in-tx audit row).
 *
 * @module services/devices/authority/pairing
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../../db/index.js';
import { devicePairingCodes, devices } from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import { writeAuditLog } from '../../audit-logs.js';
import {
  addMinutes,
  assertTenantSite,
  clampTtl,
  expirePendingCodes,
  generatePairingCode,
  hashPairingCode,
} from './helpers.js';
import type { PairingCodeCreated } from './types.js';

export async function createPairingCode(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    siteId: string;
    createdByUserId: string;
    // ENG-179b — explicit `| undefined` on Zod-optional fields.
    deviceName?: string | undefined;
    expiresInMinutes?: number | undefined;
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

  throwServerError({
    trpcCode: 'INTERNAL_SERVER_ERROR',
    errorCode: 'DEVICE_PAIRING_CODE_ALLOCATION_EXHAUSTED',
    message: 'Unable to allocate unique device pairing code',
    details: { tenantId: args.tenantId, siteId: args.siteId, attempts: 3 },
  });
}

export async function claimPairingCodeForDevice(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    code: string;
    deviceId: string;
    /**
     * ENG-168 — the authenticated user who is claiming the pairing
     * code on behalf of the device. When supplied, a
     * `device.pairing.claimed` audit row lands inside the same
     * transaction as the device + pairing_code mutations. Made
     * optional so callers that already have a tenant context but
     * no user (currently none in-tree, future automation) do not
     * break; the audit row is simply skipped in that case.
     */
    actorUserId?: string;
  },
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
      and(eq(devicePairingCodes.tenantId, args.tenantId), eq(devicePairingCodes.codeHash, codeHash))
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
      .where(
        and(eq(devicePairingCodes.tenantId, args.tenantId), eq(devicePairingCodes.id, row.id))
      );
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
      .where(
        and(
          eq(devicePairingCodes.tenantId, args.tenantId),
          eq(devicePairingCodes.id, row.id),
          eq(devicePairingCodes.status, 'pending')
        )
      )
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

    // ENG-168 — emit the audit row inside the same transaction so a
    // claim that ultimately rolls back (e.g. constraint violation on
    // the devices UPDATE above) does not leave an orphan audit
    // entry. Mask the pairing code down to its last 4 characters in
    // metadata so the audit trail can correlate a handover ticket
    // without leaking the full secret.
    if (args.actorUserId) {
      writeAuditLog({
        tx,
        tenantId: args.tenantId,
        actorId: args.actorUserId,
        action: 'device.pairing.claimed',
        resourceType: 'device',
        resourceId: args.deviceId,
        metadata: {
          pairingCodeMasked: args.code.slice(-4),
          siteId: row.siteId,
          kind: device.kind,
        },
      });
    }
  });

  return { deviceId: args.deviceId, siteId: row.siteId };
}
