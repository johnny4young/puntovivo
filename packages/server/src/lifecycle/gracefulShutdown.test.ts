import { describe, expect, it, vi } from 'vitest';
import { createGracefulShutdownHandler } from './gracefulShutdown.js';

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>(innerResolve => {
    resolve = innerResolve;
  });

  return { promise, resolve };
}

describe('createGracefulShutdownHandler', () => {
  it('closes once and exits successfully', async () => {
    const exitCodes: number[] = [];
    const close = vi.fn(async () => {});
    const log = {
      info: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    const shutdown = createGracefulShutdownHandler({
      close,
      log,
      exit: code => {
        exitCodes.push(code);
      },
    });

    await shutdown('SIGTERM');

    expect(close).toHaveBeenCalledTimes(1);
    expect(exitCodes).toEqual([0]);
    expect(log.info).toHaveBeenCalledWith({ signal: 'SIGTERM' }, 'shutdown complete');
  });

  it('reuses the in-flight shutdown when multiple signals arrive', async () => {
    const pendingClose = deferred();
    const exitCodes: number[] = [];
    const close = vi.fn(() => pendingClose.promise);
    const log = {
      info: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    const shutdown = createGracefulShutdownHandler({
      close,
      log,
      exit: code => {
        exitCodes.push(code);
      },
    });

    const firstShutdown = shutdown('SIGTERM');
    const secondShutdown = shutdown('SIGINT');

    expect(secondShutdown).toBe(firstShutdown);
    expect(close).toHaveBeenCalledTimes(1);

    pendingClose.resolve();
    await firstShutdown;

    expect(exitCodes).toEqual([0]);
    expect(log.info).toHaveBeenCalledWith({ signal: 'SIGINT' }, 'shutdown already in progress');
  });

  it('exits with failure when close rejects', async () => {
    const err = new Error('close failed');
    const exitCodes: number[] = [];
    const close = vi.fn(async () => {
      throw err;
    });
    const log = {
      info: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    };

    const shutdown = createGracefulShutdownHandler({
      close,
      log,
      exit: code => {
        exitCodes.push(code);
      },
    });

    await shutdown('SIGTERM');

    expect(exitCodes).toEqual([1]);
    expect(log.fatal).toHaveBeenCalledWith({ err, signal: 'SIGTERM' }, 'shutdown failed');
  });

  it('exits once when close exceeds the shutdown timeout', async () => {
    vi.useFakeTimers();

    try {
      const pendingClose = deferred();
      const exitCodes: number[] = [];
      const close = vi.fn(() => pendingClose.promise);
      const log = {
        info: vi.fn(),
        error: vi.fn(),
        fatal: vi.fn(),
      };

      const shutdown = createGracefulShutdownHandler({
        close,
        log,
        timeoutMs: 50,
        exit: code => {
          exitCodes.push(code);
        },
      });

      const shutdownPromise = shutdown('SIGTERM');
      await vi.advanceTimersByTimeAsync(50);

      expect(exitCodes).toEqual([1]);
      expect(log.error).toHaveBeenCalledWith(
        { signal: 'SIGTERM', timeoutMs: 50 },
        'shutdown timed out'
      );

      pendingClose.resolve();
      await shutdownPromise;

      expect(exitCodes).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
