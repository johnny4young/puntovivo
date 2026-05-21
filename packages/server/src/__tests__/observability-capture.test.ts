/**
 * ENG-135 — Unit tests for the observability capture helpers.
 *
 * Pins three contracts:
 *
 *   1. The local pino log emits unconditionally.
 *   2. The registered sink is only invoked when the active tenant
 *      has opted in (`tenants.settings.telemetryOptIn = true`).
 *   3. Redaction runs before the attrs bag reaches the sink.
 *
 * Uses an in-memory SQLite DB seeded with two tenants — one
 * opt-in, one opt-out — and a stub sink that records its calls.
 *
 * @module __tests__/observability-capture.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoid } from 'nanoid';
import { eq, sql } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants } from '../db/schema.js';
import {
  captureException,
  withSpan,
  registerTelemetrySink,
  noopSink,
  redactErrorAttrs,
  __clearTelemetryOptInCacheForTests,
  type TelemetrySink,
  type TelemetryEventAttrs,
} from '../observability/index.js';
import { __REDACT_FIELD_NAMES_FOR_TESTS } from '../observability/redact.js';

interface SinkCall {
  kind: 'exception' | 'span';
  payload: Record<string, unknown>;
}

function buildRecordingSink(): { sink: TelemetrySink; calls: SinkCall[] } {
  const calls: SinkCall[] = [];
  const sink: TelemetrySink = {
    captureException(err, attrs) {
      calls.push({
        kind: 'exception',
        payload: { err: (err as Error).message, attrs },
      });
    },
    recordSpan(name, attrs, durationMs, outcome) {
      calls.push({
        kind: 'span',
        payload: { name, attrs, durationMs, outcome },
      });
    },
  };
  return { sink, calls };
}

let server: PuntovivoServer;
let optInTenantId: string;
let optOutTenantId: string;

beforeEach(async () => {
  server = await createServer({
    dbPath: ':memory:',
    jwtSecret: 'a'.repeat(64),
    verbose: false,
  });
  const db = getDatabase();
  optInTenantId = nanoid();
  optOutTenantId = nanoid();
  const now = new Date().toISOString();
  await db.insert(tenants).values([
    {
      id: optInTenantId,
      name: 'OptIn Tenant',
      slug: `optin-${optInTenantId.slice(0, 6)}`,
      settings: { telemetryOptIn: true },
      createdAt: now,
      updatedAt: now,
    },
    {
      id: optOutTenantId,
      name: 'OptOut Tenant',
      slug: `optout-${optOutTenantId.slice(0, 6)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    },
  ]);
  __clearTelemetryOptInCacheForTests();
  // Snap the active sink back to noop between tests so a leak from
  // one assertion does not poison the next.
  registerTelemetrySink(noopSink);
});

afterEach(async () => {
  registerTelemetrySink(noopSink);
  __clearTelemetryOptInCacheForTests();
  await server.close();
});

describe('captureException (ENG-135)', () => {
  it('skips the sink when the tenant is opted out', async () => {
    const { sink, calls } = buildRecordingSink();
    registerTelemetrySink(sink);
    await captureException(
      new Error('boom'),
      { tenantId: optOutTenantId, procedure: 'sales.create' },
      getDatabase()
    );
    expect(calls).toHaveLength(0);
  });

  it('forwards to the sink when the tenant is opted in', async () => {
    const { sink, calls } = buildRecordingSink();
    registerTelemetrySink(sink);
    await captureException(
      new Error('boom'),
      { tenantId: optInTenantId, procedure: 'sales.create' },
      getDatabase()
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe('exception');
    expect(calls[0]?.payload.err).toBe('boom');
  });

  it('skips the sink when no tenantId is supplied (anonymous capture)', async () => {
    const { sink, calls } = buildRecordingSink();
    registerTelemetrySink(sink);
    await captureException(
      new Error('boom'),
      { procedure: 'auth.login' },
      getDatabase()
    );
    expect(calls).toHaveLength(0);
  });

  it('redacts sensitive attrs before invoking the sink', async () => {
    const { sink, calls } = buildRecordingSink();
    registerTelemetrySink(sink);
    await captureException(
      new Error('boom'),
      {
        tenantId: optInTenantId,
        procedure: 'auth.login',
        password: 'plaintext',
        token: 'bearer-xyz',
        nested: { refreshToken: 'r-tok', tenantId: 'safe' },
      },
      getDatabase()
    );
    expect(calls).toHaveLength(1);
    const attrs = calls[0]?.payload.attrs as Record<string, unknown>;
    expect(attrs.password).toBe('[Redacted]');
    expect(attrs.token).toBe('[Redacted]');
    const nested = attrs.nested as Record<string, unknown>;
    expect(nested.refreshToken).toBe('[Redacted]');
    expect(nested.tenantId).toBe('safe');
  });

  it('swallows sink errors so observability never breaks the caller', async () => {
    const sink: TelemetrySink = {
      captureException() {
        throw new Error('adapter exploded');
      },
      recordSpan() {
        /* unused */
      },
    };
    registerTelemetrySink(sink);
    await expect(
      captureException(
        new Error('boom'),
        { tenantId: optInTenantId },
        getDatabase()
      )
    ).resolves.toBeUndefined();
  });
});

describe('withSpan (ENG-135)', () => {
  it('measures duration and records ok outcome via the sink when opted in', async () => {
    const { sink, calls } = buildRecordingSink();
    registerTelemetrySink(sink);
    const result = await withSpan(
      'products.list',
      { tenantId: optInTenantId },
      async () => {
        // Tiny artificial delay so durationMs is unambiguously > 0.
        await new Promise(resolve => setTimeout(resolve, 1));
        return 42;
      },
      getDatabase()
    );
    expect(result).toBe(42);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.kind).toBe('span');
    const payload = calls[0]?.payload as Record<string, unknown>;
    expect(payload.name).toBe('products.list');
    expect(payload.outcome).toBe('ok');
    expect(typeof payload.durationMs).toBe('number');
    expect(payload.durationMs as number).toBeGreaterThanOrEqual(0);
  });

  it('captures the exception and re-throws when the wrapped fn fails', async () => {
    const { sink, calls } = buildRecordingSink();
    registerTelemetrySink(sink);
    await expect(
      withSpan(
        'products.create',
        { tenantId: optInTenantId },
        async () => {
          throw new Error('validation failed');
        },
        getDatabase()
      )
    ).rejects.toThrow('validation failed');
    // Two events: the captureException + the recordSpan with
    // outcome 'error'.
    const exceptionCalls = calls.filter(c => c.kind === 'exception');
    const spanCalls = calls.filter(c => c.kind === 'span');
    expect(exceptionCalls).toHaveLength(1);
    expect(spanCalls).toHaveLength(1);
    expect((spanCalls[0]?.payload as Record<string, unknown>).outcome).toBe(
      'error'
    );
  });
});

describe('registerTelemetrySink (ENG-135)', () => {
  it('swaps the active sink and returns the previous one', () => {
    const first = buildRecordingSink();
    const second = buildRecordingSink();
    const previousA = registerTelemetrySink(first.sink);
    expect(previousA).toBe(noopSink);
    const previousB = registerTelemetrySink(second.sink);
    expect(previousB).toBe(first.sink);
  });

  it('reverts to noop when called with noopSink', async () => {
    const { sink, calls } = buildRecordingSink();
    registerTelemetrySink(sink);
    registerTelemetrySink(noopSink);
    await captureException(
      new Error('boom'),
      { tenantId: optInTenantId },
      getDatabase()
    );
    expect(calls).toHaveLength(0);
  });
});

describe('redactErrorAttrs (ENG-135)', () => {
  it('masks every name listed in __REDACT_FIELD_NAMES_FOR_TESTS', () => {
    const attrs: Record<string, unknown> = {};
    for (const field of __REDACT_FIELD_NAMES_FOR_TESTS) {
      attrs[field] = 'plaintext';
    }
    const safe = redactErrorAttrs(attrs);
    for (const field of __REDACT_FIELD_NAMES_FOR_TESTS) {
      expect(safe[field]).toBe('[Redacted]');
    }
  });

  it('walks arrays and nested objects', () => {
    const safe = redactErrorAttrs({
      list: [
        { password: 'a', label: 'one' },
        { password: 'b', label: 'two' },
      ],
      nested: { sibling: { token: 'tok', tenantId: 't' } },
    });
    const list = safe.list as Array<Record<string, unknown>>;
    expect(list[0]?.password).toBe('[Redacted]');
    expect(list[0]?.label).toBe('one');
    const sibling = (safe.nested as Record<string, unknown>).sibling as Record<
      string,
      unknown
    >;
    expect(sibling.token).toBe('[Redacted]');
    expect(sibling.tenantId).toBe('t');
  });

  it('tolerates cyclic input without overflowing the stack', () => {
    const cycle: Record<string, unknown> = { tenantId: 't' };
    cycle.self = cycle;
    expect(() => redactErrorAttrs(cycle)).not.toThrow();
  });

  it('leaves non-plain objects untouched (Map, Set, Error)', () => {
    const map = new Map([['password', 'should-not-be-traversed']]);
    const safe = redactErrorAttrs({ map, err: new Error('keep me') });
    expect(safe.map).toBe(map);
    expect(safe.err).toBeInstanceOf(Error);
  });
});

describe('opt-in cache (ENG-135)', () => {
  it('honours a tenant flip after the cache is cleared', async () => {
    const { sink, calls } = buildRecordingSink();
    registerTelemetrySink(sink);
    // First call sees opt-out → sink skipped.
    await captureException(
      new Error('one'),
      { tenantId: optOutTenantId },
      getDatabase()
    );
    expect(calls).toHaveLength(0);
    // Flip the flag.
    const db = getDatabase();
    await db
      .update(tenants)
      .set({
        settings: sql`json_set(COALESCE(${tenants.settings}, '{}'), '$.telemetryOptIn', json('true'))`,
      })
      .where(eq(tenants.id, optOutTenantId));
    // Cache still says opt-out without invalidation — pin that.
    await captureException(
      new Error('two'),
      { tenantId: optOutTenantId },
      getDatabase()
    );
    expect(calls).toHaveLength(0);
    // After clearing the cache the new state shows up.
    __clearTelemetryOptInCacheForTests();
    await captureException(
      new Error('three'),
      { tenantId: optOutTenantId },
      getDatabase()
    );
    expect(calls).toHaveLength(1);
  });

  it('vi.useFakeTimers — cache TTL expiry refreshes the opt-in state', async () => {
    vi.useFakeTimers();
    try {
      const { sink, calls } = buildRecordingSink();
      registerTelemetrySink(sink);
      // Initial: opt-out tenant, sink skipped.
      await captureException(
        new Error('one'),
        { tenantId: optOutTenantId },
        getDatabase()
      );
      expect(calls).toHaveLength(0);
      // Flip the tenant to opt-in.
      const db = getDatabase();
      await db
        .update(tenants)
        .set({
          settings: sql`json_set(COALESCE(${tenants.settings}, '{}'), '$.telemetryOptIn', json('true'))`,
        })
        .where(eq(tenants.id, optOutTenantId));
      // Advance past the 60s TTL.
      vi.advanceTimersByTime(61_000);
      await captureException(
        new Error('two'),
        { tenantId: optOutTenantId },
        getDatabase()
      );
      expect(calls).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
