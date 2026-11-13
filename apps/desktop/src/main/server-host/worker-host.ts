/**
 * Main-thread side of the server worker: starts it, forwards the host
 * contract as messages, and stops it. Electron-free so it runs under
 * `node --test` with a stub worker.
 */
import { Worker } from 'node:worker_threads';
import type { ServerOptions } from '@puntovivo/server';
import type { EmbeddedServerHost, EmbeddedServerOperations } from './contract.ts';
import type { WorkerExitFailure, WorkerExitKind } from './restart-policy.ts';
import {
  deserializeError,
  OPERATION_NAMES,
  type MainToWorkerMessage,
  type OperationName,
  type WorkerStartOptions,
  type WorkerToMainMessage,
} from './protocol.ts';

// Close waits for in-flight provider calls (fiscal adapters time out at 60 s);
// killing the worker earlier can lose an accepted document's verdict.
const DEFAULT_STOP_GRACE_MS = 90_000;

const createNodeWorker = (path: string): WorkerLike => new Worker(path) as unknown as WorkerLike;

/** The part of `worker_threads.Worker` the host relies on. */
export interface ThreadLike<In, Out> {
  postMessage(message: In): void;
  on(event: 'message', listener: (message: Out) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
}

export type WorkerLike = ThreadLike<MainToWorkerMessage, WorkerToMainMessage>;

export interface WorkerServerHostOptions {
  /** Absolute path of the bundled `server-worker.cjs`. */
  workerPath: string;
  start: WorkerStartOptions;
  /** Called once when the worker dies outside `close()`. */
  onUnexpectedExit: (failure: WorkerExitFailure) => void;
  stopGraceMs?: number;
  createWorker?: (path: string) => WorkerLike;
  /** Lets E2E and soak runs crash the worker on purpose. */
  allowTestCrash?: boolean;
  now?: () => number;
}

/** Spawns the worker and resolves once its server listens. */
export async function startWorkerServerHost(
  options: WorkerServerHostOptions
): Promise<EmbeddedServerHost> {
  const worker = (options.createWorker ?? createNodeWorker)(options.workerPath);
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (e: Error) => void }
  >();
  let nextId = 1;
  let stopping = false;
  let exited = false;
  let lastError: Error | null = null;
  let exitKind: WorkerExitKind = 'unknown';
  const now = options.now ?? Date.now;
  let startedAt = now();
  let stopError: Error | null = null;
  let stoppedReceived = false;
  let onStarted: ((url: string) => void) | null = null;
  let onStartFailed: ((error: Error) => void) | null = null;
  let resolveExit!: () => void;
  const exitedPromise = new Promise<void>(resolve => {
    resolveExit = resolve;
  });

  worker.on('message', message => {
    switch (message.type) {
      case 'started':
        startedAt = now();
        onStarted?.(message.url);
        return;
      case 'crashed':
        lastError = deserializeError(message.error);
        exitKind = 'uncaught';
        return;
      case 'start-failed':
        onStartFailed?.(deserializeError(message.error));
        return;
      case 'result': {
        const call = pending.get(message.id);
        if (!call) return;
        pending.delete(message.id);
        if (message.ok) call.resolve(message.value);
        else call.reject(deserializeError(message.error));
        return;
      }
      case 'stopped':
        stoppedReceived = true;
        if (message.error) stopError = deserializeError(message.error);
        return;
    }
  });
  worker.on('error', error => {
    lastError = error;
    exitKind =
      (error as { code?: unknown }).code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'oom' : 'uncaught';
  });
  worker.on('exit', code => {
    exited = true;
    const reason = lastError ?? new Error(`SERVER_WORKER_EXITED: code ${code}`);
    const pendingCalls = pending.size;
    for (const call of pending.values()) call.reject(reason);
    pending.clear();
    onStartFailed?.(reason);
    resolveExit();
    if (!stopping) {
      options.onUnexpectedExit({
        error: reason,
        kind: exitKind,
        exitCode: code,
        uptimeMs: Math.max(0, now() - startedAt),
        pendingCalls,
      });
    }
  });

  let stopPromise: Promise<void> | null = null;
  // Concurrent callers share one stop, so the server closes once.
  function stopWorker(): Promise<void> {
    stopPromise ??= stopOnce();
    return stopPromise;
  }

  async function stopOnce(): Promise<void> {
    if (exited) return;
    stopping = true;
    worker.postMessage({ type: 'stop' });
    const grace = options.stopGraceMs ?? DEFAULT_STOP_GRACE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      exitedPromise,
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, grace);
      }),
    ]);
    clearTimeout(timer);
    if (!exited) {
      await worker.terminate();
      await exitedPromise;
      // The server never finished closing, so nothing may touch its files.
      stopError ??= new Error('SERVER_WORKER_STOP_TIMEOUT');
    }
    // An exit without the stopped reply means close crashed part way.
    if (!stoppedReceived) stopError ??= new Error('SERVER_WORKER_STOP_INCOMPLETE');
    // Callers such as a restore must not carry on past a failed close.
    if (stopError) throw stopError;
  }

  let url: string;
  try {
    // Unexpected exits before `started` are start failures, not crashes.
    stopping = true;
    url = await new Promise<string>((resolve, reject) => {
      onStarted = resolve;
      onStartFailed = reject;
      worker.postMessage({ type: 'start', options: options.start });
    });
    // A thread that died while `started` was in flight is not a running server.
    if (exited) throw lastError ?? new Error('SERVER_WORKER_EXITED: right after start');
    stopping = false;
  } catch (error) {
    // The start failure is the cause the caller needs, not the cleanup's.
    await stopWorker().catch(() => undefined);
    throw error;
  } finally {
    onStarted = null;
    onStartFailed = null;
  }

  function call(op: OperationName, args: unknown[]): Promise<unknown> {
    if (stopping || exited)
      return Promise.reject(new Error('The embedded server is not available'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        worker.postMessage({ type: 'call', id, op, args });
      } catch (error) {
        pending.delete(id);
        reject(error);
      }
    });
  }

  const operations = Object.fromEntries(
    OPERATION_NAMES.map(op => [op, (...args: unknown[]) => call(op, args)])
  ) as unknown as EmbeddedServerOperations;

  return {
    ...operations,
    url,
    close: stopWorker,
    ...(options.allowTestCrash
      ? { simulateCrash: () => worker.postMessage({ type: 'test-crash' }) }
      : {}),
  };
}

/** Launcher for the server lifecycle that runs each server in a new worker. */
export function createWorkerLauncher(deps: {
  workerPath: string;
  /** Converts a legacy anchor file first; undefined for env-key installs. */
  resolveAuditAnchorStoreLocation: () => Promise<WorkerStartOptions['auditAnchorStore']>;
  onUnexpectedExit: (failure: WorkerExitFailure) => void;
  createWorker?: (path: string) => WorkerLike;
  allowTestCrash?: boolean;
}): (options: ServerOptions) => Promise<EmbeddedServerHost> {
  return async options => {
    const auditAnchorStore = await deps.resolveAuditAnchorStoreLocation();
    return startWorkerServerHost({
      workerPath: deps.workerPath,
      start: {
        serverOptions: options as unknown as Record<string, unknown>,
        ...(auditAnchorStore ? { auditAnchorStore } : {}),
      },
      onUnexpectedExit: deps.onUnexpectedExit,
      ...(deps.createWorker ? { createWorker: deps.createWorker } : {}),
      ...(deps.allowTestCrash ? { allowTestCrash: true } : {}),
    });
  };
}
