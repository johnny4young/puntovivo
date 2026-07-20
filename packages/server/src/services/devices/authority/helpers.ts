/**
 * Shared helpers for the  Authority Node service: role inference,
 * pairing-code crypto/format/TTL, health derivation, tenant-site guard,
 * and pending-code expiry.
 *
 * @module services/devices/authority/helpers
 */

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, lte } from 'drizzle-orm';
import type { DatabaseInstance } from '../../../db/index.js';
import {
  devicePairingCodes,
  sites,
  type DeviceAuthorityRole,
  type DeviceKind,
} from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import {
  DEVICE_STALE_AFTER_MS,
  MAX_PAIRING_CODE_TTL_MINUTES,
  PAIRING_ALPHABET,
  PAIRING_CODE_LENGTH,
  PAIRING_CODE_TTL_MINUTES,
} from './constants.js';
import type { AuthorityHealthStatus } from './types.js';

export function inferAuthorityRole(kind: DeviceKind): DeviceAuthorityRole {
  if (kind === 'hub_client') return 'hub_client';
  if (kind === 'web') return 'web_client';
  return 'authority_node';
}

function normalizePairingCode(code: string): string {
  return code.replace(/[\s-]/g, '').trim().toUpperCase();
}

export function hashPairingCode(tenantId: string, code: string): string {
  return createHash('sha256')
    .update(`${tenantId}:${normalizePairingCode(code)}`)
    .digest('hex');
}

function formatPairingCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function generatePairingCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let code = '';
  for (const byte of bytes) {
    code += PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length];
  }
  return formatPairingCode(code);
}

export function addMinutes(now: Date, minutes: number): Date {
  return new Date(now.getTime() + minutes * 60_000);
}

export function clampTtl(minutes: number | undefined): number {
  if (!Number.isFinite(minutes)) return PAIRING_CODE_TTL_MINUTES;
  return Math.max(
    1,
    Math.min(Math.trunc(minutes ?? PAIRING_CODE_TTL_MINUTES), MAX_PAIRING_CODE_TTL_MINUTES)
  );
}

export function deriveHealthStatus(
  row: { isActive: boolean; lastSeenAt: string | null },
  now: Date
): AuthorityHealthStatus {
  if (!row.isActive) return 'revoked';
  if (!row.lastSeenAt) return 'stale';
  const lastSeenMs = Date.parse(row.lastSeenAt);
  if (!Number.isFinite(lastSeenMs)) return 'stale';
  return now.getTime() - lastSeenMs > DEVICE_STALE_AFTER_MS ? 'stale' : 'online';
}

export async function expirePendingCodes(
  db: DatabaseInstance,
  tenantId: string,
  now: Date
): Promise<void> {
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
