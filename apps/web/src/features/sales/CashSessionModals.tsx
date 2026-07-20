import {
  CashSessionCloseModal,
  type CashSessionCloseValues,
} from '@/features/sales/CashSessionCloseModal';
import {
  CashSessionMovementModal,
  type CashSessionMovementValues,
} from '@/features/sales/CashSessionMovementModal';
import {
  CashSessionOpenModal,
  type CashSessionOpenValues,
} from '@/features/sales/CashSessionOpenModal';
import { DayCloseSummaryModal } from '@/features/sales/DayCloseSummaryModal';
import type { CashSession, RegisterAssignment } from '@/types';

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
    <>
      {isCashSessionModalOpen && (
        <CashSessionOpenModal
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
        <CashSessionCloseModal
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
        <CashSessionMovementModal
          key={cashSessionMovementModalKey}
          isOpen={isCashSessionMovementModalOpen}
          isSaving={isRecordingMovement}
          error={cashSessionMovementError}
          onClose={onCloseMovementModal}
          onSubmit={onSubmitMovement}
        />
      )}
      {dayCloseSessionId && (
        <DayCloseSummaryModal
          key={dayCloseSessionId}
          sessionId={dayCloseSessionId}
          onClose={onCloseDayClose}
        />
      )}
    </>
  );
}
