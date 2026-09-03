/** Kitchen commands must not be queued for an unknown future preparation state. */
import { useSyncExternalStore } from 'react';
function subscribe(listener: () => void) {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}
export function useKitchenOnline() {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => false
  );
}
