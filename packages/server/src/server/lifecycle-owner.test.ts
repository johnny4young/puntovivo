import { describe, expect, it } from 'vitest';
import { rethrowAfterLifecycleCleanup, ServerLifecycleOwner } from './lifecycle-owner.js';

describe('ServerLifecycleOwner', () => {
  it('cleans resources in reverse acquisition order exactly once', async () => {
    const owner = new ServerLifecycleOwner();
    const calls: string[] = [];
    owner.defer('database', () => calls.push('database'));
    owner.defer('timer', () => calls.push('timer'));
    owner.defer('fastify', async () => calls.push('fastify'));

    await owner.dispose();
    await owner.dispose();

    expect(calls).toEqual(['fastify', 'timer', 'database']);
  });

  it('continues after failure and retries only the cleanup that failed', async () => {
    const owner = new ServerLifecycleOwner();
    const calls: string[] = [];
    let fail = true;
    owner.defer('database', () => calls.push('database'));
    owner.defer('timer', () => {
      calls.push('timer');
      if (fail) throw new Error('timer stuck');
    });
    owner.defer('fastify', () => calls.push('fastify'));

    await expect(owner.dispose()).rejects.toThrow(/timer/);
    expect(calls).toEqual(['fastify', 'timer', 'database']);

    fail = false;
    await owner.dispose();
    expect(calls).toEqual(['fastify', 'timer', 'database', 'timer']);
  });

  it('deduplicates concurrent disposal', async () => {
    const owner = new ServerLifecycleOwner();
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    let calls = 0;
    owner.defer('async-resource', async () => {
      calls += 1;
      await gate;
    });

    const first = owner.dispose();
    const second = owner.dispose();
    expect(second).toBe(first);
    release();
    await first;
    expect(calls).toBe(1);
  });

  it('preserves the bootstrap error and attaches cleanup failure', async () => {
    const owner = new ServerLifecycleOwner();
    const primary = new Error('bootstrap failed');
    owner.defer('broken-resource', () => {
      throw new Error('cleanup failed');
    });

    const error = await rethrowAfterLifecycleCleanup(
      owner,
      primary,
      'Server bootstrap failed'
    ).catch(caught => caught);
    expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).cause).toBe(primary);
    expect((error as AggregateError).errors).toHaveLength(2);
  });

  it('rethrows the original failure when cleanup succeeds', async () => {
    const owner = new ServerLifecycleOwner();
    const primary = new Error('listen failed');
    owner.defer('clean-resource', () => {});

    await expect(rethrowAfterLifecycleCleanup(owner, primary, 'Server listen failed')).rejects.toBe(
      primary
    );
  });
});
