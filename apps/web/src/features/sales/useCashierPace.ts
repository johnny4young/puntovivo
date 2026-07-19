import { useCallback, useSyncExternalStore } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';
import { isPaceHudEnabled, setPaceHudEnabled, subscribeToPaceHud } from './paceHudPreference';

/**
 * ENG-204 — the cashier pace HUD state. Bundles the per-user opt-in (shared
 * external store, see paceHudPreference) with the `cashSessions.pace` read.
 * Zero cost while opted out or without an active session: the query never
 * fires (`enabled` gates it) and consumers render nothing. While active it
 * refreshes every 60 s — pace is a rhythm indicator, not a live ticker.
 */
export function useCashierPace(hasActiveCashSession: boolean) {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const ownerKey = currentTenant && user ? `${currentTenant.id}:${user.id}` : null;

  const enabled = useSyncExternalStore(
    subscribeToPaceHud,
    () => isPaceHudEnabled(ownerKey),
    () => false
  );

  const paceQuery = trpc.cashSessions.pace.useQuery(undefined, {
    enabled: enabled && hasActiveCashSession,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const toggle = useCallback(() => {
    setPaceHudEnabled(ownerKey, !isPaceHudEnabled(ownerKey));
  }, [ownerKey]);

  return {
    enabled,
    toggle,
    // Cache-leak guard (ENG-199 lesson): enabled:false still serves cached
    // data, so the payload is also gated on the flag.
    pace: enabled && hasActiveCashSession ? (paceQuery.data ?? null) : null,
  };
}
