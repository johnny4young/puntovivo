export type NavigationContinuation = () => void;
export type NavigationBlocker = (continueNavigation: NavigationContinuation) => void;

export interface NavigationGuardController {
  isBlocked: () => boolean;
  request: (continueNavigation: NavigationContinuation) => void;
  register: (blocker: NavigationBlocker) => () => void;
}

/**
 * Coordinates the single visible form that can veto navigation. The controller
 * is deliberately independent from React Router so form protection does not
 * require the much larger data-router runtime in every app route.
 */
export function createNavigationGuardController(): NavigationGuardController {
  let activeBlocker: NavigationBlocker | null = null;

  return {
    isBlocked: () => activeBlocker !== null,
    request(continueNavigation) {
      if (activeBlocker) {
        activeBlocker(continueNavigation);
        return;
      }
      continueNavigation();
    },
    register(blocker) {
      activeBlocker = blocker;
      return () => {
        if (activeBlocker === blocker) {
          activeBlocker = null;
        }
      };
    },
  };
}
