/**
 * Electron main-process crash-path telemetry.
 *
 * Before this module the main process installed NO
 * `uncaughtException` / `unhandledRejection` handlers: a crash in
 * the embedded server boot, an IPC handler, or a fire-and-forget
 * promise died with Electron's default dialog (or silently), leaving
 * nothing in the NDJSON log and nothing in the centralized pipe.
 *
 * The handlers here guarantee three things:
 * 1. A structured local log line ALWAYS lands (pino mainLog).
 * 2. The crash is forwarded to the telemetry sink via
 * `captureProcessCrash` — tenant-less app diagnostics, only
 * live when the operator provisioned PUNTOVIVO_SENTRY_DSN
 * (see docs/OBSERVABILITY.md § consent layers).
 * 3. `uncaughtException` keeps its fail-fast semantics: after a
 * best-effort telemetry flush (bounded by a hard deadline so a
 * hanging transport cannot wedge a dying process), the process
 * exits 1. `unhandledRejection` logs + captures WITHOUT
 * exiting — rejections are recoverable and killing the POS for
 * one is worse than the bug itself.
 *
 * Every collaborator is injected so the logic is testable under
 * `node --test` without Electron, the server bundle, or real timers
 * at production durations. `apps/desktop/src/main/index.ts` supplies
 * the real wiring (mainLog + @puntovivo/server helpers + app.exit).
 */

/**
 * Injected collaborators for {@link installProcessCrashHandlers}.
 * Production wiring (index.ts): `log` = the pino main logger,
 * `captureCrash` = `captureProcessCrash` from @puntovivo/server,
 * `flushTelemetry` = `flushServerTelemetry`, `exit` = `app.exit`,
 * `proc` = global `process`. Timeouts only exist as knobs for tests.
 */
export interface CrashTelemetryDeps {
  log: { error(obj: unknown, msg?: string): void };
  captureCrash(err: unknown, attrs: Record<string, unknown>): void;
  flushTelemetry(timeoutMs: number): Promise<void>;
  exit(code: number): void;
  proc: Pick<NodeJS.Process, 'on'>;
  /** Telemetry flush budget passed to `flushTelemetry`. Default 2000 ms. */
  flushTimeoutMs?: number;
  /** Hard exit ceiling even if the flush promise never settles. Default 3000 ms. */
  exitDeadlineMs?: number;
}

const DEFAULT_FLUSH_TIMEOUT_MS = 2000;
const DEFAULT_EXIT_DEADLINE_MS = 3000;

let installed = false;

/** Test-only: allow each test to install against a fresh emitter. */
export function __resetCrashTelemetryForTests(): void {
  installed = false;
}

/**
 * Install the two process-level crash handlers. Idempotent per
 * process — returns false (and installs nothing) on repeated calls
 * so a hot-reloaded main cannot stack duplicate handlers.
 */
export function installProcessCrashHandlers(deps: CrashTelemetryDeps): boolean {
  if (installed) {
    return false;
  }
  installed = true;
  const flushTimeoutMs = deps.flushTimeoutMs ?? DEFAULT_FLUSH_TIMEOUT_MS;
  const exitDeadlineMs = deps.exitDeadlineMs ?? DEFAULT_EXIT_DEADLINE_MS;

  deps.proc.on('uncaughtException', (err: unknown) => {
    // A throw inside THIS handler would loop the crash path, so every
    // step is individually guarded even though the collaborators
    // promise not to throw.
    try {
      deps.log.error({ err }, 'uncaught exception in main process');
    } catch {
      /* the logger itself is gone — nothing left to do */
    }
    try {
      deps.captureCrash(err, {
        source: 'electron-main',
        kind: 'uncaughtException',
      });
    } catch {
      /* captureProcessCrash never throws by contract; belt and braces */
    }
    let exited = false;
    const exitOnce = (): void => {
      if (exited) return;
      exited = true;
      deps.exit(1);
    };
    // Hard ceiling: a wedged transport must not keep a dying process
    // alive. unref() (when available) keeps the timer itself from
    // pinning the event loop open.
    const deadline = setTimeout(exitOnce, exitDeadlineMs);
    deadline.unref?.();
    // Guarded like the other collaborators: a flushTelemetry that
    // throws SYNCHRONOUSLY would otherwise re-throw inside the
    // uncaughtException handler itself (fatal abort, no clean exit).
    // The real flushServerTelemetry is an async function and cannot,
    // but the deps contract should not rely on that.
    try {
      deps.flushTelemetry(flushTimeoutMs).then(exitOnce, exitOnce);
    } catch {
      exitOnce();
    }
  });

  deps.proc.on('unhandledRejection', (reason: unknown) => {
    try {
      deps.log.error({ err: reason }, 'unhandled promise rejection in main process');
    } catch {
      /* see above */
    }
    try {
      deps.captureCrash(reason, {
        source: 'electron-main',
        kind: 'unhandledRejection',
      });
    } catch {
      /* see above */
    }
    // No exit: rejections are recoverable; killing the POS over one
    // is worse than the bug it signals.
  });

  return true;
}
