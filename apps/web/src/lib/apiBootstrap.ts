import { vanillaClient } from './trpc';

let bootstrap: Promise<void> | null = null;
let failed = false;

/**
 * Share the safe initial HTTP request before refresh or first-paint telemetry.
 * A persistent refresh cookie can outlive its session CSRF cookie. Concurrent
 * unsafe requests would then fail CSRF and race to replace the missing cookie.
 * Retain a failed promise too: later telemetry must not turn an outage into
 * automatic retries. Only an explicit operator action may reset a failed attempt. The normal transport also supports Store Hub.
 */
export function ensureApiBootstrap(options?: { retryAfterFailure: boolean }): Promise<void> {
  if (options?.retryAfterFailure && failed) {
    bootstrap = null;
    failed = false;
  }
  bootstrap ??= vanillaClient.health.check.query().then(
    () => undefined,
    (error: unknown) => {
      failed = true;
      throw error;
    }
  );
  return bootstrap;
}

/** Test-only reset: a new case models a new page, not an application remount. */
export function __resetApiBootstrapForTests(): void {
  bootstrap = null;
  failed = false;
}
