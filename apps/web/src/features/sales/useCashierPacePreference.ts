import { useCallback, useSyncExternalStore } from 'react';
import {
  readCashierPacePreference,
  setCashierPacePreference,
  subscribeCashierPacePreference,
} from './cashierPacePreference';

/** Reactive preference shared by the global profile menu and the POS route. */
export function useCashierPacePreference(ownerKey: string | null) {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeCashierPacePreference(ownerKey, onStoreChange),
    [ownerKey]
  );
  const getSnapshot = useCallback(() => readCashierPacePreference(ownerKey), [ownerKey]);
  const enabled = useSyncExternalStore(subscribe, getSnapshot, () => false);

  const setEnabled = useCallback(
    (next: boolean) => {
      if (ownerKey) setCashierPacePreference(ownerKey, next);
    },
    [ownerKey]
  );

  return { enabled, setEnabled };
}
