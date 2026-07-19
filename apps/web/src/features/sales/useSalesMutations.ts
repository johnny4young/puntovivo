import { useCallback, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useCartWorkspaceStore } from '@/features/sales/useCartWorkspaceStore';
import {
  CASH_SESSION_CLOSE_INVALIDATIONS,
  CASH_SESSION_OPEN_INVALIDATIONS,
  invalidateGroups,
  SALE_COMPLETION_INVALIDATIONS,
} from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { playSaleComplete } from '@/lib/sound';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatCurrency } from '@/lib/utils';
import type { Sale } from '@/types';

/**
 * Params for {@link useSalesMutations}.
 *
 * The hook owns the sales + cash-session mutation handles and the shared
 * `finishSaleEpilogue`, but ALL the state it mutates lives in SalesPage —
 * the setters are injected so the dependency direction stays shell → hook
 * (deps in) and hook → shell (setter calls out), never hook ↔ hook.
 * `maybeAutoPrint` comes from {@link useReceiptAutoPrint} (the single
 * mandatory hook→hook edge, forcing call-order: auto-print before this).
 */
interface UseSalesMutationsParams {
  /** `${tenantId}:${userId}` or null when signed out — drives the post-sale workspace reset. */
  ownerKey: string | null;
  /** Best-effort auto-print invoked after the completion toast (ENG-097). */
  maybeAutoPrint: (sale: Sale) => Promise<void>;
  setProductSearchQuery: Dispatch<SetStateAction<string>>;
  setSaleError: Dispatch<SetStateAction<string | null>>;
  setIsPaymentModalOpen: Dispatch<SetStateAction<boolean>>;
  setCashSessionError: Dispatch<SetStateAction<string | null>>;
  setIsCashSessionModalOpen: Dispatch<SetStateAction<boolean>>;
  setCashSessionCloseError: Dispatch<SetStateAction<string | null>>;
  setIsCashSessionCloseModalOpen: Dispatch<SetStateAction<boolean>>;
  setCashSessionMovementError: Dispatch<SetStateAction<string | null>>;
  setIsCashSessionMovementModalOpen: Dispatch<SetStateAction<boolean>>;
  /**
   * ENG-198 — hands the just-closed session id to the shell so it mounts
   * the day-close ritual (DayCloseSummaryModal). Additive to the close
   * toast, which stays intact.
   */
  setDayCloseSessionId: Dispatch<SetStateAction<string | null>>;
}

/**
 * Owns the sales + cash-session mutation handles for SalesPage: the fresh
 * create / completeDraft sale paths (with the shared `finishSaleEpilogue`
 * + ENG-097 auto-print), the suspend / resume / discard-draft trio, and
 * the cash-session open / close / record-movement trio. The flow handlers
 * that orchestrate these (handleCheckout, handleSuspendConfirm, …) stay in
 * SalesPage and call the returned handles; this hook only centralizes the
 * mutation config + success/error wiring.
 */
export function useSalesMutations({
  ownerKey,
  maybeAutoPrint,
  setProductSearchQuery,
  setSaleError,
  setIsPaymentModalOpen,
  setCashSessionError,
  setIsCashSessionModalOpen,
  setCashSessionCloseError,
  setIsCashSessionCloseModalOpen,
  setCashSessionMovementError,
  setIsCashSessionMovementModalOpen,
  setDayCloseSessionId,
}: UseSalesMutationsParams) {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();

  // Shared epilogue for both "finish a sale" paths: sales.create for a
  // fresh cart, and sales.completeDraft for a resumed draft. Both need
  // to invalidate the same query set and both want the workspace to
  // reset to a fresh blank draft.
  const finishSaleEpilogue = useCallback(
    async (itemCount: number, loyaltyPointsEarned = 0) => {
      await invalidateGroups(utils, SALE_COMPLETION_INVALIDATIONS);
      const storeState = useCartWorkspaceStore.getState();
      if (storeState.activeId) {
        storeState.removeWorkspace(storeState.activeId);
      }
      if (ownerKey) {
        storeState.createDraft(ownerKey);
      }
      setProductSearchQuery('');
      setSaleError(null);
      setIsPaymentModalOpen(false);
      playSaleComplete();
      // ENG-213 — when the sale accrued points, the cashier should be able
      // to tell the customer without opening another screen. The base copy
      // is unchanged for every tenant without the program (0 points).
      const description =
        loyaltyPointsEarned > 0
          ? `${itemCount} ${t('toast.successDetail')} · ${t('loyalty.earned', { count: loyaltyPointsEarned })}`
          : `${itemCount} ${t('toast.successDetail')}`;
      toast.success({
        title: t('toast.success'),
        description,
      });
    },
    [
      ownerKey,
      t,
      toast,
      utils,
      setIsPaymentModalOpen,
      // setProductSearchQuery + setSaleError are stable shell useState
      // setters passed in as props; listed to satisfy exhaustive-deps now
      // that they are params (identity stable → no behavior change).
      setProductSearchQuery,
      setSaleError,
    ]
  );

  const createMutation = useCriticalMutation('sales.create', {
    onSuccess: async (data, variables) => {
      // Drafts created via the Suspend orchestration skip the epilogue
      // — `handleSuspendConfirm` handles invalidation + workspace
      // reset + the localized "Sale suspended" toast itself so the
      // operator never sees the "Sale completed" message on a
      // still-in-flight suspend.
      if (variables.status !== 'completed') {
        return;
      }
      await finishSaleEpilogue(variables.items.length, data.loyaltyPointsEarned);
      // ENG-097 — best-effort auto-print after the epilogue toast so
      // the cashier sees "Sale completed" before any printer fallback
      // warning lands.
      await maybeAutoPrint(data as Sale);
    },
    onError: onErrorToast(toast, t),
  });

  // ENG-018c — completing a resumed draft. `items` is locked server
  // side so we do not send it; the cashier can only add payments /
  // notes at this point.
  const completeDraftMutation = useCriticalMutation('sales.completeDraft', {
    onSuccess: async result => {
      await finishSaleEpilogue(result.items.length, result.loyaltyPointsEarned);
      // ENG-097 — auto-print mirror of the fresh-create path.
      await maybeAutoPrint(result as Sale);
    },
    onError: onErrorToast(toast, t),
  });

  // ENG-018b — server calls for the suspend / resume orchestration.
  // Suspend is a two-step flow: persist the local cart as a server
  // draft via `sales.create({ status: 'draft' })`, then mark it
  // suspended via `sales.suspend`. The two mutations are chained
  // inside `handleSuspendConfirm` below instead of individual
  // onSuccess callbacks so the intermediate "draft created, but not
  // yet suspended" state never surfaces in the UI.
  const suspendMutation = useCriticalMutation('sales.suspend');
  const resumeMutation = useCriticalMutation('sales.resume');
  // ENG-018b — used both by the SuspendedSalesPanel (which has its own
  // internal mutation) AND by the orphan-cleanup path inside
  // `handleSuspendConfirm` below. Keeping a page-level handle lets us
  // compensate if `sales.suspend` throws after `sales.create(draft)`
  // already created + stock-debited the row.
  const discardDraftMutation = useCriticalMutation('sales.discardDraft');
  const openCashSessionMutation = useCriticalMutation('cashSessions.open', {
    onSuccess: async cashSession => {
      await invalidateGroups(utils, CASH_SESSION_OPEN_INVALIDATIONS);
      setCashSessionError(null);
      setIsCashSessionModalOpen(false);
      toast.success({
        title: t('cashSession.toast.openSuccessTitle'),
        description: t(
          cashSession.attendanceShiftStarted
            ? 'cashSession.toast.openWithAttendanceDescription'
            : 'cashSession.toast.openSuccessDescription',
          {
            registerName: cashSession.registerName,
            amount: formatCurrency(cashSession.openingFloat),
          }
        ),
      });
    },
    onError: onErrorToast(toast, t, {
      extra: description => setCashSessionError(description),
    }),
  });
  const closeCashSessionMutation = useCriticalMutation('cashSessions.close', {
    onSuccess: async cashSession => {
      await invalidateGroups(utils, CASH_SESSION_CLOSE_INVALIDATIONS);
      setCashSessionCloseError(null);
      setIsCashSessionCloseModalOpen(false);

      const overShort = cashSession.overShort ?? 0;
      const absoluteOverShort = formatCurrency(Math.abs(overShort));
      const closeSummary =
        Math.abs(overShort) < 1e-6
          ? t('cashSession.toast.closeBalancedDescription', {
              registerName: cashSession.registerName,
              amount: formatCurrency(cashSession.actualCount ?? 0),
            })
          : overShort > 0
            ? t('cashSession.toast.closeOverDescription', {
                registerName: cashSession.registerName,
                amount: absoluteOverShort,
              })
            : t('cashSession.toast.closeShortDescription', {
                registerName: cashSession.registerName,
                amount: absoluteOverShort,
              });

      const description = cashSession.employeeShiftId
        ? t('cashSession.toast.closeAttendanceDescription', { description: closeSummary })
        : closeSummary;

      toast.success({
        title: t('cashSession.toast.closeSuccessTitle'),
        description,
      });

      // ENG-198 — hand off to the day-close ritual after the toast fires.
      setDayCloseSessionId(cashSession.id);
    },
    onError: onErrorToast(toast, t, {
      extra: description => setCashSessionCloseError(description),
    }),
  });
  const recordCashMovementMutation = useCriticalMutation('cashSessions.recordMovement', {
    onSuccess: async movement => {
      await invalidateGroups(utils, [
        u => u.cashSessions.getActive,
        u => u.cashSessions.movements,
        u => u.cashSessions.report,
        u => u.cashSessions.registerAssignments,
      ]);
      setCashSessionMovementError(null);
      setIsCashSessionMovementModalOpen(false);
      toast.success({
        title: t('cashSession.toast.movementSuccessTitle'),
        description: t('cashSession.toast.movementSuccessDescription', {
          movementType: t(`cashSession.movementTypes.${movement.type}`),
          amount: formatCurrency(movement.amount),
        }),
      });
    },
    onError: onErrorToast(toast, t, {
      extra: description => setCashSessionMovementError(description),
    }),
  });

  return {
    createMutation,
    completeDraftMutation,
    suspendMutation,
    resumeMutation,
    discardDraftMutation,
    openCashSessionMutation,
    closeCashSessionMutation,
    recordCashMovementMutation,
  };
}
