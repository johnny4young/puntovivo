import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';
import type { CashSession, PendingCashHandoff, RegisterAssignment } from '@/types';
import type { ResumeDraftSelection } from '../useSalesFlows';
import { HandoffSheets } from './HandoffSheets';
import type { ReceivedHandoffFollowUp } from './ReceiveHandoffSheet';

interface UseShiftHandoffParams {
  siteId: string | null;
  activeCashSession: CashSession | null;
  registerAssignments: RegisterAssignment[];
  selectedRegisterAssignment: RegisterAssignment | null;
  hasReceiptPrinter: boolean;
  onResumeDraft: (draft: ResumeDraftSelection) => unknown;
  onRequestChange: () => void;
}

export interface ReceivableHandoff {
  registerName: string;
  /** The selected register is the one waiting, so receiving replaces opening it. */
  isSelectedRegister: boolean;
  open: () => void;
}

/** Hand-over and receive entry points for the register, plus their lazy sheets. */
export function useShiftHandoff({
  siteId,
  activeCashSession,
  registerAssignments,
  selectedRegisterAssignment,
  hasReceiptPrinter,
  onResumeDraft,
  onRequestChange,
}: UseShiftHandoffParams) {
  const { user } = useAuth();
  // Tied to the session, so a session ended elsewhere cannot leave the sheet armed.
  const [handingOverId, setHandingOverId] = useState<string | null>(null);
  const isHandingOver = !!activeCashSession && handingOverId === activeCashSession.id;
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const changePending = useRef(false);

  const pendingQuery = trpc.cashSessions.pendingHandoffs.useQuery(undefined, {
    enabled: !!siteId && !activeCashSession,
    refetchInterval: 60_000,
  });
  const receivable = (pendingQuery.data ?? []).filter(
    (handoff: PendingCashHandoff) =>
      handoff.fromCashierId !== user?.id &&
      (!handoff.toCashierId || handoff.toCashierId === user?.id)
  );
  const selected = receivable.find(
    handoff => handoff.registerName === selectedRegisterAssignment?.registerName
  );
  const preferred = selected ?? receivable[0] ?? null;
  const receiving = receivable.find(handoff => handoff.id === receivingId) ?? null;

  // The change request records a movement, which needs the session the receipt just opened.
  useEffect(() => {
    if (changePending.current && activeCashSession) {
      changePending.current = false;
      onRequestChange();
    }
  }, [activeCashSession, onRequestChange]);

  const handleReceived = ({ resumeDraft, requestChange }: ReceivedHandoffFollowUp) => {
    setReceivingId(null);
    if (requestChange) changePending.current = true;
    if (resumeDraft) {
      void onResumeDraft({
        id: resumeDraft.id,
        label: resumeDraft.label,
        tableId: null,
        suspendedAt: resumeDraft.suspendedAt,
        resumedDeviceId: null,
      });
    }
  };

  const receive: ReceivableHandoff | null =
    !activeCashSession && preferred
      ? {
          registerName: preferred.registerName,
          isSelectedRegister: preferred === selected,
          open: () => setReceivingId(preferred.id),
        }
      : null;

  const sheets = (
    <HandoffSheets
      give={
        isHandingOver && activeCashSession
          ? {
              cashSession: activeCashSession,
              hasReceiptPrinter,
              onClose: () => setHandingOverId(null),
            }
          : null
      }
      receive={
        receiving && !activeCashSession
          ? {
              handoff: receiving,
              assignment:
                registerAssignments.find(
                  assignment => assignment.registerName === receiving.registerName
                ) ?? null,
              onClose: () => setReceivingId(null),
              onReceived: handleReceived,
            }
          : null
      }
    />
  );

  return {
    handOver: activeCashSession ? () => setHandingOverId(activeCashSession.id) : undefined,
    receive,
    isSheetOpen: isHandingOver || receiving !== null,
    sheets,
  };
}
