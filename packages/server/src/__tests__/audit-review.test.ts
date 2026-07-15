import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, tenants, users } from '../db/schema.js';
import { getAuditReviewActions } from '../services/audit-review.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;

function createTestContext(role = 'admin'): Context {
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId,
        email: 'admin@localhost',
        role,
        tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: {
      id: userId,
      email: 'admin@localhost',
      role,
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

async function insertAudit(
  action: (typeof auditLogs.$inferInsert)['action'],
  createdAt: string,
  rowTenantId = tenantId
): Promise<void> {
  await getDatabase().insert(auditLogs).values({
    id: nanoid(),
    tenantId: rowTenantId,
    actorId: userId,
    action,
    resourceType: 'tenant',
    resourceId: nanoid(),
    before: null,
    after: null,
    metadata: null,
    createdAt,
  });
}

describe('sensitive audit review (ENG-129f)', () => {
  it('classifies launch party imports by operational risk', () => {
    expect(getAuditReviewActions('privacy')).toContain('data_import.customers');
    expect(getAuditReviewActions('inventory')).toContain('data_import.providers');
    expect(getAuditReviewActions('money')).toContain('data_import.customer_balances');
    expect(getAuditReviewActions('money')).toContain('data_import.opening_cash');
    expect(getAuditReviewActions('inventory')).not.toContain('data_import.customers');
  });

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin');
    tenantId = admin.tenantId;
    userId = admin.id;

    await db.delete(auditLogs);

    const foreignTenantId = `tenant-${nanoid()}`;
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: foreignTenantId,
      name: 'Foreign audit tenant',
      slug: `foreign-audit-${nanoid(6)}`,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await insertAudit('customer.personal_data.export', '2026-01-10T10:00:00.000Z');
    await insertAudit('customer.personal_data.delete', '2026-01-11T10:00:00.000Z');
    await insertAudit('user.update', '2026-01-12T10:00:00.000Z');
    await insertAudit('sale.void', '2026-01-13T10:00:00.000Z');
    await insertAudit('cash_drawer.open', '2026-01-13T11:00:00.000Z');
    await insertAudit('sale.complete', '2026-01-14T10:00:00.000Z');
    await insertAudit('inventory.adjust_stock', '2026-01-15T10:00:00.000Z');
    await insertAudit('data_import.products', '2026-01-15T11:00:00.000Z');
    await insertAudit('ai.copilot.query', '2026-01-16T10:00:00.000Z');
    await insertAudit('customer.personal_data.export', '2026-01-17T10:00:00.000Z', foreignTenantId);
    await insertAudit('backup.restore_drill', '2026-01-18T10:00:00.000Z');
  });

  afterAll(async () => {
    await server.close();
  });

  it('returns stable category counts and excludes routine or foreign-tenant rows', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const summary = await caller.auditLogs.sensitiveSummary();

    expect(summary.total).toBe(9);
    expect(summary.categories).toEqual([
      {
        category: 'privacy',
        count: 2,
        latestAt: '2026-01-11T10:00:00.000Z',
      },
      {
        category: 'access',
        count: 2,
        latestAt: '2026-01-18T10:00:00.000Z',
      },
      {
        category: 'money',
        count: 2,
        latestAt: '2026-01-13T11:00:00.000Z',
      },
      {
        category: 'inventory',
        count: 2,
        latestAt: '2026-01-15T11:00:00.000Z',
      },
      {
        category: 'ai',
        count: 1,
        latestAt: '2026-01-16T10:00:00.000Z',
      },
    ]);
  });

  it('applies inclusive date bounds to the summary', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const summary = await caller.auditLogs.sensitiveSummary({
      createdAfter: '2026-01-12T10:00:00.000Z',
      createdBefore: '2026-01-15T10:00:00.000Z',
    });

    expect(summary.total).toBe(4);
    expect(summary.categories.find(row => row.category === 'privacy')?.count).toBe(0);
    expect(summary.categories.find(row => row.category === 'access')?.count).toBe(1);
    expect(summary.categories.find(row => row.category === 'money')?.count).toBe(2);
    expect(summary.categories.find(row => row.category === 'inventory')?.count).toBe(1);
    expect(summary.categories.find(row => row.category === 'ai')?.count).toBe(0);
  });

  it('filters the immutable history by a sensitive category', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const result = await caller.auditLogs.list({ sensitiveCategory: 'privacy' });

    expect(result.items).toHaveLength(2);
    expect(result.items.map(row => row.action)).toEqual([
      'customer.personal_data.delete',
      'customer.personal_data.export',
    ]);
  });

  it('keeps the summary admin-only', async () => {
    const caller = appRouter.createCaller(createTestContext('manager'));
    await expect(caller.auditLogs.sensitiveSummary()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
