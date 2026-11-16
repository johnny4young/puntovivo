import { lazy, Suspense, useState } from 'react';
import type { CashSessionCloseValues } from '@/features/sales/CashSessionCloseModal';
import type { CashSessionMovementValues } from '@/features/sales/CashSessionMovementModal';
import type { CashSessionOpenValues } from '@/features/sales/CashSessionOpenModal';
import type { ResumeDraftSelection } from '@/features/sales/useSalesFlows';
import { trpc } from '@/lib/trpc';
import type { CashSession, RegisterAssignment } from '@/types';

const LazyCashSessionCloseModal = lazy(() =>
  import('@/features/sales/CashSessionCloseModal').then(module => ({
    default: module.CashSessionCloseModal,
  }))
);

const LazyCashSessionMovementModal = lazy(() =>
  import('@/features/sales/CashSessionMovementModal').then(module => ({
    default: module.CashSessionMovementModal,
  }))
);

const LazyCashSessionOpenModal = lazy(() =>
  import('@/features/sales/CashSessionOpenModal').then(module => ({
    default: module.CashSessionOpenModal,
  }))
);

const LazyHandOutShiftDialog = lazy(() =>
  import('@/features/shift-handoff/HandOutShiftDialog').then(module => ({
    default: module.HandOutShiftDialog,
  }))
);

const LazyReceiveShiftDialog = lazy(() =>
  import('@/features/shift-handoff/ReceiveShiftDialog').then(module => ({
    default: module.ReceiveShiftDialog,
  }))
);

const LazyDayCloseSummaryModal = lazy(() =>
  import('@/features/sales/DayCloseSummaryModal').then(module => ({
    default: module.DayCloseSummaryModal,
  }))
);

/**
 * Props for {@link CashSessionModals}.
 *
 * The cash-session open / close / record-movement modal cluster. Each
 * modal owns its conditional render + remount `key` here so SalesPage's
 * JSX stays flat. Purely presentational — open flags, keys, saving flags,
 * errors, and submit handlers are all owned by SalesPage.
 */
interface CashSessionModalsProps {
  isCashSessionModalOpen: boolean;
  cashSessionModalKey: number;
  isOpeningCashSession: boolean;
  cashSessionError: string | null;
  selectedRegisterAssignment: RegisterAssignment | null;
  onCloseOpenModal: () => void;
  onSubmitOpen: (values: CashSessionOpenValues) => Promise<void>;
  isCashSessionCloseModalOpen: boolean;
  cashSessionCloseModalKey: number;
  activeCashSession: CashSession | null;
  isClosingCashSession: boolean;
  cashSessionCloseError: string | null;
  onCloseCloseModal: () => void;
  onSubmitClose: (values: CashSessionCloseValues) => Promise<void>;
  suspendedDraftsCount: number;
  /** Keeps the close form mounted, and its counts, while it is out of view. */
  isCloseModalHidden?: boolean | undefined;
  onReviewSuspended?: (() => void) | undefined;
  isCashSessionMovementModalOpen: boolean;
  cashSessionMovementModalKey: number;
  isRecordingMovement: boolean;
  cashSessionMovementError: string | null;
  onCloseMovementModal: () => void;
  onSubmitMovement: (values: CashSessionMovementValues) => Promise<void>;
  /** non-null mounts the day-close ritual for that session. */
  dayCloseSessionId: string | null;
  onCloseDayClose: () => void;
  /** Resumes the parked sale the incoming cashier picked while receiving the drawer. */
  onResumeDraft?: ((draft: ResumeDraftSelection) => void) | undefined;
}

export function CashSessionModals({
  isCashSessionModalOpen,
  cashSessionModalKey,
  isOpeningCashSession,
  cashSessionError,
  selectedRegisterAssignment,
  onCloseOpenModal,
  onSubmitOpen,
  isCashSessionCloseModalOpen,
  cashSessionCloseModalKey,
  activeCashSession,
  isClosingCashSession,
  cashSessionCloseError,
  onCloseCloseModal,
  onSubmitClose,
  suspendedDraftsCount,
  isCloseModalHidden = false,
  onReviewSuspended,
  isCashSessionMovementModalOpen,
  cashSessionMovementModalKey,
  isRecordingMovement,
  cashSessionMovementError,
  onCloseMovementModal,
  onSubmitMovement,
  dayCloseSessionId,
  onCloseDayClose,
  onResumeDraft,
}: CashSessionModalsProps) {
  const [isHandingOut, setIsHandingOut] = useState(false);
  const [skipHandoff, setSkipHandoff] = useState(false);
  // A drawer handed over at this site is offered before a fresh open.
  const pendingQuery = trpc.shiftHandoffs.pending.useQuery(undefined, {
    enabled: isCashSessionModalOpen,
    staleTime: 0,
  });
  const pendingHandoff = pendingQuery.data?.handoffs[0] ?? null;
  const showReceive = isCashSessionModalOpen && !skipHandoff && pendingHandoff !== null;
  const showOpen =
    isCashSessionModalOpen && !showReceive && (skipHandoff || !pendingQuery.isLoading);
  const showHandOut = isCashSessionCloseModalOpen && isHandingOut && activeCashSession !== null;

  return (
    <Suspense fallback={null}>
      {showReceive && pendingHandoff && (
        <LazyReceiveShiftDialog
          key={pendingHandoff.id}
          handoff={pendingHandoff}
          pinRequired={pendingQuery.data?.pinRequired ?? false}
          isOpen
          onClose={onCloseOpenModal}
          onOpenWithout={() => setSkipHandoff(true)}
          onReceived={draft => {
            onCloseOpenModal();
            if (draft) {
              onResumeDraft?.({
                id: draft.id,
                label: draft.label,
                tableId: null,
                suspendedAt: draft.suspendedAt,
                resumedDeviceId: null,
              });
            }
          }}
        />
      )}
      {showOpen && (
        <LazyCashSessionOpenModal
          key={`${cashSessionModalKey}-${selectedRegisterAssignment?.id ?? 'none'}`}
          isOpen={isCashSessionModalOpen}
          isSaving={isOpeningCashSession}
          error={cashSessionError}
          defaultRegisterAssignment={selectedRegisterAssignment}
          onClose={onCloseOpenModal}
          onSubmit={onSubmitOpen}
        />
      )}
      {isCashSessionCloseModalOpen && (
        <LazyCashSessionCloseModal
          key={cashSessionCloseModalKey}
          cashSession={activeCashSession}
          isOpen={isCashSessionCloseModalOpen && !isCloseModalHidden && !showHandOut}
          isSaving={isClosingCashSession}
          error={cashSessionCloseError}
          onClose={onCloseCloseModal}
          onSubmit={onSubmitClose}
          suspendedDraftsCount={suspendedDraftsCount}
          onReviewSuspended={onReviewSuspended}
          onHandOut={activeCashSession ? () => setIsHandingOut(true) : undefined}
        />
      )}
      {showHandOut && (
        <LazyHandOutShiftDialog
          cashSession={activeCashSession}
          isOpen
          onClose={() => setIsHandingOut(false)}
          onHandedOut={() => {
            setIsHandingOut(false);
            onCloseCloseModal();
          }}
        />
      )}
      {isCashSessionMovementModalOpen && (
        <LazyCashSessionMovementModal
          key={cashSessionMovementModalKey}
          isOpen={isCashSessionMovementModalOpen}
          isSaving={isRecordingMovement}
          error={cashSessionMovementError}
          onClose={onCloseMovementModal}
          onSubmit={onSubmitMovement}
        />
      )}
      {dayCloseSessionId && (
        <LazyDayCloseSummaryModal
          key={dayCloseSessionId}
          sessionId={dayCloseSessionId}
          onClose={onCloseDayClose}
        />
      )}
    </Suspense>
  );
}
