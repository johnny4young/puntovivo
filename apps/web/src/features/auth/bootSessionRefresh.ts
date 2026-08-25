/**
 * Single-flight guard for the BOOT session refresh.
 *
 * StrictMode runs the AuthProvider mount effect twice, so the two
 * invocations issue two `auth.refresh` mutations close enough together
 * that the tRPC batch link coalesces them into one
 * `auth.refresh,auth.refresh` request. That is precisely the concurrency
 * the refresh cookie must never see: the rotating cookie invalidates
 * in-flight peers, which is why the 401 retry path in `lib/trpc.ts`
 * single-flights its own refresh. The boot path calls the vanilla client
 * directly and so bypassed that guard.
 *
 * Both callers share one round-trip and one outcome — including one
 * rejection, so a boot without a session still resolves to unauthenticated
 * exactly once. The entry clears on settle so a genuine later expiry
 * refreshes again.
 *
 * @module features/auth/bootSessionRefresh
 */

import { vanillaClient } from '@/lib/trpc';

let pending: Promise<{ token: string }> | null = null;

export function refreshSessionOnce(): Promise<{ token: string }> {
  pending ??= vanillaClient.auth.refresh.mutate().finally(() => {
    pending = null;
  });
  return pending;
}

/** Test-only reset so a suite can exercise a fresh boot per case. */
export function __resetBootSessionRefreshForTests(): void {
  pending = null;
}
