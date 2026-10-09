import { describe, expect, it } from 'vitest';

import { withClientAbortSignal } from './request-abort.js';

describe('withClientAbortSignal', () => {
  it('hands the request signal to active work and lets the work observe an abort', async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    const work = withClientAbortSignal(controller.signal, async nextSignal => {
      signal = nextSignal;
      await new Promise<void>(resolve => nextSignal?.addEventListener('abort', () => resolve()));
    });

    controller.abort();
    await work;
    expect(signal).toBe(controller.signal);
    expect(signal?.aborted).toBe(true);
  });

  it('aborts before work starts when the request signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    let enteredWork = false;
    await expect(
      withClientAbortSignal(controller.signal, async () => {
        enteredWork = true;
      })
    ).rejects.toMatchObject({ name: 'TRPCError', code: 'CLIENT_CLOSED_REQUEST' });
    expect(enteredWork).toBe(false);
  });

  it('reports a cancellation raised by downstream admission as a client close', async () => {
    const controller = new AbortController();
    const work = withClientAbortSignal(controller.signal, async signal => {
      await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve()));
      signal?.throwIfAborted();
    });
    controller.abort();
    await expect(work).rejects.toMatchObject({ code: 'CLIENT_CLOSED_REQUEST' });
  });

  it('keeps a non-abort failure unchanged even after the client closed', async () => {
    const controller = new AbortController();
    const work = withClientAbortSignal(controller.signal, async signal => {
      await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve()));
      throw new Error('provider failed');
    });
    controller.abort();
    await expect(work).rejects.toThrow('provider failed');
  });

  it('does not relabel a server-side timeout as a client close', async () => {
    const controller = new AbortController();
    const timeout = new DOMException('deadline', 'TimeoutError');
    const work = withClientAbortSignal(controller.signal, async signal => {
      await new Promise<void>(resolve => signal?.addEventListener('abort', () => resolve()));
      throw timeout;
    });
    controller.abort();
    await expect(work).rejects.toBe(timeout);
  });

  it('runs signal-less direct callers unchanged', async () => {
    await expect(withClientAbortSignal(undefined, async signal => signal)).resolves.toBeUndefined();
    await expect(
      withClientAbortSignal(undefined, async () => {
        throw new Error('provider failed');
      })
    ).rejects.toThrow('provider failed');
  });
});
