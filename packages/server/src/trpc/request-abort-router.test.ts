import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Context } from './context.js';

const completeAIMock = vi.hoisted(() => vi.fn());
vi.mock('../services/ai/index.js', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/ai/index.js')>()),
  completeAI: completeAIMock,
}));

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { appRouter } from './router.js';

let server: PuntovivoServer;

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

describe('AI HTTP cancellation', () => {
  it('forwards a premature response close to the connection-test provider call', async () => {
    const raw = Object.assign(new EventEmitter(), {
      destroyed: false,
      writableFinished: false,
    });
    completeAIMock.mockImplementationOnce(async (invocation: { abortSignal?: AbortSignal }) => {
      await new Promise<never>((_, reject) => {
        invocation.abortSignal?.addEventListener('abort', () => reject(new Error('cancelled')));
      });
    });
    const ctx = {
      req: { server: server.app, headers: {} },
      res: { raw },
      db: getDatabase(),
      user: {
        id: 'test-admin',
        email: 'admin@example.test',
        role: 'admin',
        tenantId: 'test-tenant',
      },
      tenantId: 'test-tenant',
      siteId: null,
    } as Context;
    const call = appRouter.createCaller(ctx).ai.completeTest();
    await vi.waitFor(() => expect(completeAIMock).toHaveBeenCalledOnce());
    const invocation = completeAIMock.mock.calls[0]?.[0] as { abortSignal?: AbortSignal };
    expect(invocation.abortSignal?.aborted).toBe(false);
    raw.destroyed = true;
    raw.emit('close');
    await expect(call).rejects.toThrow('cancelled');
    expect(invocation.abortSignal?.aborted).toBe(true);
    expect(raw.listenerCount('close')).toBe(0);
  });
});
