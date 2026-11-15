/**
 * Main-thread side of the server worker: Puntovivo's settings for the host
 * supervisor. Electron-free so it runs under `node --test`.
 */
import type { ResourceLimits } from 'node:worker_threads';
import {
  createHost,
  type ExitDecision,
  type Host,
  type HostExit,
  type HostStartedEvent,
  type HostStats,
  type HostTransport,
} from '@electron-stagewright/host-supervisor';
import { workerThreadTransport } from '@electron-stagewright/host-supervisor/worker';
import {
  EMBEDDED_SERVER_OPERATIONS,
  SERVER_WORKER_OPERATIONS,
  type EmbeddedServerHost,
  type EmbeddedServerOperations,
  type ServerWorkerInfo,
  type ServerWorkerOperations,
  type WorkerStartOptions,
} from './contract.ts';

// Close waits for in-flight provider calls (fiscal adapters time out at 60 s);
// killing the worker earlier can lose an accepted document's verdict.
export const SERVER_WORKER_STOP_GRACE_MS = 90_000;

export type ServerWorkerHost = Host<ServerWorkerOperations, ServerWorkerInfo>;

export function serverWorkerTransport(
  workerPath: string,
  resourceLimits?: ResourceLimits
): HostTransport {
  return workerThreadTransport({
    entry: workerPath,
    name: 'server-worker',
    ...(resourceLimits ? { resourceLimits } : {}),
  });
}

export function createServerWorkerHost(options: {
  transport: HostTransport;
  payload: () => Promise<WorkerStartOptions>;
  onExit?: (exit: HostExit) => ExitDecision;
  onStarted?: (event: HostStartedEvent<ServerWorkerInfo>) => void;
  onStats?: (stats: HostStats) => void;
  stopGraceMs?: number;
}): ServerWorkerHost {
  return createHost<ServerWorkerOperations, WorkerStartOptions, ServerWorkerInfo>({
    operations: SERVER_WORKER_OPERATIONS,
    transport: options.transport,
    start: { payload: options.payload },
    stop: { graceMs: options.stopGraceMs ?? SERVER_WORKER_STOP_GRACE_MS },
    // No per-call timeout: handlers ignore the abort signal, so a timeout
    // would report a failure for work that still completes in the worker.
    ...(options.onExit ? { onExit: options.onExit } : {}),
    ...(options.onStarted ? { onStarted: options.onStarted } : {}),
    ...(options.onStats ? { onStats: options.onStats } : {}),
  });
}

/** Starts the worker if needed and returns main's handle on it. */
export async function connectServerWorker(
  host: ServerWorkerHost,
  options: { allowTestCrash?: boolean } = {}
): Promise<EmbeddedServerHost> {
  const info = await host.start();
  if (!info) throw new Error('SERVER_WORKER_NO_URL');
  const { url } = info;
  const operations = Object.fromEntries(
    EMBEDDED_SERVER_OPERATIONS.map(op => [op, (...args: unknown[]) => host.call(op, args as never)])
  ) as unknown as EmbeddedServerOperations;
  // The crash ends the call in flight; only the exit matters.
  const fault = (op: 'testCrash' | 'testOutOfMemory') => () =>
    void host.call(op, []).catch(() => undefined);
  return {
    ...operations,
    url,
    close: () => host.stop(),
    ...(options.allowTestCrash
      ? { simulateCrash: fault('testCrash'), simulateOutOfMemory: fault('testOutOfMemory') }
      : {}),
  };
}
