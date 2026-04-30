import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../../index.js';
import { getDatabase } from '../../db/index.js';
import { aiAuditLog, companies, sites, tenants, users } from '../../db/schema.js';

import { byBreakdown, currentMonthSpend, listUsage, recordCall } from './auditLog.js';

let server: PuntovivoServer;
let tenantA: string;
let tenantB: string;
let userA: string;
let siteA1: string;
let siteA2: string;
let companyA: string;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const now = new Date().toISOString();

  tenantA = nanoid();
  tenantB = nanoid();
  await db.insert(tenants).values([
    {
      id: tenantA,
      name: 'Tenant A',
      slug: `tenant-a-${nanoid(6)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    },
    {
      id: tenantB,
      name: 'Tenant B',
      slug: `tenant-b-${nanoid(6)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    },
  ]);

  userA = nanoid();
  await db.insert(users).values({
    id: userA,
    tenantId: tenantA,
    email: 'audit-a@example.com',
    passwordHash: await hash('AuditPass123!'),
    name: 'Audit Admin A',
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  companyA = nanoid();
  await db.insert(companies).values({
    id: companyA,
    tenantId: tenantA,
    name: 'Audit Co',
    createdAt: now,
    updatedAt: now,
  });

  siteA1 = nanoid();
  siteA2 = nanoid();
  await db.insert(sites).values([
    {
      id: siteA1,
      tenantId: tenantA,
      companyId: companyA,
      name: 'Site A1',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: siteA2,
      tenantId: tenantA,
      companyId: companyA,
      name: 'Site A2',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
});

afterAll(async () => {
  if (server) await server.close();
});

beforeEach(async () => {
  const db = getDatabase();
  await db.delete(aiAuditLog).run();
});

function buildRow(
  overrides: Partial<Parameters<typeof recordCall>[1]> = {}
): Parameters<typeof recordCall>[1] {
  return {
    tenantId: tenantA,
    siteId: siteA1,
    userId: userA,
    feature: 'completeTest',
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5',
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.0105,
    durationMs: 250,
    errorCode: null,
    ...overrides,
  };
}

describe('auditLog.recordCall', () => {
  it('persists a row with a generated id and createdAt', async () => {
    const db = getDatabase();
    const { id } = await recordCall(db, buildRow());
    expect(id).toBeDefined();
    expect(id).toBeTypeOf('string');

    const stored = await db
      .select()
      .from(aiAuditLog)
      .where(/* eq */ (await import('drizzle-orm')).eq(aiAuditLog.id, id))
      .get();
    expect(stored).toBeDefined();
    expect(stored?.tenantId).toBe(tenantA);
    expect(stored?.providerId).toBe('anthropic');
    expect(stored?.createdAt).toBeDefined();
  });
});

describe('auditLog.currentMonthSpend', () => {
  it('returns 0 for an empty table', async () => {
    const db = getDatabase();
    const total = await currentMonthSpend(db, tenantA);
    expect(total).toBe(0);
  });

  it('sums the cost of every row this month for the tenant', async () => {
    const db = getDatabase();
    await recordCall(db, buildRow({ costUsd: 0.5 }));
    await recordCall(db, buildRow({ costUsd: 0.25 }));
    const total = await currentMonthSpend(db, tenantA);
    expect(total).toBeCloseTo(0.75, 6);
  });

  it('does not include rows from a different tenant', async () => {
    const db = getDatabase();
    await recordCall(db, buildRow({ costUsd: 0.5 }));
    await recordCall(db, buildRow({ tenantId: tenantB, siteId: null, userId: null, costUsd: 100 }));
    const total = await currentMonthSpend(db, tenantA);
    expect(total).toBeCloseTo(0.5, 6);
  });

  it('does not include rows from a previous calendar month', async () => {
    const db = getDatabase();
    const lastMonth = new Date(2025, 0, 15).toISOString();
    await recordCall(db, buildRow({ costUsd: 1, createdAt: lastMonth }));
    await recordCall(db, buildRow({ costUsd: 0.25 }));
    // Pin "now" to mid-February 2025 so January rows fall outside the window.
    const total = await currentMonthSpend(db, tenantA, new Date(2025, 1, 15));
    expect(total).toBeCloseTo(0, 6);
  });
});

describe('auditLog.listUsage', () => {
  it('returns rows for the tenant ordered by createdAt desc', async () => {
    const db = getDatabase();
    const earlier = new Date(2025, 5, 1).toISOString();
    const later = new Date(2025, 5, 2).toISOString();
    await recordCall(db, buildRow({ costUsd: 0.1, createdAt: earlier }));
    await recordCall(db, buildRow({ costUsd: 0.2, createdAt: later }));
    const page = await listUsage(db, tenantA, { limit: 10 });
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.createdAt).toBe(later);
    expect(page.items[1]?.createdAt).toBe(earlier);
    expect(page.nextCursor).toBeNull();
  });

  it('paginates via cursor without duplicating boundary rows', async () => {
    const db = getDatabase();
    const sharedTimestamp = new Date(2025, 5, 1).toISOString();
    for (const suffix of ['a', 'b', 'c', 'd', 'e']) {
      await recordCall(
        db,
        buildRow({
          id: `usage-row-${suffix}`,
          createdAt: sharedTimestamp,
          costUsd: 0.01,
        })
      );
    }
    const firstPage = await listUsage(db, tenantA, { limit: 2 });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeDefined();
    const secondPage = await listUsage(db, tenantA, {
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.items).toHaveLength(2);
    const firstPageIds = firstPage.items.map(item => item.id);
    const secondPageIds = secondPage.items.map(item => item.id);
    expect(new Set([...firstPageIds, ...secondPageIds]).size).toBe(4);
    expect(secondPageIds).not.toContain(firstPageIds.at(-1));
  });
});

describe('auditLog.byBreakdown', () => {
  it('groups by site and sums cost per bucket', async () => {
    const db = getDatabase();
    await recordCall(db, buildRow({ siteId: siteA1, costUsd: 0.4 }));
    await recordCall(db, buildRow({ siteId: siteA1, costUsd: 0.1 }));
    await recordCall(db, buildRow({ siteId: siteA2, costUsd: 0.3 }));
    const buckets = await byBreakdown(db, tenantA, 'site');
    expect(buckets).toHaveLength(2);
    const bySite = Object.fromEntries(buckets.map(b => [b.scopeKey, b]));
    expect(bySite[siteA1]?.totalCostUsd).toBeCloseTo(0.5, 6);
    expect(bySite[siteA1]?.callCount).toBe(2);
    expect(bySite[siteA2]?.totalCostUsd).toBeCloseTo(0.3, 6);
    expect(bySite[siteA2]?.callCount).toBe(1);
  });

  it('groups by provider, including stub providers if data exists', async () => {
    const db = getDatabase();
    await recordCall(db, buildRow({ providerId: 'anthropic', costUsd: 0.2 }));
    await recordCall(db, buildRow({ providerId: 'openai', costUsd: 0.05 }));
    const buckets = await byBreakdown(db, tenantA, 'provider');
    const byProvider = Object.fromEntries(buckets.map(b => [b.scopeKey, b]));
    expect(byProvider.anthropic?.totalCostUsd).toBeCloseTo(0.2, 6);
    expect(byProvider.openai?.totalCostUsd).toBeCloseTo(0.05, 6);
  });

  it('respects an explicit time window', async () => {
    const db = getDatabase();
    await recordCall(
      db,
      buildRow({ costUsd: 1, createdAt: new Date(2025, 0, 15).toISOString() })
    );
    await recordCall(
      db,
      buildRow({ costUsd: 0.5, createdAt: new Date(2025, 1, 15).toISOString() })
    );
    const buckets = await byBreakdown(db, tenantA, 'feature', {
      from: new Date(2025, 1, 1),
      to: new Date(2025, 1, 28),
    });
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.totalCostUsd).toBeCloseTo(0.5, 6);
  });

  it('represents a null site as the empty string scope key', async () => {
    const db = getDatabase();
    await recordCall(db, buildRow({ siteId: null, costUsd: 0.7 }));
    const buckets = await byBreakdown(db, tenantA, 'site');
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.scopeKey).toBe('');
    expect(buckets[0]?.totalCostUsd).toBeCloseTo(0.7, 6);
  });
});
