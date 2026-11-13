import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { describe, expect, it } from 'vitest';
import { createServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { devices, idempotencyKeys, tenants, users } from '../db/schema.js';
import { reserveKey } from '../services/idempotency/idempotencyService.js';

describe('server boot after a crash', () => {
  it('releases sale reservations a dead process left in processing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'puntovivo-boot-release-'));
    const dbPath = join(dir, 'boot.db');
    const tenantId = nanoid();
    const userId = nanoid();
    const deviceId = nanoid();
    const key = nanoid();
    try {
      const first = await createServer({ dbPath, verbose: false });
      const db = getDatabase();
      const now = new Date().toISOString();
      await db.insert(tenants).values({
        id: tenantId,
        name: 'Boot Release',
        slug: `boot-${tenantId.slice(0, 6)}`,
        settings: {},
        isActive: true,
      });
      await db.insert(users).values({
        id: userId,
        tenantId,
        email: `boot-${userId.slice(0, 6)}@test.local`,
        passwordHash: 'unused',
        name: 'Boot Release',
        role: 'admin',
        isActive: true,
      });
      await db.insert(devices).values({
        id: deviceId,
        tenantId,
        kind: 'web',
        name: 'boot-device',
        registeredByUserId: userId,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const reservation = await reserveKey(db, {
        tenantId,
        deviceId,
        idempotencyKey: key,
        operationKind: 'sales.create',
        requestHash: 'hash-boot',
      });
      expect(reservation.state).toBe('reserved');
      await first.close();

      const second = await createServer({ dbPath, verbose: false });
      try {
        const [row] = await getDatabase()
          .select({ status: idempotencyKeys.status })
          .from(idempotencyKeys)
          .where(eq(idempotencyKeys.idempotencyKey, key));
        expect(row?.status).toBe('failed');
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
