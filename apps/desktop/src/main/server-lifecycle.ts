/** embedded Fastify lifecycle for the Electron main process. */

import type { BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import { resolveRuntimeConfig, type PuntovivoLogger } from '@puntovivo/server/desktop-main';
import type { ServerOptions } from '@puntovivo/server';
import { PACKAGED_RENDERER_ORIGIN } from './renderer-protocol.ts';
import { getServerHost, setServerHost } from './runtime.ts';
import type { EmbeddedServerHost } from './server-host/contract.ts';
import type { WorkerCrashEntry } from './server-host/crash-log.ts';
import { crashErrorCode, crashMemory } from './server-host/crash-log.ts';
import {
  classifyFatalCause,
  createRestartBudget,
  type RestartPolicyOptions,
  type WorkerExitFailure,
  type WorkerFatalCause,
} from './server-host/restart-policy.ts';

/** What the renderer is told about the embedded server. */
export type EmbeddedServerState = 'starting' | 'running' | 'restarting' | 'fatal';

export interface FatalWorkerExit {
  cause: WorkerFatalCause | 'restart-loop';
  error: Error;
}

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
  /** Starts a listening server with these options: in a worker or in-process. */
  launchHost: (options: ServerOptions) => Promise<EmbeddedServerHost>;
  env?: NodeJS.ProcessEnv;
  generateJwtSecret?: () => string;
  onStateChange?: (state: EmbeddedServerState) => void;
  /** Called once a crash ends in a state the app cannot recover from. */
  onFatalExit?: (fatal: FatalWorkerExit) => void;
  recordCrash?: (entry: Omit<WorkerCrashEntry, 'at' | 'appVersion'>) => void;
  restartPolicy?: RestartPolicyOptions;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface ServerLifecycle {
  start: () => Promise<EmbeddedServerHost>;
  stop: () => Promise<void>;
  restartAround: <T>(
    operation: () => Promise<T>,
    options?: { reloadWindow?: boolean }
  ) => Promise<T>;
  /** Restarts a worker that died on its own, or gives up (ADR 0034). */
  recoverFromUnexpectedExit: (failure: WorkerExitFailure) => Promise<void>;
  getState: () => EmbeddedServerState;
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
  launchHost,
  env = process.env,
  generateJwtSecret = () => randomBytes(48).toString('base64url'),
  onStateChange,
  onFatalExit,
  recordCrash,
  restartPolicy,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now,
}: ServerLifecycleDeps): ServerLifecycle {
  // The server may restart around a manual backup or destructive restore.
  // Keep one in-memory signing secret for the Electron main lifetime so those
  // restarts do not invalidate every access and refresh token mid-session.
  const jwtSecret = generateJwtSecret();
  const restartBudget = createRestartBudget(restartPolicy);
  let state: EmbeddedServerState = 'starting';
  let shuttingDown = false;
  // Crash recovery and restartAround never start two workers at once.
  let exclusiveTail: Promise<unknown> = Promise.resolve();

  function setState(next: EmbeddedServerState): void {
    if (state === next) return;
    state = next;
    // A failing listener must not turn a started worker into a failed start.
    try {
      onStateChange?.(next);
    } catch (error) {
      log.warn({ err: error }, 'embedded server state listener failed');
    }
  }

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = exclusiveTail.then(task, task);
    exclusiveTail = run.catch(() => undefined);
    return run;
  }

  async function start(): Promise<EmbeddedServerHost> {
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

    const host = await launchHost({
      dbPath,
      seedData: false,
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
    log.info({ url: host.url }, 'embedded server started');
    setState('running');
    return host;
  }

  async function stop(): Promise<void> {
    shuttingDown = true;
    // A crash restart in flight finishes or bails out before the host closes.
    await exclusive(stopHost);
  }

  async function stopHost(): Promise<void> {
    const current = getServerHost();
    if (!current) return;

    log.info('shutting down embedded server');
    await current.close();
    setServerHost(null);
    log.info('embedded server stopped');
  }

  function restartAround<T>(
    operation: () => Promise<T>,
    options?: { reloadWindow?: boolean }
  ): Promise<T> {
    return exclusive(() => runRestartAround(operation, options));
  }

  async function runRestartAround<T>(
    operation: () => Promise<T>,
    options?: { reloadWindow?: boolean }
  ): Promise<T> {
    // backup/restore IPC receives this choreography by dependency.
    await stopHost();
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
      setServerHost(await start());
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

  function failFatally(cause: FatalWorkerExit['cause'], error: Error): void {
    setState('fatal');
    onFatalExit?.({ cause, error });
  }

  function recoverFromUnexpectedExit(failure: WorkerExitFailure): Promise<void> {
    // The dead worker's handle must not serve another call.
    setServerHost(null);
    if (shuttingDown) return Promise.resolve();
    setState('restarting');
    return exclusive(() => recover(failure));
  }

  async function recover(failure: WorkerExitFailure): Promise<void> {
    const base = {
      kind: failure.kind,
      exitCode: failure.exitCode,
      errorCode: crashErrorCode(failure.error),
      uptimeMs: failure.uptimeMs,
      pendingCalls: failure.pendingCalls,
      memory: crashMemory(failure.lastMemory),
    };
    log.error({ ...base }, 'embedded server worker exited unexpectedly');
    let cause: WorkerFatalCause | null = classifyFatalCause(failure.error);
    let lastError = failure.error;
    let attempt = 0;
    while (!cause && !shuttingDown) {
      // restartAround may already have brought a worker back; the crash still counts.
      if (getServerHost()) {
        recordCrash?.({ ...base, restartAttempt: attempt, outcome: 'restarted', fatalCause: null });
        setState('running');
        return;
      }
      const decision = restartBudget.next(now());
      if (decision.action === 'give-up') {
        recordCrash?.({
          ...base,
          restartAttempt: attempt,
          outcome: 'fatal',
          fatalCause: 'restart-loop',
        });
        failFatally('restart-loop', lastError);
        return;
      }
      attempt = decision.attempt;
      await sleep(decision.delayMs);
      if (shuttingDown) return;
      try {
        setServerHost(await start());
        recordCrash?.({ ...base, restartAttempt: attempt, outcome: 'restarted', fatalCause: null });
        log.info({ attempt }, 'embedded server worker restarted');
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        cause = classifyFatalCause(lastError);
        recordCrash?.({
          ...base,
          errorCode: crashErrorCode(lastError),
          restartAttempt: attempt,
          outcome: 'restart-failed',
          fatalCause: cause,
        });
        log.error(
          { attempt, errorCode: crashErrorCode(lastError) },
          'embedded server restart failed'
        );
      }
    }
    if (cause && !shuttingDown) {
      if (attempt === 0) {
        recordCrash?.({ ...base, restartAttempt: 0, outcome: 'fatal', fatalCause: cause });
      }
      failFatally(cause, lastError);
    }
  }

  return {
    start,
    stop,
    restartAround,
    recoverFromUnexpectedExit,
    getState: () => state,
  };
}
