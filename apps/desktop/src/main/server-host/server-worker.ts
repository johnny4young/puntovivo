/**
 * Worker-thread entry for the embedded server. Must never import Electron:
 * main owns every Electron API, including safeStorage.
 */
import { parentPort, type MessagePort } from 'node:worker_threads';
import { serveHost, type Handlers } from '@electron-stagewright/host-supervisor';
import {
  captureProcessCrash,
  createModuleLogger,
  flushServerTelemetry,
  drainPasswordWork,
  type ServerOptions,
} from '@puntovivo/server';
import { createAuditAnchorFileStore } from '../audit-anchor-store.ts';
import { installProcessCrashHandlers } from '../crash-telemetry.ts';
import {
  EMBEDDED_SERVER_OPERATIONS,
  SERVER_WORKER_OPERATIONS,
  type EmbeddedServerHost,
  type ServerWorkerOperations,
  type WorkerStartOptions,
} from './contract.ts';
import { createInProcessLauncher } from './in-process.ts';
import { WORKER_STATS_INTERVAL_MS } from './memory-policy.ts';

if (!parentPort) throw new Error('The server worker must run in a worker thread');
const port: MessagePort = parentPort;

// Same policy as main: a stray rejection is logged and reported, not fatal;
// an uncaught exception ends the thread, which main treats as a crash. The
// supervisor reports the cause to main before this handler runs.
installProcessCrashHandlers({
  log: createModuleLogger('server-worker'),
  captureCrash: captureProcessCrash,
  flushTelemetry: flushServerTelemetry,
  // Ending the thread under a running Argon2 hash would abort the whole app:
  // refuse new hashes and give the running ones a bounded time to settle.
  exit: code => void drainPasswordWork().finally(() => process.exit(code)),
  proc: process,
  source: 'server-worker',
  label: 'server worker',
});

let host: EmbeddedServerHost | null = null;

async function start(options: WorkerStartOptions): Promise<Handlers<ServerWorkerOperations>> {
  const serverOptions = options.serverOptions as unknown as ServerOptions;
  const anchorSecret = serverOptions.auditAnchorKey;
  // A store location without its secret must not run without the anchor store.
  if (options.auditAnchorStore && !anchorSecret) throw new Error('AUDIT_ANCHOR_SECRET_MISSING');
  const auditAnchorStore = options.auditAnchorStore
    ? createAuditAnchorFileStore({ ...options.auditAnchorStore, anchorSecret: anchorSecret! })
    : undefined;
  const served = await createInProcessLauncher({
    prepareAuditAnchorStore: async () => auditAnchorStore,
  })(serverOptions);
  host = served;
  // Operations ignore the call context the supervisor appends.
  const operations = Object.fromEntries(
    EMBEDDED_SERVER_OPERATIONS.map(op => [
      op,
      (...args: unknown[]) =>
        (served[op] as (...values: unknown[]) => Promise<unknown>)(...args.slice(0, -1)),
    ])
  );
  return {
    ...operations,
    getUrl: async () => served.url,
    testCrash: async () => {
      if (!testFaultsAllowed()) return;
      setImmediate(() => {
        throw new Error('SERVER_WORKER_TEST_CRASH');
      });
    },
    testOutOfMemory: async () => {
      // The test must hit the heap limit, not the Argon2 abort a forced exit can cause.
      if (testFaultsAllowed()) void drainPasswordWork().then(exhaustHeap);
    },
  } as unknown as Handlers<ServerWorkerOperations>;
}

// The supervisor refuses new calls, waits for accepted ones and their replies,
// and only then runs stop: direct operations such as owner recovery keep their
// database until they answer, then Fastify drains HTTP requests.
serveHost<ServerWorkerOperations, WorkerStartOptions>({
  operations: SERVER_WORKER_OPERATIONS,
  start,
  stop: async () => {
    const closing = host;
    host = null;
    await closing?.close();
  },
  statsIntervalMs: WORKER_STATS_INTERVAL_MS,
  port: {
    post: message => port.postMessage(message),
    onMessage: listener => void port.on('message', listener),
    // Nothing else keeps the thread alive once the server has closed.
    close: () => port.close(),
  },
});

function testFaultsAllowed(): boolean {
  return process.env.PUNTOVIVO_E2E === '1' || process.env.PUNTOVIVO_SOAK === '1';
}

function exhaustHeap(): void {
  const retained: unknown[] = [];
  for (;;) retained.push(Array.from({ length: 100_000 }, (_, index) => ({ index })));
}
