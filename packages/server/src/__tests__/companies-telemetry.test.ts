/**
 * ENG-135 — `companies.updateTelemetryOptIn` contract tests.
 *
 * Pins:
 *   - Flipping the flag persists in `tenants.settings.telemetryOptIn`.
 *   - Each call writes an audit row `telemetry.opt_in.updated` with
 *     before / after snapshots.
 *   - Cashier role is rejected (FORBIDDEN).
 *   - Cross-tenant: admin of T1 cannot affect T2's settings blob.
 *   - `companies.getCurrent` surfaces the resolved flag on its
 *     response shape, defaulting to false.
 *
 * @module __tests__/companies-telemetry.test
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, companies, tenants, users } from '../db/schema.js';
import {
  __clearTelemetryOptInCacheForTests,
  captureException,
  noopSink,
  registerTelemetrySink,
  type TelemetrySink,
} from '../observability/index.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let primaryTenantId: string;
let primaryAdminId: string;
let primaryCompanyId: string;
let foreignTenantId: string;
let foreignAdminId: string;

function buildCtx(args: {
  tenantId: string;
  userId: string;
  role?: 'admin' | 'manager' | 'cashier' | 'viewer';
}): Context {
  const role = args.role ?? 'admin';
  return {
    req: {
      id: `req-${nanoid()}`,
      log: { info() {}, error() {} },
      server: server.app,
      headers: {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: {
      id: args.userId,
      email: `${args.userId}@example.com`,
      role,
      tenantId: args.tenantId,
    },
    tenantId: args.tenantId,
    siteId: null,
  };
}

beforeAll(async () => {
  server = await createServer({
    dbPath: ':memory:',
    jwtSecret: 'a'.repeat(64),
    verbose: false,
  });
  const db = getDatabase();
  const seededAdmin = await db
    .select()
    .from(users)
    .where(eq(users.email, 'admin@localhost'))
    .get();
  if (!seededAdmin) throw new Error('expected seeded admin user');
  primaryTenantId = seededAdmin.tenantId;
  primaryAdminId = seededAdmin.id;
  const seededCompany = await db
    .select()
    .from(companies)
    .where(eq(companies.tenantId, primaryTenantId))
    .get();
  if (!seededCompany) throw new Error('expected seeded company');
  primaryCompanyId = seededCompany.id;

  // Build an isolated second tenant + admin so the cross-tenant test
  // can prove isolation.
  foreignTenantId = nanoid();
  foreignAdminId = nanoid();
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: foreignTenantId,
    name: 'Foreign Tenant',
    slug: `foreign-${foreignTenantId.slice(0, 6)}`,
    settings: {},
    createdAt: now,
    updatedAt: now,
  });
  // No foreign site / company needed — `companies.updateTelemetryOptIn`
  // only mutates `tenants.settings`. The mutation is admin-only via
  // `adminProcedure`, which requires the user + tenant context that
  // we wire below.
  await db.insert(users).values({
    id: foreignAdminId,
    tenantId: foreignTenantId,
    email: 'foreign-admin@example.com',
    name: 'Foreign Admin',
    role: 'admin',
    passwordHash: '$argon2id$v=19$m=65536,t=2,p=1$placeholder$placeholder',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
});

afterAll(async () => {
  await server.close();
});

afterEach(() => {
  registerTelemetrySink(noopSink);
  __clearTelemetryOptInCacheForTests();
});

describe('companies.updateTelemetryOptIn (ENG-135)', () => {
  it('flips the flag to true and writes an audit row', async () => {
    const caller = appRouter.createCaller(
      buildCtx({ tenantId: primaryTenantId, userId: primaryAdminId })
    );
    const result = await caller.companies.updateTelemetryOptIn({ optedIn: true });
    expect(result.telemetryOptIn).toBe(true);

    const persisted = await getDatabase()
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, primaryTenantId))
      .get();
    const settings = (persisted?.settings ?? {}) as Record<string, unknown>;
    expect(settings.telemetryOptIn).toBe(true);

    const audit = await getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, primaryTenantId),
          eq(auditLogs.action, 'telemetry.opt_in.updated')
        )
      )
      .orderBy(sql`created_at DESC`)
      .get();
    expect(audit).toBeDefined();
    expect(audit?.after).toEqual({ telemetryOptIn: true });
    expect(audit?.resourceType).toBe('tenant');
    expect(audit?.resourceId).toBe(primaryTenantId);
    expect(audit?.actorId).toBe(primaryAdminId);
  });

  it('flips the flag back to false and records the prior state', async () => {
    const caller = appRouter.createCaller(
      buildCtx({ tenantId: primaryTenantId, userId: primaryAdminId })
    );
    // Snap the flag to a known-true starting point, then flip false.
    // The audit row of interest is the LAST one written for this
    // tenant+action — the SQLite `rowid` column preserves insertion
    // order even when several rows share the same `created_at`
    // millisecond. SQLite returns rows in `rowid` order for an
    // unconstrained `SELECT`, so reading the full set and taking the
    // tail is deterministic without a fragile sub-millisecond clock
    // race.
    await caller.companies.updateTelemetryOptIn({ optedIn: true });
    const result = await caller.companies.updateTelemetryOptIn({ optedIn: false });
    expect(result.telemetryOptIn).toBe(false);
    const audits = await getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, primaryTenantId),
          eq(auditLogs.action, 'telemetry.opt_in.updated')
        )
      )
      .all();
    expect(audits.length).toBeGreaterThanOrEqual(2);
    const lastAudit = audits.at(-1);
    expect(lastAudit?.before).toEqual({ telemetryOptIn: true });
    expect(lastAudit?.after).toEqual({ telemetryOptIn: false });
  });

  it('rejects cashier role with FORBIDDEN', async () => {
    const caller = appRouter.createCaller(
      buildCtx({
        tenantId: primaryTenantId,
        userId: primaryAdminId,
        role: 'cashier',
      })
    );
    await expect(
      caller.companies.updateTelemetryOptIn({ optedIn: true })
    ).rejects.toThrow(/administrators/i);
  });

  it('isolates tenants — flipping T1 does not affect T2', async () => {
    const callerA = appRouter.createCaller(
      buildCtx({ tenantId: primaryTenantId, userId: primaryAdminId })
    );
    const callerB = appRouter.createCaller(
      buildCtx({ tenantId: foreignTenantId, userId: foreignAdminId })
    );
    await callerA.companies.updateTelemetryOptIn({ optedIn: true });
    await callerB.companies.updateTelemetryOptIn({ optedIn: false });
    const tenantA = await getDatabase()
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, primaryTenantId))
      .get();
    const tenantB = await getDatabase()
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, foreignTenantId))
      .get();
    expect((tenantA?.settings as Record<string, unknown>).telemetryOptIn).toBe(
      true
    );
    expect((tenantB?.settings as Record<string, unknown>).telemetryOptIn).toBe(
      false
    );
  });

  it('companies.getCurrent surfaces the resolved telemetryOptIn flag', async () => {
    const caller = appRouter.createCaller(
      buildCtx({ tenantId: primaryTenantId, userId: primaryAdminId })
    );
    await caller.companies.updateTelemetryOptIn({ optedIn: true });
    const company = await caller.companies.getCurrent();
    expect(company).not.toBeNull();
    expect(company?.id).toBe(primaryCompanyId);
    expect(company?.telemetryOptIn).toBe(true);
    await caller.companies.updateTelemetryOptIn({ optedIn: false });
    const after = await caller.companies.getCurrent();
    expect(after?.telemetryOptIn).toBe(false);
  });

  it('revokes centralized capture immediately after disabling telemetry', async () => {
    const exceptionCalls: Array<{ err: unknown; attrs: Record<string, unknown> }> =
      [];
    const sink: TelemetrySink = {
      captureException(err, attrs) {
        exceptionCalls.push({ err, attrs });
      },
      recordSpan() {
        /* not relevant for this consent-cache assertion */
      },
    };
    registerTelemetrySink(sink);

    const caller = appRouter.createCaller(
      buildCtx({ tenantId: primaryTenantId, userId: primaryAdminId })
    );
    await caller.companies.updateTelemetryOptIn({ optedIn: true });
    await captureException(
      new Error('before revoke'),
      { tenantId: primaryTenantId },
      getDatabase()
    );
    expect(exceptionCalls).toHaveLength(1);

    await caller.companies.updateTelemetryOptIn({ optedIn: false });
    await captureException(
      new Error('after revoke'),
      { tenantId: primaryTenantId },
      getDatabase()
    );
    expect(exceptionCalls).toHaveLength(1);
  });
});
