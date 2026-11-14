/** embedded Fastify lifecycle for the Electron main process. */

import type { BrowserWindow } from 'electron';
import { randomBytes } from 'node:crypto';
import {
  isHostError,
  restartPolicy as createRestartPolicy,
  type ExitDecision,
  type HostExit,
  type HostStats,
  type HostTransport,
  type RestartPolicyOptions,
} from '@electron-stagewright/host-supervisor';
import { resolveRuntimeConfig, type PuntovivoLogger } from '@puntovivo/server/desktop-main';
import type { ServerOptions } from '@puntovivo/server';
import { PACKAGED_RENDERER_ORIGIN } from './renderer-protocol.ts';
import { setServerHost } from './runtime.ts';
import type { EmbeddedServerHost, WorkerStartOptions } from './server-host/contract.ts';
import type { WorkerCrashEntry } from './server-host/crash-log.ts';
import { crashErrorCode, crashMemory } from './server-host/crash-log.ts';
import {
  classifyFatalCause,
  type WorkerExitKind,
  type WorkerFatalCause,
} from './server-host/fatal-cause.ts';
import {
  connectServerWorker,
  createServerWorkerHost,
  observeServerWorker,
} from './server-host/worker-host.ts';

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
  /** Converts a legacy anchor file first; undefined for env-key installs. */
  resolveAuditAnchorStoreLocation?: () => Promise<WorkerStartOptions['auditAnchorStore']>;
  getMainWindow: () => BrowserWindow | null;
  /** Launches each server worker; `serverWorkerTransport` in production. */
  transport: HostTransport;
  /** Lets E2E and soak runs crash the worker on purpose. */
  allowTestCrash?: boolean;
  /** A worker that dies while the app quits is not restarted. */
  isQuitting?: () => boolean;
  onStats?: (stats: HostStats) => void;
  env?: NodeJS.ProcessEnv;
  generateJwtSecret?: () => string;
  onStateChange?: (state: EmbeddedServerState) => void;
  /** Called once a crash ends in a state the app cannot recover from. */
  onFatalExit?: (fatal: FatalWorkerExit) => void;
  recordCrash?: (entry: Omit<WorkerCrashEntry, 'at' | 'appVersion'>) => void;
  restartPolicy?: Omit<RestartPolicyOptions, 'isFatal'>;
  stopGraceMs?: number;
}

export interface ServerLifecycle {
  start: () => Promise<EmbeddedServerHost>;
  stop: () => Promise<void>;
  restartAround: <T>(
    operation: () => Promise<T>,
    options?: { reloadWindow?: boolean }
  ) => Promise<T>;
  getState: () => EmbeddedServerState;
}

type CrashBase = Omit<
  WorkerCrashEntry,
  'at' | 'appVersion' | 'restartAttempt' | 'outcome' | 'fatalCause'
>;

/** The first start failure is reported as its own cause, not the supervisor's wrapper. */
function startFailureCause(error: unknown): unknown {
  return isHostError(error, 'HOST_START_FAILED') && error.cause instanceof Error
    ? error.cause
    : error;
}

export function createServerLifecycle({
  dbPath,
  migrationsPath,
  isDev,
  appVersion,
  log,
  prepareDatabaseEncryption,
  prepareAuditAnchorKey,
  resolveAuditAnchorStoreLocation,
  getMainWindow,
  transport,
  allowTestCrash = false,
  isQuitting = () => false,
  onStats,
  env = process.env,
  generateJwtSecret = () => randomBytes(48).toString('base64url'),
  onStateChange,
  onFatalExit,
  recordCrash,
  restartPolicy,
  stopGraceMs,
}: ServerLifecycleDeps): ServerLifecycle {
  // The server may restart around a manual backup or destructive restore.
  // Keep one in-memory signing secret for the Electron main lifetime so those
  // restarts do not invalidate every access and refresh token mid-session.
  const jwtSecret = generateJwtSecret();
  const decideRestart = createRestartPolicy({
    ...restartPolicy,
    isFatal: exit => classifyFatalCause(exit.error) !== null,
  });
  let state: EmbeddedServerState = 'starting';
  let shuttingDown = false;
  let explicitStarts = 0;
  // Set while restartAround's operation or shutdown owns the database files.
  let held = false;
  let lastExitReported = false;
  // One crash and the restarts that answer it (ADR 0034).
  let episode: { base: CrashBase; attempt: number } | null = null;
  // Shutdown and restartAround never overlap.
  let exclusiveTail: Promise<unknown> = Promise.resolve();

  const host = createServerWorkerHost({
    transport: observeServerWorker(transport, {
      // A call through a captured handle must not start a worker mid-restore.
      canLaunch: () => !held,
      onStarted: () => {
        // An explicit start finishes its own bookkeeping.
        if (episode && explicitStarts === 0) void finishRecovery();
      },
      onExit: reported => {
        lastExitReported = reported;
      },
    }),
    payload: buildStartPayload,
    onExit: handleUnexpectedExit,
    ...(onStats ? { onStats } : {}),
    ...(stopGraceMs === undefined ? {} : { stopGraceMs }),
  });

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

  // Built again for every worker, crash restarts included.
  async function buildStartPayload(): Promise<WorkerStartOptions> {
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

    const serverOptions: ServerOptions = {
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
    };
    const auditAnchorStore = await resolveAuditAnchorStoreLocation?.();
    return {
      serverOptions: serverOptions as unknown as Record<string, unknown>,
      ...(auditAnchorStore ? { auditAnchorStore } : {}),
    };
  }

  async function start(): Promise<EmbeddedServerHost> {
    held = false;
    explicitStarts++;
    let handle: EmbeddedServerHost;
    try {
      handle = await connectServerWorker(host, { allowTestCrash });
    } catch (error) {
      throw startFailureCause(error);
    } finally {
      explicitStarts--;
    }
    log.info({ url: handle.url }, 'embedded server started');
    // restartAround may bring the worker back before the crash restart does; the crash still counts.
    if (episode) closeEpisode(episode);
    setState('running');
    return handle;
  }

  async function stop(): Promise<void> {
    shuttingDown = true;
    await exclusive(async () => {
      held = true;
      setServerHost(null);
      log.info('shutting down embedded server');
      await host.close();
      log.info('embedded server stopped');
    });
  }

  async function stopHost(): Promise<void> {
    held = true;
    setServerHost(null);
    log.info('shutting down embedded server');
    // Rejects when the worker did not close cleanly: callers such as a
    // restore must not touch its files.
    await host.stop();
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

  function exitKind(exit: HostExit): WorkerExitKind {
    if (exit.kind === 'out-of-memory') return 'oom';
    return lastExitReported ? 'uncaught' : 'unknown';
  }

  /** The supervisor's restart decision, with the crash log and renderer state around it. */
  function handleUnexpectedExit(exit: HostExit): ExitDecision {
    // The dead worker's handle must not serve another call.
    setServerHost(null);
    if (shuttingDown || isQuitting()) return 'fatal';
    if (exit.kind !== 'start-failed' || !episode) {
      episode = {
        base: {
          kind: exitKind(exit),
          exitCode: exit.code ?? -1,
          errorCode: crashErrorCode(exit.error),
          uptimeMs: exit.uptimeMs ?? 0,
          pendingCalls: exit.pendingCalls,
          memory: crashMemory(exit.lastStats),
        },
        attempt: 0,
      };
      log.error({ ...episode.base }, 'embedded server worker exited unexpectedly');
      setState('restarting');
    } else {
      const errorCode = crashErrorCode(exit.error);
      recordCrash?.({
        ...episode.base,
        errorCode,
        restartAttempt: episode.attempt,
        outcome: 'restart-failed',
        fatalCause: classifyFatalCause(exit.error),
      });
      log.error({ attempt: episode.attempt, errorCode }, 'embedded server restart failed');
    }
    const decision = decideRestart(exit);
    if (decision === 'fatal') {
      const cause = classifyFatalCause(exit.error) ?? 'restart-loop';
      // A restart that failed on a fatal cause is already in the log.
      if (cause === 'restart-loop' || episode.attempt === 0) {
        recordCrash?.({
          ...episode.base,
          restartAttempt: episode.attempt,
          outcome: 'fatal',
          fatalCause: cause,
        });
      }
      episode = null;
      failFatally(cause, exit.error);
      return 'fatal';
    }
    episode.attempt++;
    return decision;
  }

  function closeEpisode(current: { base: CrashBase; attempt: number }): void {
    episode = null;
    recordCrash?.({
      ...current.base,
      restartAttempt: current.attempt,
      outcome: 'restarted',
      fatalCause: null,
    });
    log.info({ attempt: current.attempt }, 'embedded server worker restarted');
  }

  async function finishRecovery(): Promise<void> {
    const current = episode;
    let handle: EmbeddedServerHost;
    try {
      handle = await connectServerWorker(host, { allowTestCrash });
    } catch (error) {
      // Another exit or a stop owns what happens next.
      log.warn({ errorCode: crashErrorCode(error as Error) }, 'restarted worker not reachable');
      return;
    }
    if (!current || episode !== current) return;
    setServerHost(handle);
    closeEpisode(current);
    setState('running');
  }

  return {
    start,
    stop,
    restartAround,
    getState: () => state,
  };
}
