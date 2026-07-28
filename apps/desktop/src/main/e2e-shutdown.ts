/**
 * Graceful packaged-process teardown for renderer E2E.
 *
 * Packaged builds cannot expose the Electron main-process inspector because
 * production fuses disable it. The renderer suite therefore owns the process
 * through a narrow test-only IPC. The handler acknowledges the renderer first,
 * then asks the real app lifecycle to drain the embedded server and SQLite.
 */

interface AppLifecycle {
  quit(): void;
  exit(code: number): void;
}

interface TimerHandle {
  unref?: () => void;
}

type Schedule = (callback: () => void, delayMs: number) => TimerHandle;
type Defer = (callback: () => void) => void;

export function scheduleE2eShutdown(options: {
  app: AppLifecycle;
  schedule?: Schedule;
  defer?: Defer;
}): void {
  const schedule: Schedule =
    options.schedule ??
    ((callback, delayMs) => {
      return setTimeout(callback, delayMs);
    });
  const defer: Defer = options.defer ?? (callback => setImmediate(callback));

  defer(() => {
    options.app.quit();
    const fallback = schedule(() => options.app.exit(0), 2_000);
    fallback.unref?.();
  });
}
