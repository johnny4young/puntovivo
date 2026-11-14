/**
 * Main-thread side of the server worker: Puntovivo's settings for the host
 * supervisor. Electron-free so it runs under `node --test`.
 */
import type { ResourceLimits } from 'node:worker_threads';
import {
  createHost,
  type ExitDecision,
  type Host,
  type HostChannel,
  type HostExit,
  type HostStats,
  type HostTransport,
} from '@electron-stagewright/host-supervisor';
import { workerThreadTransport } from '@electron-stagewright/host-supervisor/worker';
import {
  EMBEDDED_SERVER_OPERATIONS,
  SERVER_WORKER_OPERATIONS,
  type EmbeddedServerHost,
  type EmbeddedServerOperations,
  type ServerWorkerOperations,
  type WorkerStartOptions,
} from './contract.ts';

// Close waits for in-flight provider calls (fiscal adapters time out at 60 s);
// killing the worker earlier can lose an accepted document's verdict.
export const SERVER_WORKER_STOP_GRACE_MS = 90_000;

export type ServerWorkerHost = Host<ServerWorkerOperations>;

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
  onStats?: (stats: HostStats) => void;
  stopGraceMs?: number;
}): ServerWorkerHost {
  return createHost<ServerWorkerOperations, WorkerStartOptions>({
    operations: SERVER_WORKER_OPERATIONS,
    transport: options.transport,
    start: { payload: options.payload },
    stop: { graceMs: options.stopGraceMs ?? SERVER_WORKER_STOP_GRACE_MS },
    // No per-call timeout: handlers ignore the abort signal, so a timeout
    // would report a failure for work that still completes in the worker.
    ...(options.onExit ? { onExit: options.onExit } : {}),
    ...(options.onStats ? { onStats: options.onStats } : {}),
  });
}

/** Starts the worker if needed and returns main's handle on it. */
export async function connectServerWorker(
  host: ServerWorkerHost,
  options: { allowTestCrash?: boolean } = {}
): Promise<EmbeddedServerHost> {
  await host.start();
  const url = await host.call('getUrl', []);
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

/** What main sees of each worker beyond the supervisor's own view. */
export interface ServerWorkerEvents {
  /** False while main holds the database (restore, shutdown): no worker may launch. */
  canLaunch?: () => boolean;
  /** The worker answered `start`; for a crash restart this is the only signal. */
  onStarted?: () => void;
  /** Called before the supervisor hears of an exit; true when the worker reported its cause. */
  onExit?: (reported: boolean) => void;
}

/** Wraps a transport to see starts and crash reports without changing them. */
export function observeServerWorker(
  transport: HostTransport,
  events: ServerWorkerEvents
): HostTransport {
  return {
    launch(): HostChannel {
      if (events.canLaunch && !events.canLaunch()) throw new Error('SERVER_WORKER_HELD');
      const channel = transport.launch();
      let reported = false;
      return {
        send: message => channel.send(message),
        kill: () => channel.kill(),
        onMessage: listener =>
          channel.onMessage(message => {
            const type = (message as { type?: unknown } | null)?.type;
            if (type === 'crashed') reported = true;
            listener(message);
            if (type === 'started') events.onStarted?.();
          }),
        onExit: listener =>
          channel.onExit(exit => {
            events.onExit?.(reported || exit.error !== undefined);
            listener(exit);
          }),
      };
    },
  };
}
