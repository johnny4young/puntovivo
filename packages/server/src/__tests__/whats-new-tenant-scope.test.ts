/**
 * What's-New entries must not cross tenants.
 *
 * `publish` accepted `tenantScope: 'product-wide'` and wrote `tenant_id NULL`,
 * while `listUnseen` matched `tenantId = ctx.tenantId OR tenantId IS NULL`.
 * `admin` is a per-tenant role and this install has no platform role above it,
 * so a single call from any tenant's admin put attacker-authored `title` and
 * `body` — both unbounded strings — into the What's-New overlay of every other
 * tenant on the install. A phishing surface reachable in one request.
 *
 * `markSeen` separately accepted any `entryId` with no tenant predicate.
 *
 * @module __tests__/whats-new-tenant-scope.test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { companies, sites, tenants, users, whatsNewEntries } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;

interface TenantFixture {
  tenantId: string;
  userId: string;
  siteId: string;
}

async function seedTenant(label: string): Promise<TenantFixture> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = nanoid();
  const companyId = nanoid();
  const siteId = nanoid();
  const userId = nanoid();

  await db.insert(tenants).values({
    id: tenantId,
    name: `${label} Tenant`,
    slug: `${label.toLowerCase()}-${nanoid(6)}`,
    settings: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: companyId,
    tenantId,
    name: `${label} Company`,
    taxId: `9000000${label.length}-0`,
    address: 'Addr',
    phone: '0000000000',
    email: `company@${label.toLowerCase()}.test`,
    logoUrl: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId,
    companyId,
    name: `${label} Site`,
    address: 'Addr',
    phone: '0',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: userId,
    tenantId,
    email: `admin@${label.toLowerCase()}.test`,
    name: `${label} Admin`,
    passwordHash: 'x',
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return { tenantId, userId, siteId };
}

function contextFor(fixture: TenantFixture): Context {
  const db = getDatabase();
  const user = {
    id: fixture.userId,
    email: 'admin@localhost',
    role: 'admin' as const,
    tenantId: fixture.tenantId,
  };
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId: fixture.userId, email: user.email, role: user.role, tenantId: user.tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user,
    tenantId: fixture.tenantId,
    siteId: fixture.siteId,
  };
}

describe("what's-new tenant scope", () => {
  let alpha: TenantFixture;
  let beta: TenantFixture;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    alpha = await seedTenant('Alpha');
    beta = await seedTenant('Beta');
  });

  afterAll(async () => {
    await server.close();
  });

  it("a published entry never reaches another tenant's overlay", async () => {
    await appRouter.createCaller(contextFor(alpha)).whatsNew.publish({
      version: '1.0.0',
      title: 'Puntovivo: re-verify your account',
      body: 'Visit http://not-puntovivo.example to keep selling.',
    });

    const seenByBeta = await appRouter.createCaller(contextFor(beta)).whatsNew.listUnseen();
    expect(seenByBeta).toEqual([]);

    const seenByAlpha = await appRouter.createCaller(contextFor(alpha)).whatsNew.listUnseen();
    expect(seenByAlpha).toHaveLength(1);
    expect(seenByAlpha[0]?.title).toBe('Puntovivo: re-verify your account');
  });

  it('publish always stamps the calling tenant, never NULL', async () => {
    const db = getDatabase();
    const { id } = await appRouter
      .createCaller(contextFor(alpha))
      .whatsNew.publish({ version: '1.1.0', title: 'Scoped', body: 'Body' });

    const row = await db
      .select({ tenantId: whatsNewEntries.tenantId })
      .from(whatsNewEntries)
      .where(eq(whatsNewEntries.id, id))
      .get();
    expect(row?.tenantId).toBe(alpha.tenantId);
    expect(row?.tenantId).not.toBeNull();
  });

  it('a NULL-tenant row left by an earlier build stays invisible', async () => {
    // Removing the write is not enough on a DB where the old endpoint already
    // ran, so the read refuses NULL rows too.
    const db = getDatabase();
    const legacyId = nanoid();
    await db.insert(whatsNewEntries).values({
      id: legacyId,
      tenantId: null,
      version: '0.9.0',
      title: 'Legacy product-wide',
      body: 'Written before the scope was removed',
    });

    for (const fixture of [alpha, beta]) {
      const entries = await appRouter.createCaller(contextFor(fixture)).whatsNew.listUnseen();
      expect(entries.map(entry => entry.id)).not.toContain(legacyId);
    }
  });

  it("markSeen refuses another tenant's entry id", async () => {
    const { id } = await appRouter
      .createCaller(contextFor(alpha))
      .whatsNew.publish({ version: '1.2.0', title: 'Alpha only', body: 'Body' });

    await expect(
      appRouter.createCaller(contextFor(beta)).whatsNew.markSeen({ entryId: id })
    ).rejects.toMatchObject({ message: 'WHATS_NEW_ENTRY_NOT_FOUND' });

    await expect(
      appRouter.createCaller(contextFor(alpha)).whatsNew.markSeen({ entryId: id })
    ).resolves.toEqual({ ok: true });
  });
});
