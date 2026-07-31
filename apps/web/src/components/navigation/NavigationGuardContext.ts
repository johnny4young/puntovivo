import { createContext, useContext, useEffect } from 'react';
import type { NavigationBlocker, NavigationGuardController } from './navigationGuardController';

export const NavigationGuardContext = createContext<NavigationGuardController | null>(null);

/** Registers a custom confirmation surface while `when` is true. */
export function useNavigationGuard(when: boolean, blocker: NavigationBlocker) {
  const controller = useContext(NavigationGuardContext);
  if (!controller) {
    throw new Error('useNavigationGuard must be used inside <NavigationGuardProvider>');
  }

  useEffect(() => {
    if (!when) return;
    return controller.register(blocker);
  }, [blocker, controller, when]);
}
