import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  aiAuditLog,
  auditLogs,
  syncOutbox,
  systemAuditLogs,
  tenants,
  users,
} from '../db/schema.js';
import { createDataRetentionCleanup } from '../services/cleanup/dataRetentionCleanup.js';
import {
  DEFAULT_DATA_RETENTION_POLICY,
  normalizeDataRetentionPolicy,
} from '../services/data-retention.js';
import type { Context } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function context(role: 'admin' | 'manager' | 'cashier', scopedTenant = tenantId): Context {
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'admin@localhost', role, tenantId: scopedTenant },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: 'admin@localhost', role, tenantId: scopedTenant },
    tenantId: scopedTenant,
    siteId: null,
  };
}

async function seedRetentionRows(
  forTenant: string,
  actorId: string,
  prefix: string
): Promise<void> {
  const db = getDatabase();
  await db.insert(auditLogs).values([
    {
      id: `${prefix}-operational-old`,
      tenantId: forTenant,
      actorId,
      action: 'sale.void',
      resourceType: 'sale',
      resourceId: `${prefix}-sale`,
      createdAt: daysAgo(500),
    },
    {
      id: `${prefix}-privacy-old`,
      tenantId: forTenant,
      actorId,
      action: 'customer.personal_data.export',
      resourceType: 'customer',
      resourceId: `${prefix}-customer`,
      createdAt: daysAgo(800),
    },
    {
      id: `${prefix}-recent`,
      tenantId: forTenant,
      actorId,
      action: 'sale.return',
      resourceType: 'sale',
      resourceId: `${prefix}-recent-sale`,
      createdAt: daysAgo(10),
    },
  ]);
  await db.insert(aiAuditLog).values({
    id: `${prefix}-ai-old`,
    tenantId: forTenant,
    siteId: null,
    userId: actorId,
    feature: 'copilot',
    providerId: 'openai',
    modelId: 'fixture',
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
    durationMs: 1,
    errorCode: null,
    createdAt: daysAgo(60),
  });
  await db.insert(syncOutbox).values([
    {
      id: `${prefix}-sync-old`,
      tenantId: forTenant,
      status: 'synced',
      entityType: 'customers',
      entityId: `${prefix}-customer`,
      operation: 'update',
      conflictPolicy: 'auto_lww',
      payload: { safe: true },
      createdAt: daysAgo(40),
      updatedAt: daysAgo(40),
    },
    {
      id: `${prefix}-sync-pending`,
      tenantId: forTenant,
      status: 'queued',
      entityType: 'customers',
      entityId: `${prefix}-pending-customer`,
      operation: 'update',
      conflictPolicy: 'auto_lww',
      payload: { mustSurvive: true },
      createdAt: daysAgo(40),
      updatedAt: daysAgo(40),
    },
  ]);
}

beforeEach(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const admin = await getDatabase()
    .select()
    .from(users)
    .where(eq(users.email, 'admin@localhost'))
    .get();
  if (!admin) throw new Error('Expected seeded admin user');
  tenantId = admin.tenantId;
  userId = admin.id;
});

afterEach(async () => {
  await server.close();
});

describe('data retention', () => {
  it('normalizes malformed persisted settings without shortening the safe defaults', () => {
    expect(
      normalizeDataRetentionPolicy({
        operationalAuditDays: -1,
        privacyAuditDays: 30,
        aiAuditDays: Number.NaN,
        syncedOutboxDays: 9999,
      })
    ).toEqual(DEFAULT_DATA_RETENTION_POLICY);
  });

  it('persists a bounded policy, preserves sibling settings, and audits the change', async () => {
    const db = getDatabase();
    await db
      .update(tenants)
      .set({ settings: { telemetryOptIn: true } })
      .where(eq(tenants.id, tenantId));
    const caller = appRouter.createCaller(context('admin'));
    const policy = {
      operationalAuditDays: 365,
      privacyAuditDays: 730,
      aiAuditDays: 30,
      syncedOutboxDays: 7,
    };

    expect((await caller.dataRetention.update(policy)).policy).toEqual(policy);
    expect((await caller.dataRetention.get()).policy).toEqual(policy);
    const tenant = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    expect(tenant?.settings).toMatchObject({ telemetryOptIn: true, dataRetention: policy });
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.tenantId, tenantId),
            eq(auditLogs.action, 'data_retention.policy.updated')
          )
        )
        .get()
    ).toMatchObject({ before: DEFAULT_DATA_RETENTION_POLICY, after: policy });
  });

  it('previews and sweeps only expired rows for the current tenant', async () => {
    const db = getDatabase();
    const foreignTenantId = `tenant-retention-${nanoid(6)}`;
    const foreignUserId = `user-retention-${nanoid(6)}`;
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign retention tenant',
      slug: `foreign-retention-${nanoid(6)}`,
      settings: {},
      isActive: true,
    });
    await db.insert(users).values({
      id: foreignUserId,
      tenantId: foreignTenantId,
      email: `foreign-retention-${nanoid(6)}@example.com`,
      name: 'Foreign Admin',
      passwordHash: 'fixture',
      role: 'admin',
      isActive: true,
    });

    const caller = appRouter.createCaller(context('admin'));
    await caller.dataRetention.update({
      operationalAuditDays: 365,
      privacyAuditDays: 730,
      aiAuditDays: 30,
      syncedOutboxDays: 7,
    });
    await seedRetentionRows(tenantId, userId, 'local');
    await seedRetentionRows(foreignTenantId, foreignUserId, 'foreign');

    const preview = await caller.dataRetention.preview();
    expect(preview).toMatchObject({
      operationalAuditLogs: { count: 1 },
      privacyAuditLogs: { count: 1 },
      aiAuditLogs: { count: 1 },
      syncedOutboxRows: { count: 1 },
      total: 4,
    });

    const result = await caller.dataRetention.runNow();
    expect(result.deleted).toEqual({
      operationalAuditLogs: 1,
      privacyAuditLogs: 1,
      aiAuditLogs: 1,
      syncedOutboxRows: 1,
      total: 4,
    });
    expect(
      await db.select().from(auditLogs).where(eq(auditLogs.id, 'local-recent')).get()
    ).toBeTruthy();
    expect(
      await db.select().from(syncOutbox).where(eq(syncOutbox.id, 'local-sync-pending')).get()
    ).toBeTruthy();
    expect(
      await db.select().from(auditLogs).where(eq(auditLogs.id, 'foreign-operational-old')).get()
    ).toBeTruthy();
    expect(
      await db.select().from(aiAuditLog).where(eq(aiAuditLog.id, 'foreign-ai-old')).get()
    ).toBeTruthy();
    expect(
      await db
        .select()
        .from(auditLogs)
        .where(eq(auditLogs.action, 'data_retention.sweep.run'))
        .get()
    ).toMatchObject({ tenantId, metadata: { deleted: result.deleted } });
  });

  it('rejects unsafe policy ranges and non-admin callers', async () => {
    const admin = appRouter.createCaller(context('admin'));
    await expect(
      admin.dataRetention.update({
        operationalAuditDays: 365,
        privacyAuditDays: 364,
        aiAuditDays: 30,
        syncedOutboxDays: 7,
      })
    ).rejects.toThrow(/Privacy audit retention/);
    await expect(appRouter.createCaller(context('manager')).dataRetention.get()).rejects.toThrow();
    await expect(
      appRouter.createCaller(context('cashier')).dataRetention.runNow()
    ).rejects.toThrow();
  });

  it('rolls back a manual sweep when its audit evidence cannot be written', async () => {
    const db = getDatabase();
    const caller = appRouter.createCaller(context('admin'));
    await caller.dataRetention.update({
      operationalAuditDays: 365,
      privacyAuditDays: 730,
      aiAuditDays: 30,
      syncedOutboxDays: 7,
    });
    await seedRetentionRows(tenantId, userId, 'atomic');
    db.run(sql`
      CREATE TRIGGER fail_retention_sweep_audit
      BEFORE INSERT ON audit_logs
      WHEN NEW.action = 'data_retention.sweep.run'
      BEGIN
        SELECT RAISE(ABORT, 'forced retention audit failure');
      END
    `);

    await expect(caller.dataRetention.runNow()).rejects.toThrow(/forced retention audit failure/);
    expect(
      await db.select().from(auditLogs).where(eq(auditLogs.id, 'atomic-operational-old')).get()
    ).toBeTruthy();
    expect(
      await db.select().from(aiAuditLog).where(eq(aiAuditLog.id, 'atomic-ai-old')).get()
    ).toBeTruthy();
    expect(
      await db.select().from(syncOutbox).where(eq(syncOutbox.id, 'atomic-sync-old')).get()
    ).toBeTruthy();
  });

  it('automatic worker sweeps active tenants and records aggregate system evidence', async () => {
    const caller = appRouter.createCaller(context('admin'));
    await caller.dataRetention.update({
      operationalAuditDays: 365,
      privacyAuditDays: 730,
      aiAuditDays: 30,
      syncedOutboxDays: 7,
    });
    await seedRetentionRows(tenantId, userId, 'worker');
    const worker = createDataRetentionCleanup({ db: getDatabase() });
    const tick = worker.tickOnce();
    await worker.stop();
    const result = await tick;

    expect(result.tenantCount).toBeGreaterThanOrEqual(1);
    expect(result.deleted.total).toBe(4);
    expect(
      await getDatabase()
        .select()
        .from(systemAuditLogs)
        .where(eq(systemAuditLogs.action, 'data_retention.cleanup'))
        .get()
    ).toMatchObject({
      resourceType: 'data_retention',
      status: 'ok',
      metadata: expect.objectContaining({ deleted: result.deleted }),
    });
  });

  it('records truthful progress when an automatic sweep fails', async () => {
    const caller = appRouter.createCaller(context('admin'));
    await caller.dataRetention.update({
      operationalAuditDays: 365,
      privacyAuditDays: 730,
      aiAuditDays: 30,
      syncedOutboxDays: 7,
    });
    await seedRetentionRows(tenantId, userId, 'worker-failure');
    const db = getDatabase();
    db.run(sql`
      CREATE TRIGGER fail_retention_cleanup_delete
      BEFORE DELETE ON audit_logs
      WHEN OLD.id = 'worker-failure-operational-old'
      BEGIN
        SELECT RAISE(ABORT, 'forced retention cleanup failure');
      END
    `);

    const worker = createDataRetentionCleanup({ db });
    await expect(worker.tickOnce()).rejects.toThrow(/forced retention cleanup failure/);
    expect(
      await db
        .select()
        .from(systemAuditLogs)
        .where(
          and(
            eq(systemAuditLogs.action, 'data_retention.cleanup'),
            eq(systemAuditLogs.status, 'error')
          )
        )
        .get()
    ).toMatchObject({
      metadata: {
        tenantCount: expect.any(Number),
        completedTenantCount: 0,
        deleted: {
          operationalAuditLogs: 0,
          privacyAuditLogs: 0,
          aiAuditLogs: 0,
          syncedOutboxRows: 0,
          total: 0,
        },
        error: expect.objectContaining({
          message: expect.stringContaining('forced retention cleanup failure'),
        }),
      },
    });
    await worker.stop();
  });
});
