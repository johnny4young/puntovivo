import { useCallback, useState } from 'react';
import { useBeforeUnload } from 'react-router';
import { useNavigationGuard } from './NavigationGuardContext';
import type { NavigationContinuation } from './navigationGuardController';

interface UseUnsavedChangesGuardOptions {
  when: boolean;
  onClose: () => void;
}

/**
 * Coordinates one unsaved form across local close controls, application
 * navigation, browser history, reload, and window close. The caller owns the
 * confirmation surface so page editors and modal forms can preserve their
 * appropriate focus and layout contracts.
 */
export function useUnsavedChangesGuard({ when, onClose }: UseUnsavedChangesGuardOptions) {
  const [pendingExit, setPendingExit] = useState<NavigationContinuation | null>(null);

  const requestClose = useCallback(() => {
    if (when) {
      setPendingExit(() => onClose);
      return;
    }
    onClose();
  }, [onClose, when]);

  const requestNavigationConfirmation = useCallback(
    (continueNavigation: NavigationContinuation) => {
      setPendingExit(() => continueNavigation);
    },
    []
  );
  useNavigationGuard(when, requestNavigationConfirmation);

  useBeforeUnload(
    useCallback(
      event => {
        if (!when) return;
        event.preventDefault();
        event.returnValue = '';
      },
      [when]
    )
  );

  const keepEditing = useCallback(() => setPendingExit(null), []);
  const discardChanges = useCallback(() => {
    const continueNavigation = pendingExit;
    setPendingExit(null);
    continueNavigation?.();
  }, [pendingExit]);

  return {
    requestClose,
    isExitConfirmationOpen: pendingExit !== null,
    keepEditing,
    discardChanges,
  };
}
