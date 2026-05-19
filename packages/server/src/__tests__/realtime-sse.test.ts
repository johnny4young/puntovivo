/**
 * ENG-098 review follow-up - realtime SSE tenant boundary tests.
 *
 * The browser EventSource API cannot send Authorization headers, so
 * KDS obtains a short-lived realtime token via authenticated tRPC and
 * passes it to `/api/realtime/subscribe`. These tests pin both sides
 * of that contract: tokens are scoped to the realtime JWT type, and
 * tenant-scoped broadcasts never fan out to anonymous subscribers.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import { SseManager, type SseClient } from '../realtime/sse.js';
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
      },
    },
  } as unknown as FastifyReply;
  return { reply, writes };
}

function createClient(args: {
  id: string;
  tenantId: string | null;
  collections?: string[];
}): { client: SseClient; writes: string[] } {
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
    const admin = await db
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
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
        sameSite: 'lax',
        secure: false,
      })
    );
    const token = setCookie.mock.calls[0]?.[1] as string | undefined;
    if (!token) throw new Error('Expected realtime cookie token');

    const realtimePayload = await verifyTokenWithServer(
      server.app,
      token,
      'realtime'
    );
    const accessPayload = await verifyTokenWithServer(server.app, token, 'access');

    expect(issued.expiresInSeconds).toBe(REALTIME_TOKEN_MAX_AGE_SECONDS);
    expect(realtimePayload?.tenantId).toBe(admin.tenantId);
    expect(realtimePayload?.userId).toBe(admin.id);
    expect(accessPayload).toBeNull();
  });
});
