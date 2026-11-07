/**
 * Worker-thread entry for the embedded server. Must never import Electron:
 * main owns every Electron API, including safeStorage.
 */
import { parentPort, type MessagePort } from 'node:worker_threads';
import {
  captureProcessCrash,
  createModuleLogger,
  createServer,
  flushServerTelemetry,
  type ServerOptions,
} from '@puntovivo/server';
import { createAuditAnchorFileStore } from '../audit-anchor-store.ts';
import { installProcessCrashHandlers } from '../crash-telemetry.ts';
import type { EmbeddedServerHost } from './contract.ts';
import { createInProcessServerHost } from './in-process.ts';
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
  captureCrash: captureProcessCrash,
  flushTelemetry: flushServerTelemetry,
  exit: code => process.exit(code),
  proc: process,
  source: 'server-worker',
  label: 'server worker',
});

let host: EmbeddedServerHost | null = null;
let starting: Promise<void> | null = null;
const post = (message: WorkerToMainMessage) => port.postMessage(message);

async function start(options: WorkerStartOptions): Promise<void> {
  try {
    const serverOptions = options.serverOptions as unknown as ServerOptions;
    const anchorSecret = serverOptions.auditAnchorKey;
    const auditAnchorStore =
      options.auditAnchorStore && anchorSecret
        ? createAuditAnchorFileStore({ ...options.auditAnchorStore, anchorSecret })
        : undefined;
    const server = await createServer({
      ...serverOptions,
      ...(auditAnchorStore ? { auditAnchorStore } : {}),
    });
    try {
      await server.listen();
    } catch (error) {
      await server.close().catch(() => undefined);
      throw error;
    }
    host = createInProcessServerHost(server);
    post({ type: 'started', url: host.url });
  } catch (error) {
    post({ type: 'start-failed', error: serializeError(error) });
  }
}

async function stop(): Promise<void> {
  let error: unknown = null;
  try {
    // A stop during boot waits for it, so Argon2 and migrations finish first.
    await starting;
    await host?.close();
  } catch (closeError) {
    error = closeError;
  }
  host = null;
  post(error ? { type: 'stopped', error: serializeError(error) } : { type: 'stopped' });
  // Nothing else keeps the thread alive once the server has closed.
  port.close();
}

port.on('message', (message: MainToWorkerMessage) => {
  switch (message.type) {
    case 'start':
      starting = start(message.options);
      return;
    case 'call':
      if (!host) {
        post({
          type: 'result',
          id: message.id,
          ok: false,
          error: { name: 'Error', message: 'The embedded server is not available' },
        });
        return;
      }
      void dispatchCall(host, message)
        .then(post)
        // A result that cannot be cloned still answers its call.
        .catch(error =>
          post({ type: 'result', id: message.id, ok: false, error: serializeError(error) })
        );
      return;
    case 'stop':
      void stop();
      return;
  }
});
