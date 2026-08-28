/**
 * review follow-up - realtime SSE tenant boundary tests.
 *
 * The fetch-based client sends the canonical access Bearer to
 * `/api/realtime/subscribe`. These tests pin tenant-scoped fanout and the
 * repeated access-session check that closes streams after revocation.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { EventEmitter } from 'node:events';
import { __withExpectedTestLogs } from '../logging/logger.js';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import {
  SSE_CLIENT_QUEUE_LIMIT_BYTES,
  SSE_REPLAY_GAP_EVENT,
  SSE_REPLAY_LIMIT,
  SseManager,
  generateClientId,
  resolveLastEventId,
  type SseClient,
} from '../realtime/sse.js';
import type { Context } from '../trpc/context.js';
import { signAccessToken } from '../security/authTokens.js';
import { resolveRealtimeTenantId } from '../realtime/sse/plugin.js';
import {
  authorizeRealtimeCollections,
  collectionsAllowedForRole,
  isRealtimeSubscriptionStillAuthorized,
  resolveRealtimeSubscription,
} from '../realtime/sse/authorization.js';
import { tenants } from '../db/schema.js';

let server: PuntovivoServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
});

function createReplyCapture(): { reply: FastifyReply; writes: string[] } {
  const writes: string[] = [];
  const reply = {
    raw: {
      write: (message: string) => {
        writes.push(message);
        return true;
      },
    },
  } as unknown as FastifyReply;
  return { reply, writes };
}

function createClient(args: { id: string; tenantId: string | null; collections?: string[] }): {
  client: SseClient;
  writes: string[];
} {
  const { reply, writes } = createReplyCapture();
  return {
    client: {
      id: args.id,
      reply,
      tenantId: args.tenantId,
      collections: args.collections ?? ['kds'],
      connectedAt: new Date('2026-05-19T00:00:00.000Z'),
    },
    writes,
  };
}

describe('SSE client id generator', () => {
  it('emits 32-hex-char ids with the sse_ prefix', () => {
    for (let i = 0; i < 5; i++) {
      const id = generateClientId();
      expect(id).toMatch(/^sse_[0-9a-f]{32}$/);
    }
  });

  it('produces 1000 unique ids in a row', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      seen.add(generateClientId());
    }
    expect(seen.size).toBe(1000);
  });
});

describe('SSE realtime tenant boundary', () => {
  it('rejects malformed collection and replay-cursor query shapes', async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });

    const response = await server.app.inject({
      method: 'GET',
      url: '/api/realtime/subscribe?collections=../admin&lastEventId=not-a-cursor',
    });

    expect(response.statusCode).toBe(400);
    expect(server.app.sse.getClientCount()).toBe(0);
  });

  it('does not deliver tenant-scoped broadcasts to anonymous or foreign-tenant clients', () => {
    const manager = new SseManager();
    const tenantA = createClient({ id: 'a', tenantId: 'tenant-a' });
    const tenantB = createClient({ id: 'b', tenantId: 'tenant-b' });
    const anonymous = createClient({ id: 'anon', tenantId: null });

    manager.addClient(tenantA.client);
    manager.addClient(tenantB.client);
    manager.addClient(anonymous.client);

    manager.broadcast('kds.order.created', { saleId: 'sale-1' }, 'tenant-a');

    expect(tenantA.writes).toHaveLength(1);
    expect(tenantB.writes).toHaveLength(0);
    expect(anonymous.writes).toHaveLength(0);
  });

  it('revalidates the canonical access session so revocation closes the stream', async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    const token = signAccessToken(server.app, admin);
    const request = {
      server: server.app,
      headers: { authorization: `Bearer ${token}` },
    } as Context['req'];

    await expect(resolveRealtimeTenantId(request)).resolves.toBe(admin.tenantId);

    await db
      .update(users)
      .set({ sessionVersion: admin.sessionVersion + 1 })
      .where(eq(users.id, admin.id));

    await expect(resolveRealtimeTenantId(request)).resolves.toBeNull();
  });
});

describe('SSE replay and backpressure', () => {
  it('honors Last-Event-ID before the hard-reopen query fallback', () => {
    expect(resolveLastEventId(' 41 ', '12')).toBe('41');
    expect(resolveLastEventId([' 42 ', '43'], '12')).toBe('42');
    expect(resolveLastEventId(undefined, ' 12 ')).toBe('12');
    expect(resolveLastEventId(undefined, undefined)).toBeNull();
  });

  it('replays only newer events for the authenticated tenant and subscribed collection', () => {
    const manager = new SseManager();
    manager.broadcast('kds.order.created', { saleId: 'sale-a' }, 'tenant-a');
    manager.broadcast('products.update', { productId: 'product-a' }, 'tenant-a');
    manager.broadcast('kds.order.created', { saleId: 'sale-b' }, 'tenant-b');

    const reconnect = createClient({ id: 'reconnect', tenantId: 'tenant-a' });
    manager.addClient(reconnect.client);
    const result = manager.replayTo(reconnect.client.id, '0');

    expect(result).toEqual({ replayed: 1, gap: false });
    expect(reconnect.writes).toHaveLength(1);
    expect(reconnect.writes[0]).toContain('id: 1');
    expect(reconnect.writes[0]).toContain('event: kds.order.created');
    expect(reconnect.writes[0]).not.toContain('product-a');
    expect(reconnect.writes[0]).not.toContain('sale-b');
  });

  it('keeps independent monotonic cursors per tenant', () => {
    const manager = new SseManager();
    const tenantA = createClient({ id: 'a', tenantId: 'tenant-a' });
    const tenantB = createClient({ id: 'b', tenantId: 'tenant-b' });
    manager.addClient(tenantA.client);
    manager.addClient(tenantB.client);

    manager.broadcast('kds.order.created', {}, 'tenant-a');
    manager.broadcast('kds.order.created', {}, 'tenant-b');
    manager.broadcast('kds.order.updated', {}, 'tenant-a');

    expect(tenantA.writes[0]).toContain('id: 1');
    expect(tenantA.writes[1]).toContain('id: 2');
    expect(tenantB.writes[0]).toContain('id: 1');
  });

  it('snapshots replay payloads at broadcast time', () => {
    const manager = new SseManager();
    const payload = { status: 'pending' };
    manager.broadcast('kds.order.updated', payload, 'tenant-a');
    payload.status = 'ready';
    const reconnect = createClient({ id: 'reconnect', tenantId: 'tenant-a' });
    manager.addClient(reconnect.client);

    manager.replayTo(reconnect.client.id, '0');

    expect(reconnect.writes[0]).toContain('"status":"pending"');
    expect(reconnect.writes[0]).not.toContain('ready');
  });

  it('emits a gap then replays the retained tail when history was evicted', () => {
    const manager = new SseManager();
    for (let index = 1; index <= SSE_REPLAY_LIMIT + 1; index += 1) {
      manager.broadcast('kds.order.updated', { index }, 'tenant-a');
    }
    const reconnect = createClient({ id: 'reconnect', tenantId: 'tenant-a' });
    manager.addClient(reconnect.client);

    const result = manager.replayTo(reconnect.client.id, '0');

    expect(result).toEqual({
      replayed: SSE_REPLAY_LIMIT,
      gap: true,
      reason: 'history-evicted',
    });
    expect(reconnect.writes).toHaveLength(SSE_REPLAY_LIMIT + 1);
    expect(reconnect.writes[0]).toContain(`event: ${SSE_REPLAY_GAP_EVENT}`);
    expect(reconnect.writes[0]).toContain('"oldestAvailableId":"2"');
    expect(reconnect.writes[1]).toContain('id: 2');
    expect(reconnect.writes.at(-1)).toContain(`id: ${SSE_REPLAY_LIMIT + 1}`);
  });

  it.each([
    ['not-a-number', 'cursor-invalid'],
    ['42', 'history-unavailable'],
  ])('signals %s cursors as %s when no replay history exists', (cursor, reason) => {
    const manager = new SseManager();
    const reconnect = createClient({ id: 'reconnect', tenantId: 'tenant-a' });
    manager.addClient(reconnect.client);

    expect(manager.replayTo(reconnect.client.id, cursor)).toEqual({
      replayed: 0,
      gap: true,
      reason,
    });
    expect(reconnect.writes[0]).toContain(`event: ${SSE_REPLAY_GAP_EVENT}`);
    expect(reconnect.writes[0]).toContain(`"reason":"${reason}"`);
  });

  it('signals a cursor ahead of retained history after a process restart', () => {
    const manager = new SseManager();
    manager.broadcast('kds.order.created', {}, 'tenant-a');
    const reconnect = createClient({ id: 'reconnect', tenantId: 'tenant-a' });
    manager.addClient(reconnect.client);

    expect(manager.replayTo(reconnect.client.id, '42')).toEqual({
      replayed: 0,
      gap: true,
      reason: 'cursor-ahead',
    });
    expect(reconnect.writes[0]).toContain('"reason":"cursor-ahead"');
  });

  it('queues while the socket is backpressured and flushes in order on drain', () => {
    const manager = new SseManager();
    const raw = new EventEmitter() as EventEmitter & {
      write: (message: string) => boolean;
      end: () => void;
      writable: boolean;
      writes: string[];
    };
    raw.writable = false;
    raw.writes = [];
    raw.write = message => {
      raw.writes.push(message);
      return raw.writable;
    };
    raw.end = vi.fn();
    const client: SseClient = {
      id: 'slow-then-ready',
      reply: { raw } as unknown as FastifyReply,
      tenantId: 'tenant-a',
      collections: ['kds'],
      connectedAt: new Date(),
    };
    manager.addClient(client);

    manager.broadcast('kds.order.created', { sequence: 1 }, 'tenant-a');
    manager.broadcast('kds.order.updated', { sequence: 2 }, 'tenant-a');
    expect(raw.writes).toHaveLength(1);

    raw.writable = true;
    raw.emit('drain');

    expect(raw.writes).toHaveLength(2);
    expect(raw.writes[0]).toContain('"sequence":1');
    expect(raw.writes[1]).toContain('"sequence":2');
    expect(manager.getClientCount()).toBe(1);
  });

  it('disconnects a slow client when its bounded queue is exhausted', async () => {
    const manager = new SseManager();
    const raw = new EventEmitter() as EventEmitter & {
      write: () => boolean;
      end: ReturnType<typeof vi.fn>;
    };
    raw.write = () => false;
    raw.end = vi.fn();
    const client: SseClient = {
      id: 'slow',
      reply: { raw } as unknown as FastifyReply,
      tenantId: 'tenant-a',
      collections: ['kds'],
      connectedAt: new Date(),
    };
    manager.addClient(client);

    expect(manager.sendTo(client.id, { event: 'kds.order.created', data: 'first' })).toBe(true);
    const accepted = await __withExpectedTestLogs(
      [
        {
          level: 'warn',
          module: 'sse',
          message: 'disconnecting slow SSE client',
        },
      ],
      () =>
        manager.sendTo(client.id, {
          event: 'kds.order.updated',
          data: 'x'.repeat(SSE_CLIENT_QUEUE_LIMIT_BYTES),
        })
    );
    expect(accepted).toBe(false);

    expect(raw.end).toHaveBeenCalledOnce();
    expect(manager.getClientCount()).toBe(0);
  });
});

describe('SSE collection authorization', () => {
  it('keeps cashier and viewer out of the detailed legacy sales collection', () => {
    expect(authorizeRealtimeCollections('cashier', ['sales'])).toEqual([]);
    expect(authorizeRealtimeCollections('viewer', ['sales'])).toEqual([]);
    expect(authorizeRealtimeCollections('manager', ['sales'])).toEqual(['sales']);
    expect(authorizeRealtimeCollections('admin', ['sales'])).toEqual(['sales']);
  });

  it('resolves an omitted collections parameter to the role set, not to everything', () => {
    // The firehose this replaces: no parameter used to mean every
    // collection in the tenant, for every authenticated role.
    expect(authorizeRealtimeCollections('cashier', [])).toEqual(['kds']);
    expect(authorizeRealtimeCollections('manager', [])).toEqual(['kds', 'companion', 'sales']);
  });

  it('grants viewer only the payload-free Companion invalidation collection', () => {
    expect(collectionsAllowedForRole('viewer')).toEqual(['companion']);
    expect(authorizeRealtimeCollections('viewer', [])).toEqual(['companion']);
    expect(authorizeRealtimeCollections('viewer', ['companion', 'sales'])).toEqual(['companion']);
  });

  it('drops an unknown collection instead of trusting the request', () => {
    expect(authorizeRealtimeCollections('admin', ['sales', 'payroll'])).toEqual(['sales']);
    expect(authorizeRealtimeCollections('admin', ['payroll'])).toEqual([]);
  });

  it('delivers nothing to a client that subscribed to no collection', () => {
    const manager = new SseManager();
    const silent = createClient({ id: 'silent', tenantId: 'tenant-a', collections: [] });
    manager.addClient(silent.client);

    manager.broadcast('kds.order.created', { saleId: 'sale-1' }, 'tenant-a');
    manager.broadcast('sales.completed', { id: 'sale-1' }, 'tenant-a');

    expect(silent.writes).toHaveLength(0);
  });

  it('answers 403 when the role may hear none of the requested collections', async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');

    const cashierId = 'user-sse-cashier';
    await db.insert(users).values({
      id: cashierId,
      tenantId: admin.tenantId,
      email: 'cashier-sse@localhost',
      name: 'Cashier SSE',
      passwordHash: admin.passwordHash,
      role: 'cashier',
    });
    const cashier = await db.select().from(users).where(eq(users.id, cashierId)).get();
    if (!cashier) throw new Error('Expected the inserted cashier');
    const token = signAccessToken(server.app, cashier);

    const response = await server.app.inject({
      method: 'GET',
      url: '/api/realtime/subscribe?collections=sales',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(403);
    expect(server.app.sse.getClientCount()).toBe(0);
  });

  it('honours and revalidates module gates for KDS and Companion', async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');

    // kds ships disabled, so the board's collection is not subscribable
    // until the tenant turns the module on - the same gate its route uses.
    await expect(
      resolveRealtimeSubscription({
        db,
        tenantId: admin.tenantId,
        role: 'cashier',
        requested: ['kds'],
      })
    ).resolves.toEqual([]);

    await expect(
      resolveRealtimeSubscription({
        db,
        tenantId: admin.tenantId,
        role: 'viewer',
        requested: ['companion'],
      })
    ).resolves.toEqual([]);

    const tenant = await db.select().from(tenants).where(eq(tenants.id, admin.tenantId)).get();
    const settings = (tenant?.settings ?? {}) as Record<string, unknown>;
    await db
      .update(tenants)
      .set({ settings: { ...settings, modules: { kds: true, companion: true } } })
      .where(eq(tenants.id, admin.tenantId));

    await expect(
      resolveRealtimeSubscription({
        db,
        tenantId: admin.tenantId,
        role: 'cashier',
        requested: ['kds'],
      })
    ).resolves.toEqual(['kds']);

    await expect(
      resolveRealtimeSubscription({
        db,
        tenantId: admin.tenantId,
        role: 'viewer',
        requested: ['companion'],
      })
    ).resolves.toEqual(['companion']);

    await expect(
      isRealtimeSubscriptionStillAuthorized({
        db,
        tenantId: admin.tenantId,
        role: 'cashier',
        granted: ['kds'],
      })
    ).resolves.toBe(true);

    await expect(
      isRealtimeSubscriptionStillAuthorized({
        db,
        tenantId: admin.tenantId,
        role: 'viewer',
        granted: ['companion'],
      })
    ).resolves.toBe(true);

    await db
      .update(tenants)
      .set({ settings: { ...settings, modules: { kds: false, companion: false } } })
      .where(eq(tenants.id, admin.tenantId));

    // A module revocation must also end an existing long-lived stream;
    // authenticating only once at connect time would leave KDS readable.
    await expect(
      isRealtimeSubscriptionStillAuthorized({
        db,
        tenantId: admin.tenantId,
        role: 'cashier',
        granted: ['kds'],
      })
    ).resolves.toBe(false);

    await expect(
      isRealtimeSubscriptionStillAuthorized({
        db,
        tenantId: admin.tenantId,
        role: 'viewer',
        granted: ['companion'],
      })
    ).resolves.toBe(false);
  });

  it('never pays the module read for a collection the role cannot hear', async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');

    await expect(
      resolveRealtimeSubscription({
        db,
        tenantId: admin.tenantId,
        role: 'cashier',
        requested: ['companion'],
      })
    ).resolves.toEqual([]);
  });

  it('does not report connected clients to an anonymous caller', async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });

    const response = await server.app.inject({
      method: 'GET',
      url: '/api/realtime/status',
    });

    expect(response.statusCode).toBe(401);
  });

  it('serves the authenticated caller a count of its own tenant only', async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    const token = signAccessToken(server.app, admin);

    // Two streams for the caller's tenant, three for somebody else's. The
    // unit test below pins the counting helper; this one pins the ROUTE,
    // so putting the unscoped call back would fail here even though the
    // helper still knows how to scope.
    server.app.sse.addClient(createClient({ id: 'mine-1', tenantId: admin.tenantId }).client);
    server.app.sse.addClient(createClient({ id: 'mine-2', tenantId: admin.tenantId }).client);
    for (const id of ['theirs-1', 'theirs-2', 'theirs-3']) {
      server.app.sse.addClient(createClient({ id, tenantId: 'tenant-somebody-else' }).client);
    }
    expect(server.app.sse.getClientCount()).toBe(5);

    const response = await server.app.inject({
      method: 'GET',
      url: '/api/realtime/status',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ clients: 2 });
  });

  it('counts only the caller tenant, never the whole install', () => {
    const manager = new SseManager();
    manager.addClient(createClient({ id: 'a1', tenantId: 'tenant-a' }).client);
    manager.addClient(createClient({ id: 'a2', tenantId: 'tenant-a' }).client);
    manager.addClient(createClient({ id: 'b1', tenantId: 'tenant-b' }).client);

    expect(manager.getClientCount('tenant-a')).toBe(2);
    expect(manager.getClientCount('tenant-b')).toBe(1);
    // A shop must not learn how busy the rest of the install is.
    expect(manager.getClientCount('tenant-c')).toBe(0);
  });
});
