import { beforeEach, describe, expect, it, vi } from 'vitest';

const { health } = vi.hoisted(() => ({ health: vi.fn() }));
vi.mock('../trpc', () => ({ vanillaClient: { health: { check: { query: health } } } }));

import { __resetApiBootstrapForTests, ensureApiBootstrap } from '../apiBootstrap';

beforeEach(() => {
  __resetApiBootstrapForTests();
  health.mockReset();
});

describe('safe HTTP bootstrap', () => {
  it('shares pending and completed initialization across auth and telemetry', async () => {
    let resolve!: (value: unknown) => void;
    health.mockReturnValue(
      new Promise(done => {
        resolve = done;
      })
    );
    const auth = ensureApiBootstrap();
    const rum = ensureApiBootstrap();
    expect(rum).toBe(auth);
    expect(health).toHaveBeenCalledTimes(1);
    resolve({ status: 'ok' });
    await expect(auth).resolves.toBeUndefined();
    expect(ensureApiBootstrap()).toBe(auth);
    expect(health).toHaveBeenCalledTimes(1);
  });

  it('does not retain a failed connection or retry it without a caller', async () => {
    const failure = new Error('offline');
    health.mockRejectedValueOnce(failure).mockResolvedValueOnce({ status: 'ok' });
    const auth = ensureApiBootstrap();
    expect(ensureApiBootstrap()).toBe(auth);
    await expect(auth).rejects.toBe(failure);
    expect(health).toHaveBeenCalledTimes(1);
    await expect(ensureApiBootstrap()).resolves.toBeUndefined();
    expect(health).toHaveBeenCalledTimes(2);
  });
});
