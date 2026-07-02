import { useState, type Dispatch, type SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { type CashSessionCloseValues } from '@/features/sales/CashSessionCloseModal';
import { type CashSessionMovementValues } from '@/features/sales/CashSessionMovementModal';
import { type CashSessionOpenValues } from '@/features/sales/CashSessionOpenModal';
import {
  useCheckoutPreflight,
  type PreflightItem,
} from '@/features/sales/useCheckoutPreflight';
import { type SaleCartItem, type SaleCartSummary } from '@/features/sales/saleCart';
import type { useSalesMutations } from '@/features/sales/useSalesMutations';
import type { CashSession, RegisterAssignment, Site } from '@/types';

/** Mutation handles owned by {@link useSalesMutations}; the shell threads the
 * cash-session subset this hook needs so it never imports the mutation hook at
 * runtime (type-only edge, keeping the shell → hook → shell DAG acyclic). */
type SalesMutationHandles = ReturnType<typeof useSalesMutations>;

/**
 * Params for {@link useSalesModals}.
 *
 * ENG-178 slice 16b-1 — the modal/UI open-close handlers + the checkout
 * preflight were extracted verbatim from SalesPage. The hook OWNS only the
 * pure modal-control state nothing else injects setters for (the search-open
 * flag, the per-modal remount key counters, and the fast-cash trigger). The
 * payment / cash-session `isOpen` + `*Error` `useState` stay in the shell
 * because `useSalesMutations` (wired BEFORE this hook) injects their setters,
 * so this hook receives those setters as params. `useCheckoutPreflight` moves
 * inside here so `handleOpenPaymentModal`'s preflight read and the preflight
 * `onOpenCashSession` recovery both stay intra-hook (no cross-hook cycle).
 */
export interface UseSalesModalsParams {
  currentSite: Site | null;
  cartItems: SaleCartItem[];
  draftSummary: SaleCartSummary;
  activeCashSession: CashSession | null;
  hasActiveCashSession: boolean;
  isResumedCart: boolean;
  selectedRegisterAssignment: RegisterAssignment | null;
  /** The currently keyboard-selected history row, or null — drives the reprint shortcut. */
  selectedHistorySaleId: string | null;
  /** `useAuth().user.role ?? 'cashier'` — gates the preflight credit-sale family. */
  userRole: string;
  /** Server-derived checkout reminders (ENG-184), mapped to PreflightItems by the shell. */
  checkoutReadinessItems: PreflightItem[];
  /** Read by `handleFastCash` to decide open-vs-bump; the value stays shell-owned. */
  isPaymentModalOpen: boolean;
  /** Default initial query for the product-search dialog. */
  productSearchQuery: string;
  setSaleError: Dispatch<SetStateAction<string | null>>;
  setIsPaymentModalOpen: Dispatch<SetStateAction<boolean>>;
  setCashSessionError: Dispatch<SetStateAction<string | null>>;
  setIsCashSessionModalOpen: Dispatch<SetStateAction<boolean>>;
  setCashSessionCloseError: Dispatch<SetStateAction<string | null>>;
  setIsCashSessionCloseModalOpen: Dispatch<SetStateAction<boolean>>;
  setCashSessionMovementError: Dispatch<SetStateAction<string | null>>;
  setIsCashSessionMovementModalOpen: Dispatch<SetStateAction<boolean>>;
  setIsSuspendedPanelOpen: Dispatch<SetStateAction<boolean>>;
  setSelectedSaleId: Dispatch<SetStateAction<string | null>>;
  openCashSessionMutation: SalesMutationHandles['openCashSessionMutation'];
  closeCashSessionMutation: SalesMutationHandles['closeCashSessionMutation'];
  recordCashMovementMutation: SalesMutationHandles['recordCashMovementMutation'];
}

/**
 * Owns the modal/UI controller surface for SalesPage: the checkout preflight,
 * the F1 payment-open gate (`handleOpenPaymentModal`) + its F2 fast-cash entry
 * (`handleFastCash`), the product-search open, the three cash-session modal
 * open/submit pairs, the suspended-panel toggle, and the history-reprint jump.
 * Handlers stay plain (non-memoized) closures matching their prior shell form;
 * the pure modal-control state (search-open, remount keys, fast-cash trigger)
 * is owned here and returned for the JSX + the keyboard/scanner hooks.
 */
export function useSalesModals({
  currentSite,
  cartItems,
  draftSummary,
  activeCashSession,
  hasActiveCashSession,
  isResumedCart,
  selectedRegisterAssignment,
  selectedHistorySaleId,
  userRole,
  checkoutReadinessItems,
  isPaymentModalOpen,
  productSearchQuery,
  setSaleError,
  setIsPaymentModalOpen,
  setCashSessionError,
  setIsCashSessionModalOpen,
  setCashSessionCloseError,
  setIsCashSessionCloseModalOpen,
  setCashSessionMovementError,
  setIsCashSessionMovementModalOpen,
  setIsSuspendedPanelOpen,
  setSelectedSaleId,
  openCashSessionMutation,
  closeCashSessionMutation,
  recordCashMovementMutation,
}: UseSalesModalsParams) {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();

  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [productSearchInitialQuery, setProductSearchInitialQuery] = useState('');
  const [productSearchDialogKey, setProductSearchDialogKey] = useState(0);
  const [paymentModalKey, setPaymentModalKey] = useState(0);
  // ENG-105e — F2 fast-cash signal routed to SalePaymentModal.
  // Zero means normal F1 open; positive values apply exact cash on
  // mount and each later increment re-applies while the modal is open.
  const [fastCashTrigger, setFastCashTrigger] = useState(0);
  const [cashSessionModalKey, setCashSessionModalKey] = useState(0);
  const [cashSessionCloseModalKey, setCashSessionCloseModalKey] = useState(0);
  const [cashSessionMovementModalKey, setCashSessionMovementModalKey] = useState(0);

  const preflight = useCheckoutPreflight({
    cartItems,
    cartSummary: draftSummary,
    cashSession: activeCashSession,
    paymentMethod: null,
    selectedCustomer: null,
    pendingDiscountAmount: 0,
    userRole,
    isResumedDraft: isResumedCart,
    recovery: {
      onOpenCashSession: () => handleOpenCashSessionModal(),
    },
    serverItems: checkoutReadinessItems,
  });

  // ENG-105e — F2 fast-cash entry point. Closed modal delegates to
  // the same F1 payment-open gate with `fastCash=true`; open modal
  // bumps the trigger so the modal re-applies exact cash.
  const handleFastCash = () => {
    if (isPaymentModalOpen) {
      setFastCashTrigger(current => current + 1);
      return;
    }
    handleOpenPaymentModal(true);
  };

  const handleOpenProductSearch = (initialQuery = productSearchQuery) => {
    setProductSearchInitialQuery(initialQuery.trim());
    setProductSearchDialogKey(current => current + 1);
    setIsProductSearchOpen(true);
  };

  const handleOpenPaymentModal = (fastCash = false) => {
    if (!currentSite || cartItems.length === 0) {
      return;
    }

    // ENG-105b — preflight gate. If any blocker is showing, surface a
    // toast pointing at the first blocker instead of opening the
    // payment modal blindly. The `cash_session_required` case keeps
    // the legacy convenience of jumping to the cash session modal so
    // F1 stays useful when the only blocker is the closed register.
    if (!preflight.isReady && preflight.primaryBlocker) {
      if (preflight.primaryBlocker.id === 'cash_session_required') {
        handleOpenCashSessionModal();
        return;
      }
      // ENG-179b — exactOptional rejects `t(key, undefined)`; gate on the values.
      const blockerMessage = preflight.primaryBlocker.messageValues
        ? t(preflight.primaryBlocker.messageKey, preflight.primaryBlocker.messageValues)
        : t(preflight.primaryBlocker.messageKey);
      toast.error({
        title: t('preflight.toast.blocked', { message: blockerMessage }),
      });
      return;
    }

    if (!hasActiveCashSession) {
      handleOpenCashSessionModal();
      return;
    }

    setSaleError(null);
    setFastCashTrigger(fastCash ? current => current + 1 : 0);
    setPaymentModalKey(current => current + 1);
    setIsPaymentModalOpen(true);
  };

  const handleOpenCashSessionModal = () => {
    if (!currentSite || !selectedRegisterAssignment || selectedRegisterAssignment.isOccupied) {
      return;
    }

    setCashSessionError(null);
    setCashSessionModalKey(current => current + 1);
    setIsCashSessionModalOpen(true);
  };

  // These three modal forms are Enter/requestSubmit-able, which bypasses
  // the disabled footer button — the isPending guards stop a repeated
  // Enter from firing the critical mutation twice with two envelopes.
  const handleCreateCashSession = async (values: CashSessionOpenValues) => {
    if (openCashSessionMutation.isPending) {
      return;
    }
    await openCashSessionMutation.mutateAsync(values);
  };

  const handleOpenCloseCashSessionModal = () => {
    if (!activeCashSession) {
      return;
    }

    setCashSessionCloseError(null);
    setCashSessionCloseModalKey(current => current + 1);
    setIsCashSessionCloseModalOpen(true);
  };

  const handleCloseCashSession = async (values: CashSessionCloseValues) => {
    if (closeCashSessionMutation.isPending) {
      return;
    }
    await closeCashSessionMutation.mutateAsync(values);
  };

  const handleOpenCashSessionMovementModal = () => {
    if (!activeCashSession) {
      return;
    }

    setCashSessionMovementError(null);
    setCashSessionMovementModalKey(current => current + 1);
    setIsCashSessionMovementModalOpen(true);
  };

  const handleRecordCashMovement = async (values: CashSessionMovementValues) => {
    if (recordCashMovementMutation.isPending) {
      return;
    }
    await recordCashMovementMutation.mutateAsync(values);
  };

  const handleToggleSuspendedPanel = () => {
    setIsSuspendedPanelOpen(open => !open);
  };

  // Ctrl+Shift+P on a focused history row → open the SaleDetailsModal
  // which is where the Reprint action lives (landed with ENG-019). The
  // modal owns the reason picker + completeDraft chain; this shortcut
  // is just the "jump there quickly" surface.
  const handleReprintSelectedHistoryRow = () => {
    if (!selectedHistorySaleId) {
      return;
    }
    setSelectedSaleId(selectedHistorySaleId);
  };

  return {
    preflight,
    isProductSearchOpen,
    setIsProductSearchOpen,
    productSearchInitialQuery,
    productSearchDialogKey,
    paymentModalKey,
    fastCashTrigger,
    setFastCashTrigger,
    cashSessionModalKey,
    cashSessionCloseModalKey,
    cashSessionMovementModalKey,
    handleFastCash,
    handleOpenProductSearch,
    handleOpenPaymentModal,
    handleOpenCashSessionModal,
    handleCreateCashSession,
    handleOpenCloseCashSessionModal,
    handleCloseCashSession,
    handleOpenCashSessionMovementModal,
    handleRecordCashMovement,
    handleToggleSuspendedPanel,
    handleReprintSelectedHistoryRow,
  };
}
