/** per-tenant, per-user opt-in for the private cashier pace HUD. */
const STORAGE_PREFIX = 'puntovivo:cashier-pace-enabled:';
const CHANGE_EVENT = 'puntovivo:cashier-pace-preference-change';
const volatilePreferences = new Map<string, boolean>();
const volatileWriteOverrides = new Set<string>();

export function getCashierPaceStorageKey(ownerKey: string): string {
  return `${STORAGE_PREFIX}${ownerKey}`;
}

export function readCashierPacePreference(ownerKey: string | null): boolean {
  if (!ownerKey) return false;
  if (volatileWriteOverrides.has(ownerKey)) {
    return volatilePreferences.get(ownerKey) ?? false;
  }
  try {
    const value = window.localStorage?.getItem(getCashierPaceStorageKey(ownerKey));
    if (value === null || value === undefined) {
      volatilePreferences.delete(ownerKey);
      return false;
    }
    const enabled = value === 'true';
    volatilePreferences.set(ownerKey, enabled);
    return enabled;
  } catch {
    // Hardened webviews may reject storage; the in-memory value still works.
  }
  return volatilePreferences.get(ownerKey) ?? false;
}

export function setCashierPacePreference(ownerKey: string, enabled: boolean): void {
  volatilePreferences.set(ownerKey, enabled);
  try {
    window.localStorage?.setItem(getCashierPaceStorageKey(ownerKey), String(enabled));
    volatileWriteOverrides.delete(ownerKey);
  } catch {
    // Keep the preference for this app lifetime when persistence is blocked.
    volatileWriteOverrides.add(ownerKey);
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { ownerKey } }));
}

export function subscribeCashierPacePreference(
  ownerKey: string | null,
  onStoreChange: () => void
): () => void {
  if (!ownerKey) return () => undefined;
  const handleChange = (event: Event) => {
    if (event instanceof StorageEvent) {
      // localStorage.clear() emits a cross-document storage event with a
      // null key. Treat it as a reset so another open Puntovivo window does
      // not keep a stale opt-in in its volatile snapshot.
      if (event.key === null || event.key === getCashierPaceStorageKey(ownerKey)) {
        volatileWriteOverrides.delete(ownerKey);
        onStoreChange();
      }
      return;
    }
    const detail = (event as CustomEvent<{ ownerKey?: string }>).detail;
    if (detail?.ownerKey === ownerKey) onStoreChange();
  };
  window.addEventListener('storage', handleChange);
  window.addEventListener(CHANGE_EVENT, handleChange);
  return () => {
    window.removeEventListener('storage', handleChange);
    window.removeEventListener(CHANGE_EVENT, handleChange);
  };
}
