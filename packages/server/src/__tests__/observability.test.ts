import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants, users, webVitalSamples } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;
let otherTenantId: string;

/** Authenticated admin context for the active tenant. */
function createAdminContext(): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: 'admin@localhost', role: 'admin', tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: { id: userId, email: 'admin@localhost', role: 'admin', tenantId },
    tenantId,
    siteId: null,
  };
}

/** Anonymous (pre-login) context — no user, no tenant. */
function createAnonContext(): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: null,
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: null,
    tenantId: null,
    siteId: null,
  };
}

/** Flip the active tenant's `tenants.settings.telemetryOptIn`. */
async function setTelemetryOptIn(optedIn: boolean): Promise<void> {
  const db = getDatabase();
  await db
    .update(tenants)
    .set({ settings: { telemetryOptIn: optedIn } })
    .where(eq(tenants.id, tenantId));
}

function validSample() {
  return {
    metric: 'LCP' as const,
    value: 2480.5,
    rating: 'good' as const,
    route: '/sales',
    deviceClass: 'mid' as const,
  };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();

  const seededUser = await db
    .select()
    .from(users)
    .where(eq(users.email, 'admin@localhost'))
    .get();
  if (!seededUser) throw new Error('Expected seeded admin user');
  tenantId = seededUser.tenantId;
  userId = seededUser.id;

  // A second tenant so the recentWebVitals scope can be proven to isolate.
  otherTenantId = nanoid();
  await db.insert(tenants).values({
    id: otherTenantId,
    name: 'Other RUM Tenant',
    slug: `other-rum-${nanoid(6)}`,
    defaultCurrencyCode: 'COP',
  });
});

afterAll(async () => {
  await server.app.close();
});

describe('observability.reportWebVital (ENG-173)', () => {
  it('accepts an anonymous sample and stores it with a null tenant_id', async () => {
    const caller = appRouter.createCaller(createAnonContext());
    const result = await caller.observability.reportWebVital({
      ...validSample(),
      metric: 'CLS',
      value: 0.04,
      route: '/login',
    });
    expect(result.accepted).toBe(true);

    const db = getDatabase();
    const rows = await db
      .select()
      .from(webVitalSamples)
      .where(eq(webVitalSamples.route, '/login'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenantId).toBeNull();
    expect(rows[0]!.metric).toBe('CLS');
    expect(rows[0]!.tenantPlan).toBe('unknown');
  });

  it('drops an authenticated sample when the tenant is opted out (the default)', async () => {
    await setTelemetryOptIn(false);
    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.observability.reportWebVital({
      ...validSample(),
      route: '/opted-out-route',
    });
    expect(result.accepted).toBe(false);

    const db = getDatabase();
    const rows = await db
      .select()
      .from(webVitalSamples)
      .where(eq(webVitalSamples.route, '/opted-out-route'))
      .all();
    expect(rows).toHaveLength(0);
  });

  it('stores an authenticated sample scoped to ctx.tenantId when opted in', async () => {
    await setTelemetryOptIn(true);
    const caller = appRouter.createCaller(createAdminContext());
    const result = await caller.observability.reportWebVital({
      ...validSample(),
      route: '/opted-in-route',
      metric: 'INP',
      value: 180,
    });
    expect(result.accepted).toBe(true);

    const db = getDatabase();
    const rows = await db
      .select()
      .from(webVitalSamples)
      .where(eq(webVitalSamples.route, '/opted-in-route'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tenantId).toBe(tenantId);
    expect(rows[0]!.metric).toBe('INP');
    expect(rows[0]!.value).toBe(180);
  });

  it('rejects out-of-range or malformed payloads (input bounds)', async () => {
    const caller = appRouter.createCaller(createAnonContext());
    // value above the 1e7 ceiling
    await expect(
      caller.observability.reportWebVital({ ...validSample(), value: 1e9 })
    ).rejects.toThrow();
    // negative value
    await expect(
      caller.observability.reportWebVital({ ...validSample(), value: -1 })
    ).rejects.toThrow();
    // route longer than 256 chars
    await expect(
      caller.observability.reportWebVital({ ...validSample(), route: 'x'.repeat(257) })
    ).rejects.toThrow();
    // unknown metric
    await expect(
      caller.observability.reportWebVital({
        ...validSample(),
        // @ts-expect-error — exercising the enum guard at runtime
        metric: 'BOGUS',
      })
    ).rejects.toThrow();
    const sampleWithExtraKey = { ...validSample(), tenantId };
    await expect(
      caller.observability.reportWebVital(sampleWithExtraKey)
    ).rejects.toThrow();
  });
});

describe('observability.recentWebVitals (ENG-173)', () => {
  it('returns only the active tenant rows, excluding other tenants and anon rows', async () => {
    const db = getDatabase();
    // Seed: one row for the active tenant, one for a different tenant, one anon.
    await db.insert(webVitalSamples).values([
      {
        id: nanoid(),
        tenantId,
        tenantPlan: 'unknown',
        route: '/recent-mine',
        metric: 'FCP',
        value: 900,
        rating: 'good',
        deviceClass: 'high',
      },
      {
        id: nanoid(),
        tenantId: otherTenantId,
        tenantPlan: 'unknown',
        route: '/recent-theirs',
        metric: 'FCP',
        value: 1500,
        rating: 'needs-improvement',
        deviceClass: 'low',
      },
      {
        id: nanoid(),
        tenantId: null,
        tenantPlan: 'unknown',
        route: '/recent-anon',
        metric: 'TTFB',
        value: 300,
        rating: 'good',
        deviceClass: 'unknown',
      },
    ]);

    const caller = appRouter.createCaller(createAdminContext());
    const rows = await caller.observability.recentWebVitals({ limit: 100 });
    const routes = rows.map(r => r.route);
    expect(routes).toContain('/recent-mine');
    expect(routes).not.toContain('/recent-theirs');
    expect(routes).not.toContain('/recent-anon');
  });

  it('requires a manager/admin role (rejects an anonymous caller)', async () => {
    const caller = appRouter.createCaller(createAnonContext());
    await expect(caller.observability.recentWebVitals({ limit: 10 })).rejects.toThrow();
  });

  it('rejects unknown read input keys', async () => {
    const caller = appRouter.createCaller(createAdminContext());
    const inputWithExtraKey = { limit: 10, tenantId };
    await expect(
      caller.observability.recentWebVitals(inputWithExtraKey)
    ).rejects.toThrow();
  });
});
