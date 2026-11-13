/**
 * Worker-thread entry for the embedded server. Must never import Electron:
 * main owns every Electron API, including safeStorage.
 */
import { performance } from 'node:perf_hooks';
import { getHeapStatistics } from 'node:v8';
import { parentPort, type MessagePort } from 'node:worker_threads';
import {
  captureProcessCrash,
  createModuleLogger,
  flushServerTelemetry,
  drainPasswordWork,
  type ServerOptions,
} from '@puntovivo/server';
import { createAuditAnchorFileStore } from '../audit-anchor-store.ts';
import { installProcessCrashHandlers } from '../crash-telemetry.ts';
import type { EmbeddedServerHost } from './contract.ts';
import { createInProcessLauncher } from './in-process.ts';
import { createWorkerCallDrain } from './worker-call-drain.ts';
import {
  dispatchCall,
  serializeError,
  type MainToWorkerMessage,
  type WorkerStartOptions,
  type WorkerToMainMessage,
} from './protocol.ts';

if (!parentPort) throw new Error('The server worker must run in a worker thread');
const port: MessagePort = parentPort;

// Same policy as main: a stray rejection is logged and reported, not fatal;
// an uncaught exception ends the thread, which main treats as a crash.
installProcessCrashHandlers({
  log: createModuleLogger('server-worker'),
  captureCrash: (error, attrs) => {
    captureProcessCrash(error, attrs);
    // Main decides whether to restart from this cause.
    if (attrs.kind === 'uncaughtException') {
      const crashed: WorkerToMainMessage = { type: 'crashed', error: serializeError(error) };
      port.postMessage(crashed);
    }
  },
  flushTelemetry: flushServerTelemetry,
  // Ending the thread under a running Argon2 hash would abort the whole app:
  // refuse new hashes and give the running ones a bounded time to settle.
  exit: code => void drainPasswordWork().finally(() => process.exit(code)),
  proc: process,
  source: 'server-worker',
  label: 'server worker',
});

let host: EmbeddedServerHost | null = null;
let starting: Promise<void> | null = null;
const calls = createWorkerCallDrain();
const post = (message: WorkerToMainMessage) => port.postMessage(message);
const STATS_INTERVAL_MS = 60_000;
const toMb = (bytes: number) => Math.round((bytes / 1_048_576) * 10) / 10;
// Fixed by the worker's resourceLimits for its whole life.
const heapLimitMb = toMb(getHeapStatistics().heap_size_limit);
let lastElu = performance.eventLoopUtilization();
let statsTimer: ReturnType<typeof setInterval> | null = null;

function postStats(): void {
  const memory = process.memoryUsage();
  const elu = performance.eventLoopUtilization(lastElu);
  lastElu = performance.eventLoopUtilization();
  post({
    type: 'stats',
    stats: {
      rssMb: toMb(memory.rss),
      heapUsedMb: toMb(memory.heapUsed),
      heapLimitMb,
      externalMb: toMb(memory.external + memory.arrayBuffers),
      eventLoopUtilization: Math.round(elu.utilization * 1000) / 1000,
    },
  });
}

async function start(options: WorkerStartOptions): Promise<void> {
  try {
    const serverOptions = options.serverOptions as unknown as ServerOptions;
    const anchorSecret = serverOptions.auditAnchorKey;
    // A store location without its secret must not run without the anchor store.
    if (options.auditAnchorStore && !anchorSecret) throw new Error('AUDIT_ANCHOR_SECRET_MISSING');
    const auditAnchorStore = options.auditAnchorStore
      ? createAuditAnchorFileStore({ ...options.auditAnchorStore, anchorSecret: anchorSecret! })
      : undefined;
    host = await createInProcessLauncher({
      prepareAuditAnchorStore: async () => auditAnchorStore,
    })(serverOptions);
    post({ type: 'started', url: host.url });
    postStats();
    statsTimer = setInterval(postStats, STATS_INTERVAL_MS).unref();
  } catch (error) {
    post({ type: 'start-failed', error: serializeError(error) });
  }
}

async function stop(): Promise<void> {
  let error: unknown = null;
  const draining = calls.stop();
  try {
    // A stop during boot waits for it, so Argon2 and migrations finish first.
    await starting;
    // Direct operations such as owner recovery can still be hashing outside
    // Fastify's request lifecycle. Keep their database and port alive until
    // their replies have been sent, then let the server drain HTTP requests.
    await draining;
    await host?.close();
  } catch (closeError) {
    error = closeError;
  }
  host = null;
  if (statsTimer) clearInterval(statsTimer);
  post(error ? { type: 'stopped', error: serializeError(error) } : { type: 'stopped' });
  // Nothing else keeps the thread alive once the server has closed.
  port.close();
}

port.on('message', (message: MainToWorkerMessage) => {
  switch (message.type) {
    case 'start':
      starting = start(message.options);
      return;
    case 'call': {
      const current = host;
      const accepted =
        current &&
        calls.dispatch(() =>
          dispatchCall(current, message)
            .then(post)
            // A result that cannot be cloned still answers its call.
            .catch(error =>
              post({ type: 'result', id: message.id, ok: false, error: serializeError(error) })
            )
        );
      if (!accepted) {
        post({
          type: 'result',
          id: message.id,
          ok: false,
          error: { name: 'Error', message: 'The embedded server is not available' },
        });
      }
      return;
    }
    case 'stop':
      void stop();
      return;
    case 'test-crash':
      if (testFaultsAllowed()) {
        setImmediate(() => {
          throw new Error('SERVER_WORKER_TEST_CRASH');
        });
      }
      return;
    case 'test-oom':
      // The test must hit the heap limit, not the Argon2 abort a forced exit can cause.
      if (testFaultsAllowed()) void drainPasswordWork().then(exhaustHeap);
      return;
  }
});

function testFaultsAllowed(): boolean {
  return process.env.PUNTOVIVO_E2E === '1' || process.env.PUNTOVIVO_SOAK === '1';
}

function exhaustHeap(): void {
  const retained: unknown[] = [];
  for (;;) retained.push(Array.from({ length: 100_000 }, (_, index) => ({ index })));
}
