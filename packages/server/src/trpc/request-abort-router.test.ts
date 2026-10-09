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

function adminContext() {
  return {
    req: { server: server.app, headers: {} },
    res: {},
    db: getDatabase(),
    user: {
      id: 'test-admin',
      email: 'admin@example.test',
      role: 'admin',
      tenantId: 'test-tenant',
    },
    tenantId: 'test-tenant',
    siteId: null,
  } as unknown as Context;
}

describe('AI HTTP cancellation', () => {
  it('hands the connection test the request signal and lets a dispatched call finish', async () => {
    const controller = new AbortController();
    let finish!: () => void;
    completeAIMock.mockImplementationOnce(async (invocation: { abortSignal?: AbortSignal }) => {
      // The service checks the signal only before admission; once dispatched,
      // a client close must not cancel the provider call or its settlement.
      invocation.abortSignal?.throwIfAborted();
      await new Promise<void>(resolve => {
        finish = resolve;
      });
      return { text: 'pong', costUsd: 0.001, durationMs: 5, provider: 'anthropic', model: 'm' };
    });
    const call = appRouter
      .createCaller(adminContext(), { signal: controller.signal })
      .ai.completeTest();
    await vi.waitFor(() => expect(completeAIMock).toHaveBeenCalledOnce());
    const invocation = completeAIMock.mock.calls[0]?.[0] as { abortSignal?: AbortSignal };
    expect(invocation.abortSignal?.aborted).toBe(false);
    controller.abort();
    expect(invocation.abortSignal?.aborted).toBe(true);
    finish();
    await expect(call).resolves.toMatchObject({ text: 'pong' });
  });

  it('rejects a request whose client is already gone as CLIENT_CLOSED_REQUEST', async () => {
    const controller = new AbortController();
    controller.abort();
    completeAIMock.mockClear();
    await expect(
      appRouter.createCaller(adminContext(), { signal: controller.signal }).ai.completeTest()
    ).rejects.toMatchObject({ code: 'CLIENT_CLOSED_REQUEST' });
    expect(completeAIMock).not.toHaveBeenCalled();
  });
});
