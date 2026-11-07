/**
 * Main-thread side of the server worker: starts it, forwards the host
 * contract as messages, and stops it. Electron-free so it runs under
 * `node --test` with a stub worker.
 */
import { Worker } from 'node:worker_threads';
import type { ServerOptions } from '@puntovivo/server';
import type { EmbeddedServerHost, EmbeddedServerOperations } from './contract.ts';
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
export interface WorkerLike {
  postMessage(message: MainToWorkerMessage): void;
  on(event: 'message', listener: (message: WorkerToMainMessage) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number>;
}

export interface WorkerServerHostOptions {
  /** Absolute path of the bundled `server-worker.cjs`. */
  workerPath: string;
  start: WorkerStartOptions;
  /** Called once when the worker dies outside `close()`. */
  onUnexpectedExit: (error: Error) => void;
  stopGraceMs?: number;
  createWorker?: (path: string) => WorkerLike;
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
  let stopError: Error | null = null;
  let onStarted: ((url: string) => void) | null = null;
  let onStartFailed: ((error: Error) => void) | null = null;
  let resolveExit!: () => void;
  const exitedPromise = new Promise<void>(resolve => {
    resolveExit = resolve;
  });

  worker.on('message', message => {
    switch (message.type) {
      case 'started':
        onStarted?.(message.url);
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
        if (message.error) stopError = deserializeError(message.error);
        return;
    }
  });
  worker.on('error', error => {
    lastError = error;
  });
  worker.on('exit', code => {
    exited = true;
    const reason = lastError ?? new Error(`SERVER_WORKER_EXITED: code ${code}`);
    for (const call of pending.values()) call.reject(reason);
    pending.clear();
    onStartFailed?.(reason);
    resolveExit();
    if (!stopping) options.onUnexpectedExit(reason);
  });

  async function stopWorker(): Promise<void> {
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
    }
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
    stopping = false;
  } catch (error) {
    await stopWorker();
    throw error;
  } finally {
    onStarted = null;
    onStartFailed = null;
  }

  function call(op: OperationName, args: unknown[]): Promise<unknown> {
    if (exited) return Promise.reject(new Error('The embedded server is not available'));
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
  };
}

/** Launcher for the server lifecycle that runs each server in a new worker. */
export function createWorkerLauncher(deps: {
  workerPath: string;
  /** Converts a legacy anchor file first; undefined for env-key installs. */
  resolveAuditAnchorStoreLocation: () => Promise<WorkerStartOptions['auditAnchorStore']>;
  onUnexpectedExit: (error: Error) => void;
  createWorker?: (path: string) => WorkerLike;
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
    });
  };
}
