/** embedded Fastify lifecycle for the Electron main process. */

import type { BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import {
  createServer,
  resolveRuntimeConfig,
  type PuntovivoLogger,
  type PuntovivoServer,
  type ServerOptions,
} from '@puntovivo/server';
import { PACKAGED_RENDERER_ORIGIN } from './renderer-protocol.ts';
import { getServer, setServer } from './runtime.ts';

interface ServerLifecycleDeps {
  dbPath: string;
  migrationsPath: string;
  isDev: boolean;
  appVersion: string;
  log: PuntovivoLogger;
  prepareDatabaseEncryption: () => Promise<string>;
  /** Stable per-install audit-chain anchor secret (never rotates). */
  prepareAuditAnchorKey: () => Promise<string>;
  getMainWindow: () => BrowserWindow | null;
  env?: NodeJS.ProcessEnv;
  createEmbeddedServer?: (options: ServerOptions) => Promise<PuntovivoServer>;
  generateJwtSecret?: () => string;
}

export interface ServerLifecycle {
  start: () => Promise<PuntovivoServer>;
  stop: () => Promise<void>;
  restartAround: <T>(
    operation: () => Promise<T>,
    options?: { reloadWindow?: boolean }
  ) => Promise<T>;
}

export function createServerLifecycle({
  dbPath,
  migrationsPath,
  isDev,
  appVersion,
  log,
  prepareDatabaseEncryption,
  prepareAuditAnchorKey,
  getMainWindow,
  env = process.env,
  createEmbeddedServer = createServer,
  generateJwtSecret = () => randomBytes(48).toString('base64url'),
}: ServerLifecycleDeps): ServerLifecycle {
  // The server may restart around a manual backup or destructive restore.
  // Keep one in-memory signing secret for the Electron main lifetime so those
  // restarts do not invalidate every access and refresh token mid-session.
  const jwtSecret = generateJwtSecret();

  async function start(): Promise<PuntovivoServer> {
    // Authority Node host/mode/port remain environment-resolved.
    const runtime = resolveRuntimeConfig({ env });
    const encryptionKey = await prepareDatabaseEncryption();
    const auditAnchorKey = await prepareAuditAnchorKey();

    log.info(
      {
        dbPath,
        authorityMode: runtime.authorityMode,
        bindHost: runtime.bindHost,
        bindPort: runtime.bindPort,
        encryptionEnabled: true,
      },
      'starting embedded server'
    );

    const nextServer = await createEmbeddedServer({
      dbPath,
      port: runtime.bindPort,
      host: runtime.bindHost,
      verbose: isDev,
      migrationsFolder: migrationsPath,
      runtime,
      // /  — expose desktop version through health/Operations.
      appVersion,
      encryptionKey,
      auditAnchorKey,
      jwtSecret,
      // Production Electron has a single secure custom renderer origin.
      // Development omits this option to retain the server's localhost defaults.
      ...(isDev ? {} : { corsOrigins: [PACKAGED_RENDERER_ORIGIN] }),
    });
    await nextServer.listen();
    log.info({ url: nextServer.getUrl() }, 'embedded server started');
    return nextServer;
  }

  async function stop(): Promise<void> {
    const current = getServer();
    if (!current) return;

    log.info('shutting down embedded server');
    await current.close();
    setServer(null);
    log.info('embedded server stopped');
  }

  async function restartAround<T>(
    operation: () => Promise<T>,
    options?: { reloadWindow?: boolean }
  ): Promise<T> {
    // backup/restore IPC receives this choreography by dependency.
    await stop();
    let operationFailed = false;
    let operationError: unknown;
    let result: T | undefined;
    try {
      result = await operation();
    } catch (err) {
      operationFailed = true;
      operationError = err;
    }
    try {
      setServer(await start());
      const mainWindow = getMainWindow();
      if (options?.reloadWindow && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
    } catch (startError) {
      // When the operation ALSO failed, its error is the root cause
      // the caller must see — replacing it with the restart failure
      // would hide what actually went wrong. Log the restart failure
      // and let the operation error propagate below.
      if (!operationFailed) {
        throw startError;
      }
      log.error(
        {
          reason: startError instanceof Error ? startError.message : String(startError),
        },
        'embedded server failed to restart after a failed operation'
      );
    }
    if (operationFailed) {
      throw operationError;
    }
    return result as T;
  }

  return { start, stop, restartAround };
}
