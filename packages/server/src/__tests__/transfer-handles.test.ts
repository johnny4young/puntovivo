/** Transfer handles shown at checkout: storage, roles, tenant isolation, audit. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, tenants, users } from '../db/schema.js';
import {
  normalizeTransferHandleSettings,
  transferQrSource,
} from '../services/payments/transfer-handles.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

type Role = 'admin' | 'manager' | 'cashier' | 'viewer';

function callerFor(tenantId: string, userId: string, role: Role) {
  const user = { id: userId, email: `${role}@example.com`, role, tenantId };
  return appRouter.createCaller({
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: user.email, role, tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user,
    tenantId,
    siteId: null,
  } as Context);
}

async function seedTenant(settings: Record<string, unknown> = {}) {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `th-${nanoid(6)}`;
  await db.insert(tenants).values({
    id: tenantId,
    name: `Transfer ${tenantId}`,
    slug: tenantId,
    settings,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const ids = {} as Record<Role, string>;
  for (const role of ['admin', 'manager', 'cashier', 'viewer'] as const) {
    ids[role] = nanoid();
    await db.insert(users).values({
      id: ids[role],
      tenantId,
      email: `${role}-${tenantId}@example.com`,
      passwordHash: 'not-used',
      name: role,
      role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { tenantId, ids };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  if (server) await server.close();
});

describe('paymentSettings transfer handles', () => {
  it('reads as not configured for a fresh tenant', async () => {
    const { tenantId, ids } = await seedTenant();
    const result = await callerFor(
      tenantId,
      ids.cashier,
      'cashier'
    ).paymentSettings.transferHandles();
    expect(result).toEqual({ handles: [], qrPayload: null, qrSource: null });
  });

  it('lets an admin save handles that the cashier then reads, keeping other settings', async () => {
    const { tenantId, ids } = await seedTenant({ restaurant: { serviceChargeRate: 10 } });
    const saved = await callerFor(
      tenantId,
      ids.admin,
      'admin'
    ).paymentSettings.updateTransferHandles({
      handles: [
        { kind: 'breb', value: '  @tiendaprueba ' },
        { kind: 'nequi', value: '3000000000' },
      ],
    });
    expect(saved.handles).toEqual([
      { kind: 'breb', value: '@tiendaprueba' },
      { kind: 'nequi', value: '3000000000' },
    ]);
    expect(saved.qrSource).toBe('@tiendaprueba');

    const read = await callerFor(
      tenantId,
      ids.cashier,
      'cashier'
    ).paymentSettings.transferHandles();
    expect(read.handles).toHaveLength(2);

    const row = getDatabase()
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    expect((row?.settings as Record<string, unknown>).restaurant).toEqual({
      serviceChargeRate: 10,
    });
  });

  it('encodes the bank QR content when one is stored and clears on an empty save', async () => {
    const { tenantId, ids } = await seedTenant();
    const admin = callerFor(tenantId, ids.admin, 'admin');
    const withPayload = await admin.paymentSettings.updateTransferHandles({
      handles: [{ kind: 'bank', value: '000-111' }],
      qrPayload: '00020101021226',
    });
    expect(withPayload.qrSource).toBe('00020101021226');

    const cleared = await admin.paymentSettings.updateTransferHandles({ handles: [] });
    expect(cleared).toEqual({ handles: [], qrPayload: null, qrSource: null });
  });

  it('rejects writes from non-admins and reads from viewers', async () => {
    const { tenantId, ids } = await seedTenant();
    for (const role of ['manager', 'cashier'] as const) {
      await expect(
        callerFor(tenantId, ids[role], role).paymentSettings.updateTransferHandles({
          handles: [{ kind: 'nequi', value: '3000000001' }],
        })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await expect(
      callerFor(tenantId, ids.viewer, 'viewer').paymentSettings.transferHandles()
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects malformed input', async () => {
    const { tenantId, ids } = await seedTenant();
    const admin = callerFor(tenantId, ids.admin, 'admin');
    await expect(
      admin.paymentSettings.updateTransferHandles({ handles: [{ kind: 'nequi', value: '   ' }] })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    await expect(
      admin.paymentSettings.updateTransferHandles({
        handles: Array.from({ length: 5 }, (_, index) => ({
          kind: 'other' as const,
          value: `key-${index}`,
        })),
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('never leaks one tenant handles into another', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    await callerFor(a.tenantId, a.ids.admin, 'admin').paymentSettings.updateTransferHandles({
      handles: [{ kind: 'daviplata', value: '3000000002' }],
    });
    const other = await callerFor(
      b.tenantId,
      b.ids.admin,
      'admin'
    ).paymentSettings.transferHandles();
    expect(other.handles).toEqual([]);
  });

  it('records who changed the handles', async () => {
    const { tenantId, ids } = await seedTenant();
    await callerFor(tenantId, ids.admin, 'admin').paymentSettings.updateTransferHandles({
      handles: [{ kind: 'breb', value: '@auditada' }],
    });
    const rows = getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, 'payment.transfer_handles.updated')
        )
      )
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorId).toBe(ids.admin);
  });
});

describe('normalizeTransferHandleSettings', () => {
  it('drops malformed entries instead of throwing', () => {
    const settings = normalizeTransferHandleSettings({
      handles: [null, { kind: 'wire', value: 'x' }, { kind: 'nequi', value: ' 300 ' }, 'text'],
      qrPayload: '  ',
    });
    expect(settings).toEqual({ handles: [{ kind: 'nequi', value: '300' }], qrPayload: null });
    expect(transferQrSource(settings)).toBe('300');
    expect(normalizeTransferHandleSettings('garbage')).toEqual({ handles: [], qrPayload: null });
  });
});
