import { EventEmitter } from 'node:events';
import type { FastifyReply } from 'fastify';
import { describe, expect, it } from 'vitest';

import { withClientAbortSignal } from './request-abort.js';

function replyFixture() {
  const raw = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableFinished: false,
  });
  return { raw, reply: { raw } as unknown as FastifyReply };
}

describe('withClientAbortSignal', () => {
  it('aborts active work when the response closes before completion and removes the listener', async () => {
    const { raw, reply } = replyFixture();
    let signal: AbortSignal | undefined;
    const work = withClientAbortSignal(reply, async nextSignal => {
      signal = nextSignal;
      await new Promise<void>(resolve => nextSignal?.addEventListener('abort', () => resolve()));
    });

    expect(raw.listenerCount('close')).toBe(1);
    raw.destroyed = true;
    raw.emit('close');
    await work;
    expect(signal?.aborted).toBe(true);
    expect(raw.listenerCount('close')).toBe(0);
  });

  it('does not abort on a completed response and removes the listener after work', async () => {
    const { raw, reply } = replyFixture();
    let signal: AbortSignal | undefined;
    await withClientAbortSignal(reply, async nextSignal => {
      signal = nextSignal;
      raw.writableFinished = true;
      raw.emit('close');
    });
    expect(signal?.aborted).toBe(false);
    expect(raw.listenerCount('close')).toBe(0);
  });

  it('aborts before work starts when the response is already destroyed', async () => {
    const { raw, reply } = replyFixture();
    raw.destroyed = true;
    let enteredWork = false;
    await expect(
      withClientAbortSignal(reply, async () => {
        enteredWork = true;
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(enteredWork).toBe(false);
    expect(raw.listenerCount('close')).toBe(0);
  });

  it('supports HTTP-less direct callers and cleans up after a rejection', async () => {
    await expect(
      withClientAbortSignal({} as FastifyReply, async signal => signal)
    ).resolves.toBeUndefined();
    const { raw, reply } = replyFixture();
    await expect(
      withClientAbortSignal(reply, async () => {
        throw new Error('provider failed');
      })
    ).rejects.toThrow('provider failed');
    expect(raw.listenerCount('close')).toBe(0);
  });
});
