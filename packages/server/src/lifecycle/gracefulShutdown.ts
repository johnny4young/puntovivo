type ShutdownLogger = {
  info: (bindings: Record<string, unknown>, message: string) => void;
  error: (bindings: Record<string, unknown>, message: string) => void;
  fatal: (bindings: Record<string, unknown>, message: string) => void;
};

export interface GracefulShutdownOptions {
  close: () => Promise<void>;
  log: ShutdownLogger;
  exit: (code: number) => void;
  timeoutMs?: number;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

export function createGracefulShutdownHandler({
  close,
  log,
  exit,
  timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
}: GracefulShutdownOptions): (signal: string) => Promise<void> {
  let shutdownPromise: Promise<void> | null = null;

  return (signal: string) => {
    if (shutdownPromise) {
      log.info({ signal }, 'shutdown already in progress');
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      log.info({ signal }, 'shutdown requested');
      let didExit = false;
      const exitOnce = (code: number) => {
        if (didExit) {
          return;
        }
        didExit = true;
        exit(code);
      };

      const timeout = setTimeout(() => {
        log.error({ signal, timeoutMs }, 'shutdown timed out');
        exitOnce(1);
      }, timeoutMs);
      timeout.unref?.();

      try {
        await close();
        clearTimeout(timeout);
        log.info({ signal }, 'shutdown complete');
        exitOnce(0);
      } catch (err) {
        clearTimeout(timeout);
        log.fatal({ err, signal }, 'shutdown failed');
        exitOnce(1);
      }
    })();

    return shutdownPromise;
  };
}
