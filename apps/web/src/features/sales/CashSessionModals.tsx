import { lazy, Suspense } from 'react';
import type { CashSessionCloseValues } from '@/features/sales/CashSessionCloseModal';
import type { CashSessionMovementValues } from '@/features/sales/CashSessionMovementModal';
import type { CashSessionOpenValues } from '@/features/sales/CashSessionOpenModal';
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
  isCashSessionMovementModalOpen: boolean;
  cashSessionMovementModalKey: number;
  isRecordingMovement: boolean;
  cashSessionMovementError: string | null;
  onCloseMovementModal: () => void;
  onSubmitMovement: (values: CashSessionMovementValues) => Promise<void>;
  /** non-null mounts the day-close ritual for that session. */
  dayCloseSessionId: string | null;
  onCloseDayClose: () => void;
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
  isCashSessionMovementModalOpen,
  cashSessionMovementModalKey,
  isRecordingMovement,
  cashSessionMovementError,
  onCloseMovementModal,
  onSubmitMovement,
  dayCloseSessionId,
  onCloseDayClose,
}: CashSessionModalsProps) {
  return (
    <Suspense fallback={null}>
      {isCashSessionModalOpen && (
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
          isOpen={isCashSessionCloseModalOpen}
          isSaving={isClosingCashSession}
          error={cashSessionCloseError}
          onClose={onCloseCloseModal}
          onSubmit={onSubmitClose}
          suspendedDraftsCount={suspendedDraftsCount}
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
