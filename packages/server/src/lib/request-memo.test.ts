import { describe, expect, it, vi } from 'vitest';
import { memoizeInScope, withRequestMemo } from './request-memo.js';

describe('request memo', () => {
  it('computes every time outside a scope', () => {
    const compute = vi.fn(() => 1);
    memoizeInScope('key', compute);
    memoizeInScope('key', compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('shares one value per key across awaits inside a scope', async () => {
    const compute = vi.fn(async () => ({ value: 1 }));
    const [first, second] = await withRequestMemo(async () => {
      const a = await memoizeInScope('key', compute);
      await Promise.resolve();
      const b = await memoizeInScope('key', compute);
      return [a, b];
    });
    expect(compute).toHaveBeenCalledOnce();
    expect(second).toBe(first);
  });

  it('keeps concurrent scopes apart', async () => {
    let next = 0;
    const read = () => memoizeInScope('key', () => (next += 1));
    const results = await Promise.all([
      withRequestMemo(async () => [read(), await Promise.resolve(read())]),
      withRequestMemo(async () => [read(), await Promise.resolve(read())]),
    ]);
    expect(results).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('drops a rejected promise so the next read retries', async () => {
    const compute = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValueOnce(7);
    await withRequestMemo(async () => {
      await expect(memoizeInScope('key', compute)).rejects.toThrow('busy');
      await expect(memoizeInScope('key', compute)).resolves.toBe(7);
    });
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
