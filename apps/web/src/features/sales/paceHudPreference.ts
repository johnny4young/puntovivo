/**
 * device-local, per-user opt-in for the cashier pace HUD.
 *
 * The toggle button lives in the POS header while the strip renders inside
 * the checkout panel, so the preference is a tiny external store consumed
 * via `useSyncExternalStore` — both surfaces stay in lockstep without
 * threading props through SalesScreen. Keyed per `${tenantId}:${userId}`:
 * the HUD motivates the cashier who opted in, it never follows another
 * account on the same till. Storage failures (private mode, disabled
 * localStorage) degrade to in-memory state for the tab's lifetime.
 */

const STORAGE_PREFIX = 'puntovivo.paceHud.';

type Listener = () => void;

const listeners = new Set<Listener>();
/** In-memory fallback + cache; localStorage is the durable layer. */
const memory = new Map<string, boolean>();

function storageKey(ownerKey: string): string {
  return `${STORAGE_PREFIX}${ownerKey}`;
}

/** Current opt-in for the owner (default OFF — the HUD is invited, not imposed). */
export function isPaceHudEnabled(ownerKey: string | null): boolean {
  if (!ownerKey) return false;
  if (memory.has(ownerKey)) return memory.get(ownerKey)!;
  try {
    const raw = window.localStorage.getItem(storageKey(ownerKey));
    const enabled = raw === 'true';
    memory.set(ownerKey, enabled);
    return enabled;
  } catch {
    return false;
  }
}

export function setPaceHudEnabled(ownerKey: string | null, enabled: boolean): void {
  if (!ownerKey) return;
  memory.set(ownerKey, enabled);
  try {
    window.localStorage.setItem(storageKey(ownerKey), String(enabled));
  } catch {
    // In-memory fallback already updated; the preference survives the tab.
  }
  listeners.forEach(listener => listener());
}

export function subscribeToPaceHud(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
