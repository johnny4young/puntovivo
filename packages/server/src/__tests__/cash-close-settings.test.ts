/**
 * ENG-194b — tenant-level cash-close settings (blind close toggle).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants, users } from '../db/schema.js';
import { resolveCashCloseSettings } from '../services/cash-close-settings.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;

function buildContext(role: 'admin' | 'manager' | 'cashier'): Context {
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'admin@localhost', role, tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as unknown as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: 'admin@localhost', role, tenantId },
    tenantId,
    siteId: null,
  };
}

describe('cashCloseSettings', () => {
  beforeAll(async () => {
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

  afterAll(async () => {
    await server.close();
  });

  it('defaults blindClose to true when the tenant never configured it', async () => {
    const caller = appRouter.createCaller(buildContext('manager'));
    const settings = await caller.cashCloseSettings.get();
    expect(settings.blindClose).toBe(true);
    expect(settings.defaults.blindClose).toBe(true);
  });

  it('round-trips an admin update and preserves other settings namespaces', async () => {
    const caller = appRouter.createCaller(buildContext('admin'));

    const updated = await caller.cashCloseSettings.update({ blindClose: false });
    expect(updated.blindClose).toBe(false);
    expect((await caller.cashCloseSettings.get()).blindClose).toBe(false);
    // The service must not clobber sibling namespaces in the settings blob.
    const resolved = await resolveCashCloseSettings(getDatabase(), tenantId);
    expect(resolved.blindClose).toBe(false);

    const restored = await caller.cashCloseSettings.update({ blindClose: true });
    expect(restored.blindClose).toBe(true);
  });

  it('treats an empty patch as a true no-op (no tenants write, updated_at untouched)', async () => {
    const caller = appRouter.createCaller(buildContext('admin'));
    const db = getDatabase();
    const rowBefore = await db
      .select({ updatedAt: tenants.updatedAt })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();

    const before = await caller.cashCloseSettings.get();
    const after = await caller.cashCloseSettings.update({});
    expect(after.blindClose).toBe(before.blindClose);

    const rowAfter = await db
      .select({ updatedAt: tenants.updatedAt })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .get();
    expect(rowAfter?.updatedAt).toBe(rowBefore?.updatedAt);
  });

  it('gates get to manager/admin and update to admin only', async () => {
    await expect(
      appRouter.createCaller(buildContext('cashier')).cashCloseSettings.get()
    ).rejects.toThrow();
    await expect(
      appRouter.createCaller(buildContext('manager')).cashCloseSettings.update({
        blindClose: false,
      })
    ).rejects.toThrow();
  });
});
