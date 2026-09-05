import { vanillaClient } from './trpc';

let bootstrap: Promise<void> | null = null;

/**
 * Share the safe initial HTTP request before refresh or first-paint telemetry.
 * A persistent refresh cookie can outlive its session CSRF cookie. Concurrent
 * unsafe requests would then fail CSRF and race to replace the missing cookie.
 * Keep successful initialization for this page; a failed connection may retry
 * on a later explicit attempt. The normal transport also supports Store Hub.
 */
export function ensureApiBootstrap(): Promise<void> {
  bootstrap ??= vanillaClient.health.check.query().then(
    () => undefined,
    (error: unknown) => {
      bootstrap = null;
      throw error;
    }
  );
  return bootstrap;
}

/** Test-only reset: a new case models a new page, not an application remount. */
export function __resetApiBootstrapForTests(): void {
  bootstrap = null;
}
