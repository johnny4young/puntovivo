/**
 * Unit coverage for the tRPC tracing middleware.
 *
 * Pins four contracts:
 *
 * 1. A successful procedure emits one info log with the expected
 * shape (procedure, outcome=ok, durationMs, correlationId,
 * tenantId, userId).
 * 2. A failing procedure emits one error log AND routes the
 * exception through `captureException` (we register a recording
 * sink and verify the call) AND re-throws so the tRPC error
 * formatter still runs downstream.
 * 3. An anonymous call (no tenantId, no user) still stamps a
 * correlationId; the tenantId / userId bindings are null.
 * 4. Two parallel procedures each carry their own correlationId
 * the middleware holds no shared mutable state.
 *
 * @module __tests__/trpc-tracing.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TRPCError } from '@trpc/server';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants, users } from '../db/schema.js';
import { router, publicProcedure } from '../trpc/init.js';
import type { Context } from '../trpc/context.js';
import {
  registerTelemetrySink,
  noopSink,
  __clearTelemetryOptInCacheForTests,
  type TelemetrySink,
} from '../observability/index.js';

interface RecordedLog {
  level: 'info' | 'error';
  bindings: Record<string, unknown>;
  msg: string;
}

interface BuiltCtx {
  ctx: Context;
  logs: RecordedLog[];
}

function buildCtx(args: {
  tenantId: string | null;
  userId: string | null;
  reqId?: string;
  /** optional request headers (e.g. x-correlation-id). */
  headers?: Record<string, string | string[]>;
  server: PuntovivoServer;
}): BuiltCtx {
  const logs: RecordedLog[] = [];
  const recordingLog = {
    info: (bindings: Record<string, unknown>, msg: string) =>
      logs.push({ level: 'info', bindings, msg }),
    error: (bindings: Record<string, unknown>, msg: string) =>
      logs.push({ level: 'error', bindings, msg }),
  };
  const ctx: Context = {
    req: {
      id: args.reqId ?? `req-${nanoid()}`,
      log: recordingLog,
      server: args.server.app,
      headers: args.headers ?? {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: args.userId
      ? {
          id: args.userId,
          email: `${args.userId}@localhost`,
          role: 'admin',
          tenantId: args.tenantId ?? '',
        }
      : null,
    tenantId: args.tenantId,
    siteId: null,
  };
  return { ctx, logs };
}

function buildRecordingSink(): {
  sink: TelemetrySink;
  exceptions: Array<{ err: unknown; attrs: Record<string, unknown> }>;
  spans: Array<{
    name: string;
    attrs: Record<string, unknown>;
    durationMs: number;
    outcome: 'ok' | 'error';
  }>;
} {
  const exceptions: Array<{ err: unknown; attrs: Record<string, unknown> }> = [];
  const spans: Array<{
    name: string;
    attrs: Record<string, unknown>;
    durationMs: number;
    outcome: 'ok' | 'error';
  }> = [];
  const sink: TelemetrySink = {
    captureException(err, attrs) {
      exceptions.push({ err, attrs });
    },
    recordSpan(name, attrs, durationMs, outcome) {
      spans.push({ name, attrs, durationMs, outcome });
    },
  };
  return { sink, exceptions, spans };
}

let server: PuntovivoServer;
let optInTenantId: string;
let optInUserId: string;

beforeEach(async () => {
  server = await createServer({
    dbPath: ':memory:',
    jwtSecret: 'a'.repeat(64),
    verbose: false,
  });
  const db = getDatabase();
  // Use the seeded admin tenant + user (created by createServer) and
  // flip their telemetryOptIn so captureException forwards.
  const adminUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!adminUser) throw new Error('expected seeded admin user');
  optInTenantId = adminUser.tenantId;
  optInUserId = adminUser.id;
  await db
    .update(tenants)
    .set({ settings: { telemetryOptIn: true } })
    .where(eq(tenants.id, optInTenantId));
  __clearTelemetryOptInCacheForTests();
  registerTelemetrySink(noopSink);
});

afterEach(async () => {
  registerTelemetrySink(noopSink);
  __clearTelemetryOptInCacheForTests();
  await server.close();
});

describe('trpc tracing middleware', () => {
  // A tiny self-contained router so the test does not depend on the
  // exact shape of any real router. The middleware lives on
  // `publicProcedure`, so a procedure built on top inherits it.
  const harnessRouter = router({
    ok: publicProcedure.query(() => 'ok'),
    boom: publicProcedure.query(() => {
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'kaboom',
      });
    }),
  });

  it('emits a single info log with the expected bindings on success', async () => {
    const { sink, spans } = buildRecordingSink();
    registerTelemetrySink(sink);
    const { ctx, logs } = buildCtx({
      tenantId: optInTenantId,
      userId: optInUserId,
      reqId: 'corr-success',
      server,
    });
    const caller = harnessRouter.createCaller(ctx);
    const result = await caller.ok();
    expect(result).toBe('ok');
    expect(logs).toHaveLength(1);
    const entry = logs[0]!;
    expect(entry.level).toBe('info');
    expect(entry.msg).toBe('trpc procedure ok');
    expect(entry.bindings).toMatchObject({
      procedure: 'ok',
      outcome: 'ok',
      correlationId: 'corr-success',
      tenantId: optInTenantId,
      userId: optInUserId,
    });
    expect(typeof entry.bindings.durationMs).toBe('number');
    await vi.waitFor(() => {
      expect(spans).toHaveLength(1);
    });
    expect(spans[0]).toMatchObject({
      name: 'ok',
      outcome: 'ok',
      attrs: {
        procedure: 'ok',
        tenantId: optInTenantId,
        correlationId: 'corr-success',
      },
    });
  });

  it('emits an error log and routes the failure through captureException', async () => {
    const { sink, exceptions, spans } = buildRecordingSink();
    registerTelemetrySink(sink);
    const { ctx, logs } = buildCtx({
      tenantId: optInTenantId,
      userId: optInUserId,
      reqId: 'corr-error',
      server,
    });
    const caller = harnessRouter.createCaller(ctx);
    await expect(caller.boom()).rejects.toThrow('kaboom');
    expect(logs).toHaveLength(1);
    const entry = logs[0]!;
    expect(entry.level).toBe('error');
    expect(entry.bindings).toMatchObject({
      procedure: 'boom',
      outcome: 'error',
      correlationId: 'corr-error',
      tenantId: optInTenantId,
      userId: optInUserId,
    });
    // captureException is fire-and-forget; the sink call happens on
    // the next microtask. Flush.
    await vi.waitFor(() => {
      expect(exceptions).toHaveLength(1);
    });
    expect(exceptions[0]?.attrs).toMatchObject({
      procedure: 'boom',
      tenantId: optInTenantId,
      correlationId: 'corr-error',
    });
    await vi.waitFor(() => {
      expect(spans).toHaveLength(1);
    });
    expect(spans[0]).toMatchObject({
      name: 'boom',
      outcome: 'error',
      attrs: {
        procedure: 'boom',
        tenantId: optInTenantId,
        correlationId: 'corr-error',
      },
    });
  });

  it('stamps a correlationId even on anonymous calls (no tenantId, no user)', async () => {
    const { ctx, logs } = buildCtx({
      tenantId: null,
      userId: null,
      reqId: 'corr-anon',
      server,
    });
    const caller = harnessRouter.createCaller(ctx);
    await caller.ok();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.bindings).toMatchObject({
      procedure: 'ok',
      outcome: 'ok',
      correlationId: 'corr-anon',
      tenantId: null,
      userId: null,
    });
  });

  it('two parallel calls each get their own correlationId', async () => {
    const a = buildCtx({
      tenantId: optInTenantId,
      userId: optInUserId,
      reqId: 'corr-a',
      server,
    });
    const b = buildCtx({
      tenantId: optInTenantId,
      userId: optInUserId,
      reqId: 'corr-b',
      server,
    });
    const callerA = harnessRouter.createCaller(a.ctx);
    const callerB = harnessRouter.createCaller(b.ctx);
    await Promise.all([callerA.ok(), callerB.ok()]);
    expect(a.logs).toHaveLength(1);
    expect(b.logs).toHaveLength(1);
    expect(a.logs[0]?.bindings.correlationId).toBe('corr-a');
    expect(b.logs[0]?.bindings.correlationId).toBe('corr-b');
  });

  // the renderer-minted x-correlation-id header (after
  // strict sanitization) takes precedence over the Fastify reqId so
  // client error events and server traces share one identifier.
  it('adopts a valid x-correlation-id header over the Fastify reqId', async () => {
    const { sink, spans } = buildRecordingSink();
    registerTelemetrySink(sink);
    const clientId = '6f1a2b3c-4d5e-4f60-8a9b-0c1d2e3f4a5b';
    const { ctx, logs } = buildCtx({
      tenantId: optInTenantId,
      userId: optInUserId,
      reqId: 'req-fastify-internal',
      headers: { 'x-correlation-id': clientId },
      server,
    });
    const caller = harnessRouter.createCaller(ctx);
    await caller.ok();
    expect(logs[0]?.bindings.correlationId).toBe(clientId);
    await vi.waitFor(() => {
      expect(spans).toHaveLength(1);
    });
    expect(spans[0]?.attrs.correlationId).toBe(clientId);
  });

  it('falls back to the Fastify reqId when the header is invalid', async () => {
    const { ctx, logs } = buildCtx({
      tenantId: optInTenantId,
      userId: optInUserId,
      reqId: 'req-fallback',
      headers: { 'x-correlation-id': 'bad id with spaces <script>' },
      server,
    });
    const caller = harnessRouter.createCaller(ctx);
    await caller.ok();
    expect(logs[0]?.bindings.correlationId).toBe('req-fallback');
  });

  it('takes the first entry when the header arrives as an array', async () => {
    const { ctx, logs } = buildCtx({
      tenantId: optInTenantId,
      userId: optInUserId,
      reqId: 'req-array',
      headers: { 'x-correlation-id': ['client-id-first', 'client-id-shadow'] },
      server,
    });
    const caller = harnessRouter.createCaller(ctx);
    await caller.ok();
    expect(logs[0]?.bindings.correlationId).toBe('client-id-first');
  });
});
