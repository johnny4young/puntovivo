/**
 * review follow-up - realtime SSE tenant boundary tests.
 *
 * The browser EventSource API cannot send Authorization headers, so
 * KDS obtains a short-lived realtime token via authenticated tRPC and
 * passes it to `/api/realtime/subscribe`. These tests pin both sides
 * of that contract: tokens are scoped to the realtime JWT type, and
 * tenant-scoped broadcasts never fan out to anonymous subscribers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { EventEmitter } from 'node:events';
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
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import {
  REALTIME_COOKIE_NAME,
  REALTIME_TOKEN_MAX_AGE_SECONDS,
  verifyTokenWithServer,
} from '../security/authTokens.js';

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

  it('issues a realtime-only token for authenticated tenant sessions', async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');

    const setCookie = vi.fn();
    const caller = appRouter.createCaller({
      req: {
        server: server.app,
        headers: {},
        protocol: 'http',
      } as Context['req'],
      res: { setCookie } as unknown as Context['res'],
      db,
      user: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
        tenantId: admin.tenantId,
      },
      tenantId: admin.tenantId,
      siteId: null,
    });

    const issued = await caller.auth.realtimeToken();
    expect(setCookie).toHaveBeenCalledWith(
      REALTIME_COOKIE_NAME,
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        maxAge: REALTIME_TOKEN_MAX_AGE_SECONDS,
        path: '/api/realtime',
        sameSite: 'strict',
        secure: false,
      })
    );
    const token = setCookie.mock.calls[0]?.[1] as string | undefined;
    if (!token) throw new Error('Expected realtime cookie token');

    const realtimePayload = await verifyTokenWithServer(server.app, token, 'realtime');
    const accessPayload = await verifyTokenWithServer(server.app, token, 'access');

    expect(issued.expiresInSeconds).toBe(REALTIME_TOKEN_MAX_AGE_SECONDS);
    expect(realtimePayload?.tenantId).toBe(admin.tenantId);
    expect(realtimePayload?.userId).toBe(admin.id);
    expect(accessPayload).toBeNull();
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

  it('disconnects a slow client when its bounded queue is exhausted', () => {
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
    expect(
      manager.sendTo(client.id, {
        event: 'kds.order.updated',
        data: 'x'.repeat(SSE_CLIENT_QUEUE_LIMIT_BYTES),
      })
    ).toBe(false);

    expect(raw.end).toHaveBeenCalledOnce();
    expect(manager.getClientCount()).toBe(0);
  });
});
