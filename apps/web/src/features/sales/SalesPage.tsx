import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Drawer } from '@/components/feedback/Drawer';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { type CashSessionCloseValues } from '@/features/sales/CashSessionCloseModal';
import { type CashSessionMovementValues } from '@/features/sales/CashSessionMovementModal';
import { type CashSessionOpenValues } from '@/features/sales/CashSessionOpenModal';
import { SalesCartWorkspace } from '@/features/sales/SalesCartWorkspace';
import { SalesCheckoutPanel } from '@/features/sales/SalesCheckoutPanel';
import { CashSessionModals } from '@/features/sales/CashSessionModals';
import { SalesHeaderSection } from '@/features/sales/SalesHeaderSection';
import { SalesModals } from '@/features/sales/SalesModals';
import { WorkspaceTabsSection } from '@/features/sales/WorkspaceTabsSection';
import { useReceiptAutoPrint } from '@/features/sales/useReceiptAutoPrint';
import { useCashDrawerController } from '@/features/sales/useCashDrawerController';
import { useBarcodeProductScanner } from '@/features/sales/useBarcodeProductScanner';
import { useSalesMutations } from '@/features/sales/useSalesMutations';
import { useSalesFlows } from '@/features/sales/useSalesFlows';
import {
  useCheckoutPreflight,
  type PreflightBlockerId,
  type PreflightItem,
} from '@/features/sales/useCheckoutPreflight';
import { useQuickCreateStore } from '@/features/sales/useQuickCreateStore';
import { useHubReachability } from '@/hooks/useHubReachability';
import { SalesHistoryTable } from '@/features/sales/SalesHistoryTable';
import { SalesMobileCheckoutBar } from '@/features/sales/SalesMobileCheckoutBar';
import { SuspendedSalesPanel } from '@/features/sales/SuspendedSalesPanel';
import {
  getCartItemKey,
  getCartSummary,
  mergeCartItem,
  updateCartItem,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import { getActiveCartSelectionKey } from '@/features/sales/salesKeyboard';
import { useSalesInputFocus } from '@/features/sales/useSalesInputFocus';
import { useScannerFocusRestoration } from '@/features/sales/useScannerFocusRestoration';
import { useSalesKeyboardShortcuts } from '@/features/sales/useSalesKeyboardShortcuts';
import {
  DEFAULT_WEDGE_CONFIG,
  type WedgeConfig,
} from '@/features/sales/useBarcodeWedgeListener';
import {
  selectActiveWorkspace,
  useCartWorkspaceStore,
} from '@/features/sales/useCartWorkspaceStore';
import { useTenant } from '@/features/tenant/TenantProvider';
import { trpc } from '@/lib/trpc';
import type {
  CashSession,
  Category,
  Customer,
  Provider,
  RegisterAssignment,
  Sale,
} from '@/types';

export function SalesPage() {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();
  const { currentTenant, currentSite, tenantSettings } = useTenant();
  // ENG-039d3 — restaurant service-charge rate flows from the tenant
  // setting into `SalePaymentModal`. 0 means disabled (default for
  // retail tenants); positive values auto-apply on every checkout.
  const serviceChargeRate = tenantSettings?.restaurant?.serviceChargeRate ?? 0;
  const { user } = useAuth();
  const shouldRenderQuickCreateProductGate = useQuickCreateStore(
    state => state.requestedCreateProduct !== null
  );
  const shouldRenderQuickCreateCustomerGate = useQuickCreateStore(
    state => state.requestedCreateCustomer !== null
  );
  // ENG-074 — `useHubReachability` is a no-op outside `hub_client`
  // mode. In hub_client mode, `reachable === false` flips the
  // checkout primary action to disabled via the panel's gate prop.
  // `null` (initial state before the first poll) and `true` both
  // pass through as "reachable enough"; only an explicit `false`
  // gates.
  const hubReachability = useHubReachability();
  const hubReachable =
    hubReachability.reachable === null ? undefined : hubReachability.reachable;

  // ENG-018b — cart items and the keyboard-selected row now live in
  // the shared `useCartWorkspaceStore`. SalesPage reads the active
  // workspace through selectors and dispatches mutations through the
  // `setCartItems` / `setSelectedCartItemKey` wrappers below. The
  // wrappers keep the `useState`-style ergonomics of the old code so
  // the handlers further down do not need to learn the store API.
  const ownerKey =
    currentTenant && user ? `${currentTenant.id}:${user.id}` : null;
  const activeWorkspace = useCartWorkspaceStore(selectActiveWorkspace);
  const allWorkspaces = useCartWorkspaceStore(state => state.workspaces);
  // Ensure SalesPage always has a cart ready for the signed-in cashier:
  // if no active workspace exists or the active one belongs to a
  // different owner (ex: a prior cashier signed out and a new one
  // logged in on the same machine), materialize a fresh local draft.
  useEffect(() => {
    if (!ownerKey) {
      return;
    }
    const state = useCartWorkspaceStore.getState();
    const active = state.activeId
      ? state.workspaces[state.activeId] ?? null
      : null;
    if (active && active.ownerKey === ownerKey) {
      return;
    }
    const reusableOwned = Object.values(state.workspaces).find(
      workspace =>
        workspace.ownerKey === ownerKey && workspace.serverSaleId === null
    );
    if (reusableOwned) {
      state.setActive(reusableOwned.id);
      return;
    }
    state.createDraft(ownerKey);
  }, [ownerKey]);

  const cartItems = activeWorkspace?.items ?? [];
  const ownedWorkspaces = ownerKey
    ? Object.values(allWorkspaces)
        .filter(workspace => workspace.ownerKey === ownerKey)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    : [];
  const selectedCartItemKey = activeWorkspace?.selectedItemKey ?? null;
  const isResumedCart = activeWorkspace?.serverSaleId != null;
  const canUndoActiveCart =
    !isResumedCart && (activeWorkspace?.historyStack.length ?? 0) > 0;

  type SetCartItemsArg =
    | SaleCartItem[]
    | ((previous: SaleCartItem[]) => SaleCartItem[]);
  const setCartItems = useCallback(
    (update: SetCartItemsArg) => {
      const state = useCartWorkspaceStore.getState();
      const activeId = state.activeId;
      if (!activeId) {
        return;
      }
      const current = state.workspaces[activeId]?.items ?? [];
      const next =
        typeof update === 'function' ? update(current) : update;
      state.updateCart(activeId, next);
    },
    []
  );
  const setSelectedCartItemKey = useCallback(
    (key: string | null) => {
      const state = useCartWorkspaceStore.getState();
      const activeId = state.activeId;
      if (!activeId) {
        return;
      }
      state.setSelectedItem(activeId, key);
    },
    []
  );
  // ENG-186 — el POS es ahora la única superficie de /sales (carrito +
  // resumen de cobro). El historial pasó de un toggle segmentado a un
  // cajón lateral (Drawer) para que nunca compita verticalmente con el
  // flujo de cobro; los KPIs y el Control de caja ya viven en Dashboard
  // y Operations → Caja respectivamente.
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productSearchInitialQuery, setProductSearchInitialQuery] = useState('');
  const [productSearchDialogKey, setProductSearchDialogKey] = useState(0);
  // ENG-018b — multi-cart workspace UX state. The label-prompt modal
  // captures an optional "Mesa 5" annotation before the Suspend server
  // orchestration runs; the suspended panel is toggled by Ctrl+R or
  // operator clicks.
  const [isSuspendedPanelOpen, setIsSuspendedPanelOpen] = useState(false);
  const [isSuspendLabelPromptOpen, setIsSuspendLabelPromptOpen] = useState(false);
  const [suspendLabelDraft, setSuspendLabelDraft] = useState('');
  const [isSuspending, setIsSuspending] = useState(false);
  const [selectedHistorySaleId, setSelectedHistorySaleId] = useState<
    string | null
  >(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentModalKey, setPaymentModalKey] = useState(0);
  // ENG-105e — F2 fast-cash signal routed to SalePaymentModal.
  // Zero means normal F1 open; positive values apply exact cash on
  // mount and each later increment re-applies while the modal is open.
  const [fastCashTrigger, setFastCashTrigger] = useState(0);
  const [isCashSessionModalOpen, setIsCashSessionModalOpen] = useState(false);
  const [cashSessionModalKey, setCashSessionModalKey] = useState(0);
  const [isCashSessionCloseModalOpen, setIsCashSessionCloseModalOpen] = useState(false);
  const [cashSessionCloseModalKey, setCashSessionCloseModalKey] = useState(0);
  const [isCashSessionMovementModalOpen, setIsCashSessionMovementModalOpen] = useState(false);
  const [cashSessionMovementModalKey, setCashSessionMovementModalKey] = useState(0);
  const [selectedRegisterAssignmentId, setSelectedRegisterAssignmentId] = useState<string | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [cashSessionError, setCashSessionError] = useState<string | null>(null);
  const [cashSessionCloseError, setCashSessionCloseError] = useState<string | null>(null);
  const [cashSessionMovementError, setCashSessionMovementError] = useState<string | null>(null);
  const {
    productInputRef,
    focusProductInput,
    focusQuantityInput,
    focusDiscountInput,
    quantityInputRefFor,
    discountInputRefFor,
  } = useSalesInputFocus();

  // ENG-105f — Keep the product search input focused across the
  // cashier flow so a USB HID barcode scanner always lands on the
  // right target. The hook handles initial mount + the open → close
  // transition of ProductSearchDialog, SalePaymentModal, and the
  // two quick-create gates. Editable-field guards stay in the wedge
  // listener — a cashier who clicks a qty cell keeps focus there.
  useScannerFocusRestoration({
    productInputRef,
    isProductSearchOpen,
    isPaymentModalOpen,
    isQuickCreateProductMounted: shouldRenderQuickCreateProductGate,
    isQuickCreateCustomerMounted: shouldRenderQuickCreateCustomerGate,
  });
  // ENG-171 — `placeholderData: keepPreviousData` on the high-traffic
  // entry queries so navigating into /sales (or re-fetching on a key
  // change such as a site switch) keeps the last data on screen instead
  // of blanking the shell while the new request is in flight. Paired with
  // the hover-prefetch on the sidebar /sales entry (usePrefetchSales).
  const salesQuery = trpc.sales.list.useQuery(
    { page: 1, perPage: 50 },
    { placeholderData: keepPreviousData }
  );
  const customersQuery = trpc.customers.list.useQuery(
    { page: 1, perPage: 100, isActive: true },
    { placeholderData: keepPreviousData }
  );
  const categoriesQuery = trpc.categories.tree.useQuery();
  const providersQuery = trpc.providers.list.useQuery({ page: 1, perPage: 100 });
  const activeCashSessionQuery = trpc.cashSessions.getActive.useQuery(
    { siteId: currentSite?.id },
    {
      enabled: !!currentSite,
      placeholderData: keepPreviousData,
    }
  );
  const activeCashSession = (activeCashSessionQuery.data as CashSession | null | undefined) ?? null;
  const registerAssignmentsQuery = trpc.cashSessions.registerAssignments.useQuery(undefined, {
    enabled: !!currentSite,
  });
  // ENG-018b — pre-fetch suspended-drafts count for the close-session
  // modal warning. Query stays enabled so the panel toggle + the
  // modal warning always see a fresh count; the payload is tiny
  // (paginated, 50 rows max).
  const draftsQuery = trpc.sales.listDrafts.useQuery(
    { page: 1, perPage: 50 },
    { enabled: !!currentTenant }
  );
  const suspendedDraftsCount = draftsQuery.data?.totalItems ?? 0;

  // ENG-097 — auto-print on sale completion.
  //
  // The active site's active printer config is read via the SAME
  // `peripherals.activeForSite` query that ENG-061 already mounts for
  // the barcode scanner + cash-drawer detection (declared further
  // down as `peripheralsForSiteQuery`). We hoist that query up here so
  // both ENG-097 and the ENG-061/062 consumers share a single tRPC
  // subscription — two separate `useQuery` calls would resolve to the
  // same cache key but generate duplicate background refetches with
  // mismatched `staleTime`. When the active printer ships with
  // `config.autoPrintOnComplete: true`, every successful sale (fresh
  // create OR completeDraft) fires `peripherals.printReceipt` through
  // the same dispatcher the SaleDetailsModal reprint path uses, so
  // the dispatch decision (device_local / site_hub server-side vs.
  // hub_client bridge) stays in one place. Defaults to `false` so
  // existing tenants do not get surprise prints — opt-in is explicit
  // per site at the peripheral config level.
  //
  // Failures fall through the existing fallback chain (system print
  // → browser print window) inside `printSaleReceipt`. We surface a
  // warning toast when the ESC/POS path fails so the cashier knows
  // the receipt landed on a different surface; the operator can
  // diagnose via the hardware_outbox surface in Operations.
  const peripheralsForSiteQuery = trpc.peripherals.activeForSite.useQuery(
    { siteId: currentSite?.id ?? '' },
    { enabled: !!currentSite, staleTime: 5 * 60 * 1000 }
  );
  const autoPrintEnabled = (() => {
    const rows = peripheralsForSiteQuery.data;
    if (!rows) return false;
    const printer = rows.find(row => row.kind === 'printer');
    if (!printer) return false;
    const config = printer.config as Record<string, unknown> | null;
    return config?.autoPrintOnComplete === true;
  })();
  // ENG-097 — auto-print on sale completion. The shell derives
  // `autoPrintEnabled` from the SHARED `peripherals.activeForSite` query
  // (single subscription for scanner + drawer + auto-print) and passes
  // it into the hook; `maybeAutoPrint` fires from the mutation success
  // paths below after the completion toast.
  const maybeAutoPrint = useReceiptAutoPrint({ autoPrintEnabled });

  // ENG-178 slice 10 — the sales + cash-session mutation handles and the
  // shared finish-sale epilogue live in `useSalesMutations`. ALL the
  // state they mutate stays here in the shell; the setters are injected
  // so the dependency direction is shell → hook → shell, never hook ↔
  // hook. The flow handlers below (handleCheckout, handleSuspendConfirm,
  // the cash-session handlers) call the returned mutation handles.
  const {
    createMutation,
    completeDraftMutation,
    suspendMutation,
    resumeMutation,
    discardDraftMutation,
    openCashSessionMutation,
    closeCashSessionMutation,
    recordCashMovementMutation,
  } = useSalesMutations({
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
  });

  const draftSummary = getCartSummary(cartItems);
  const activeSelectedCartItemKey = getActiveCartSelectionKey(cartItems, selectedCartItemKey);
  const hasActiveCashSession = !!activeCashSession;
  const canCharge = !!currentSite && hasActiveCashSession && cartItems.length > 0;

  // ENG-178 slice 16 — the coupled sale-lifecycle flow handlers
  // (checkout, suspend, resume, new/select workspace) live in
  // `useSalesFlows`. The shell still owns ALL the state they read; the
  // read values + setters + the mutation handles are injected so the
  // dependency direction stays shell → hook, never hook ↔ hook.
  const {
    handleCheckout,
    handleOpenSuspendPrompt,
    handleSuspendConfirm,
    handleNewSale,
    handleSelectWorkspace,
    handleResumeFromPanel,
  } = useSalesFlows({
    activeWorkspace,
    cartItems,
    ownerKey,
    draftSummary,
    isSuspending,
    suspendLabelDraft,
    canCharge,
    isResumedCart,
    setSaleError,
    setIsSuspendLabelPromptOpen,
    setSuspendLabelDraft,
    setIsSuspending,
    setIsSuspendedPanelOpen,
    createMutation,
    completeDraftMutation,
    suspendMutation,
    resumeMutation,
    discardDraftMutation,
  });

  // ENG-105b — Checkout preflight. Surfaces actionable blockers above
  // the Cobrar button so the cashier resolves them BEFORE pressing F1
  // instead of bouncing off a server toast mid-checkout. Pre-modal
  // primitives (paymentMethod, selectedCustomer, pendingDiscountAmount)
  // are not yet wired from SalesPage — the hook silently skips those
  // blocker families, leaving the current modal-level fallback toasts
  // in place. Future slices will plumb pre-attach customer / cart-level
  // discount through here.
  // ENG-184 — checkout readiness reminders from the server (fiscal not
  // active, no printer, no payment rail, sync backlog). Loading / errored
  // → no items, so a slow or offline server NEVER blocks the sale
  // (local-first). All warnings; cashiers see the message, only
  // manager/admin get the navigation CTA (setup surfaces are admin-gated).
  const navigate = useNavigate();
  const checkoutReadinessQuery = trpc.setupReadiness.checkout.useQuery(
    { siteId: currentSite?.id ?? '' },
    { enabled: !!currentSite, staleTime: 60_000 }
  );
  const canNavigateToSetup =
    user?.role === 'admin' || user?.role === 'manager';
  const checkoutReadinessItems = useMemo<PreflightItem[]>(() => {
    const items = checkoutReadinessQuery.data?.items;
    if (!items || items.length === 0) return [];
    const preflightId: Record<string, PreflightBlockerId> = {
      fiscal: 'fiscal_not_active',
      receipt_hardware: 'receipt_hardware_missing',
      payment_rail: 'payment_rail_missing',
      sync: 'sync_backlog',
    };
    return items.map(item => {
      const id = preflightId[item.id] ?? 'sync_backlog';
      const href = item.cta
        ? item.cta.tab
          ? `${item.cta.route}?tab=${item.cta.tab}`
          : item.cta.route
        : null;
      return {
        id,
        severity: item.severity,
        messageKey: `preflight.items.${id}.message`,
        recoveryAction:
          href && canNavigateToSetup
            ? {
                labelKey: `preflight.items.${id}.recovery`,
                onClick: () => navigate(href),
              }
            : undefined,
      };
    });
  }, [checkoutReadinessQuery.data, canNavigateToSetup, navigate]);

  const preflight = useCheckoutPreflight({
    cartItems,
    cartSummary: draftSummary,
    cashSession: activeCashSession,
    paymentMethod: null,
    selectedCustomer: null,
    pendingDiscountAmount: 0,
    userRole: user?.role ?? 'cashier',
    isResumedDraft: isResumedCart,
    recovery: {
      onOpenCashSession: () => handleOpenCashSessionModal(),
    },
    serverItems: checkoutReadinessItems,
  });
  const sales = (salesQuery.data?.items ?? []) as Sale[];
  const customers = ((customersQuery.data?.items ?? []) as Customer[]).filter(
    customer => customer.isActive
  );
  const categories = (categoriesQuery.data?.items ?? []) as Category[];
  const providers = ((providersQuery.data?.items ?? []) as Provider[]).filter(
    provider => provider.isActive
  );
  const registerAssignments =
    (registerAssignmentsQuery.data as RegisterAssignment[] | undefined) ?? [];
  const selectedRegisterAssignment =
    registerAssignments.find(assignment => {
      if (activeCashSession) {
        return assignment.registerName === activeCashSession.registerName;
      }

      return false;
    }) ??
    registerAssignments.find(assignment => assignment.id === selectedRegisterAssignmentId) ??
    registerAssignments.find(assignment => !assignment.isOccupied) ??
    registerAssignments[0] ??
    null;
  const hasAvailableRegisterAssignment =
    !!selectedRegisterAssignment && !selectedRegisterAssignment.isOccupied;
  const canOpenCashSession =
    !!currentSite &&
    !hasActiveCashSession &&
    !activeCashSessionQuery.isLoading &&
    !registerAssignmentsQuery.isLoading &&
    hasAvailableRegisterAssignment;
  const canCloseCashSession =
    !!currentSite && hasActiveCashSession && !closeCashSessionMutation.isPending;

  // ENG-018b — resumed carts (serverSaleId set) have server-locked
  // items: the server-side `sales.completeDraft` contract re-finalizes
  // the draft as-is. Any client edit to quantity, discount, add, or
  // remove would be silently discarded at Charge time and the amount
  // collected could diverge from the server total. Guard every edit
  // handler so the "items locked" banner on the UI matches the actual
  // enforcement. If the cashier wants different items, they discard
  // the draft and start a fresh one.
  const handleProductSelect = (selection: Parameters<typeof mergeCartItem>[1]) => {
    if (isResumedCart) return;
    setCartItems(currentItems => mergeCartItem(currentItems, selection));
    setSelectedCartItemKey(getCartItemKey(selection.product.id, selection.unit.unitId));
    setProductSearchQuery('');
    setSaleError(null);
  };

  const handleQuantityChange = (itemKey: string, quantity: number) => {
    if (isResumedCart) return;
    setCartItems(currentItems =>
      currentItems.map(item =>
        item.key === itemKey ? updateCartItem(item, { quantity }) : item
      )
    );
  };

  const handleDiscountChange = (itemKey: string, discount: number) => {
    if (isResumedCart) return;
    setCartItems(currentItems =>
      currentItems.map(item =>
        item.key === itemKey ? updateCartItem(item, { discount }) : item
      )
    );
  };

  const handleRemoveItem = (itemKey: string) => {
    if (isResumedCart) return;
    setCartItems(currentItems => currentItems.filter(item => item.key !== itemKey));
  };

  const handleClearCart = () => {
    if (isResumedCart) return;
    setCartItems([]);
    setSelectedCartItemKey(null);
  };

  // ENG-105d — undo the last cart mutation on the active workspace.
  // Routed by both the Mod+Z shortcut (via `useSalesKeyboardShortcuts`)
  // and the visible "Deshacer" button on the cart toolbar so the
  // toast surface is identical in both paths. Resumed-draft carts
  // are locked (items cannot be edited), and the same lock applies
  // to undo — there is no history to walk anyway, but we short-circuit
  // explicitly to avoid surfacing the "nothing to undo" toast in a
  // state where it could read as a UX bug.
  const handleUndoCart = useCallback(() => {
    if (isResumedCart) return;
    const state = useCartWorkspaceStore.getState();
    const activeId = state.activeId;
    if (!activeId) return;
    const popped = state.undoCart(activeId);
    if (popped) {
      // After an undo the previously-selected row may no longer
      // exist (e.g. the user undid a "remove item" so the row is
      // back, or the user undid an "add item" so the row is gone).
      // Drop the selection — the user can re-select via click or
      // Alt+P/Alt+C/Alt+D. Keeping it pointed at a deleted row
      // makes the keyboard nav surfaces fail silently.
      state.setSelectedItem(activeId, null);
      toast.success({ title: t('sales:undo.cartActionUndone') });
    } else {
      toast.info({ title: t('sales:undo.nothingToUndo') });
    }
  }, [isResumedCart, t, toast]);

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

  const handleCreateCashSession = async (values: CashSessionOpenValues) => {
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

  useSalesKeyboardShortcuts({
    selectedItemKey: activeSelectedCartItemKey,
    canCharge,
    isProductSearchOpen,
    isPaymentModalOpen,
    onOpenSearch: () => handleOpenProductSearch(),
    onOpenPayment: handleOpenPaymentModal,
    onRemoveSelectedItem: handleRemoveItem,
    focusProductInput,
    focusQuantityInput,
    focusDiscountInput,
    canSuspend: canCharge && !isResumedCart,
    onSuspend: handleOpenSuspendPrompt,
    onToggleSuspendedPanel: handleToggleSuspendedPanel,
    canToggleSuspendedPanel:
      suspendedDraftsCount > 0 || isSuspendedPanelOpen,
    onReprintSelectedHistoryRow:
      selectedHistorySaleId !== null
        ? handleReprintSelectedHistoryRow
        : undefined,
    // ENG-105d — Mod+Z routes through the same handler the visible
    // "Deshacer" button uses so the toast surface stays consistent.
    onUndo: handleUndoCart,
    // ENG-105e — F2 routes through handleFastCash. Active both with
    // the modal closed (opens in fast-cash mode) and open (bumps
    // `fastCashTrigger` so the modal re-applies exact cash on top of
    // whatever was typed).
    onFastCash: handleFastCash,
  });

  // ENG-061 — barcode scanner pipeline.
  //
  // ENG-061/062 — `peripheralsForSiteQuery` is declared once near the
  // top of the component (see the ENG-097 auto-print block) so all
  // peripheral consumers (scanner, cash drawer, auto-print) share a
  // single tRPC subscription. The cash-drawer scanner code below
  // reads from that hoisted query.
  //
  // GS1 weight/price-embedded labels override quantity / unitPrice
  // server-side so the cart line reflects the weighed package.

  // ENG-062 — manager-gated cash drawer kick. `useCashDrawerController`
  // owns the kick dispatch + the device_local / site_hub / hub_client
  // routing + the outcome toasts; `hasRegisteredDrawer` is derived here
  // from the shared peripherals query and passed in. `onKickCashDrawer`
  // is undefined (SalesCheckoutPanel hides the button) unless the role
  // can kick and a drawer is registered.
  const hasRegisteredDrawer = !!peripheralsForSiteQuery.data?.find(
    r => r.kind === 'cash_drawer' && r.driver === 'escpos'
  );
  const { onKickCashDrawer, isKickingCashDrawer } = useCashDrawerController({
    hasRegisteredDrawer,
  });
  const scannerConfig: WedgeConfig = (() => {
    const row = peripheralsForSiteQuery.data?.find(
      r => r.kind === 'scanner' && r.driver === 'wedge'
    );
    if (!row) return DEFAULT_WEDGE_CONFIG;
    const cfg = row.config as Partial<WedgeConfig> | null;
    return {
      ...DEFAULT_WEDGE_CONFIG,
      ...(cfg ?? {}),
    };
  })();

  // ENG-061 — barcode scanner pipeline. `useBarcodeProductScanner` owns
  // the lookup + cart-merge + the wedge-listener mount; `scannerConfig`
  // is derived above from the shared peripherals query and passed in, and
  // the modal-open flags gate the listener so a scan never fires while a
  // modal owns the keyboard.
  useBarcodeProductScanner({
    scannerConfig,
    isResumedCart,
    isProductSearchOpen,
    isPaymentModalOpen,
    isCashSessionModalOpen,
    isCashSessionCloseModalOpen,
    isCashSessionMovementModalOpen,
    productInputRef,
    setCartItems,
    setSelectedCartItemKey,
    setProductSearchQuery,
    setSaleError,
  });

  return (
    <>
      <div className="sales-pos-shell space-y-4 pb-24 xl:flex pos:min-h-0 xl:flex-col xl:gap-4 xl:space-y-0 pos:overflow-hidden pos:pb-0">
        {/* ENG-186/189 — el POS es la única superficie de /sales. En el
            breakpoint `pos:` (ancho desktop + >=900px alto), la barra de
            búsqueda y los accesos a Historial / Ventas suspendidas viven en
            una fila de acción de altura fija (shrink-0); el carrito y el
            panel de cobro toman el resto de la altura y hacen scroll por
            dentro, de modo que cobrar no exige scroll de página a 1440x900.
            Por debajo de `pos:` vuelve el scroll natural de página para que
            los controles de caja sean alcanzables.
            `productInputRef` es el objetivo del scanner wedge
            (useBarcodeWedgeListener) y de Alt+P (useScannerFocusRestoration),
            así que permanece montado y visible siempre. */}
        <SalesHeaderSection
          productSearchQuery={productSearchQuery}
          onQueryChange={setProductSearchQuery}
          onSubmitSearch={() => handleOpenProductSearch(productSearchQuery)}
          productInputRef={productInputRef}
          onOpenHistory={() => setIsHistoryDrawerOpen(true)}
          onOpenSuspended={() => setIsSuspendedPanelOpen(true)}
          suspendedDraftsCount={suspendedDraftsCount}
          isResumedCart={isResumedCart}
          activeWorkspace={activeWorkspace ?? null}
        />

        <WorkspaceTabsSection
          ownedWorkspaces={ownedWorkspaces}
          activeWorkspaceId={activeWorkspace?.id}
          onSelectWorkspace={handleSelectWorkspace}
        />

        <section className="grid gap-6 pos:min-h-0 pos:flex-1 xl:grid-cols-[minmax(0,2fr)_minmax(320px,360px)] pos:grid-rows-[minmax(0,1fr)]">
          <SalesCartWorkspace
            items={cartItems}
            selectedItemKey={activeSelectedCartItemKey}
            itemCount={draftSummary.itemCount}
            saleError={saleError}
            onQuantityChange={handleQuantityChange}
            onDiscountChange={handleDiscountChange}
            onRemove={handleRemoveItem}
            onSelectItem={setSelectedCartItemKey}
            onClearCart={handleClearCart}
            quantityInputRefFor={quantityInputRefFor}
            discountInputRefFor={discountInputRefFor}
            canUndo={canUndoActiveCart}
            onUndo={handleUndoCart}
          />

          <SalesCheckoutPanel
            currentSite={currentSite}
            cashSession={activeCashSession}
            registerAssignments={registerAssignments}
            selectedRegisterAssignment={selectedRegisterAssignment}
            isCashSessionLoading={activeCashSessionQuery.isLoading}
            draftSummary={draftSummary}
            canCharge={canCharge}
            canOpenCashSession={canOpenCashSession}
            canCloseCashSession={canCloseCashSession}
            onOpenSearch={() => handleOpenProductSearch()}
            onCharge={handleOpenPaymentModal}
            onOpenCashSession={handleOpenCashSessionModal}
            onCloseCashSession={handleOpenCloseCashSessionModal}
            onOpenMovement={handleOpenCashSessionMovementModal}
            onKickCashDrawer={onKickCashDrawer}
            isKickingCashDrawer={isKickingCashDrawer}
            onRegisterAssignmentChange={setSelectedRegisterAssignmentId}
            canSuspend={canCharge && !isResumedCart}
            onSuspend={handleOpenSuspendPrompt}
            onNewSale={handleNewSale}
            suspendedDraftsCount={suspendedDraftsCount}
            onToggleSuspendedPanel={handleToggleSuspendedPanel}
            hubReachable={hubReachable}
            preflightItems={preflight.items}
          />
        </section>
      </div>

      <SalesMobileCheckoutBar
        draftSummary={draftSummary}
        cashSession={activeCashSession}
        canCharge={canCharge}
        canOpenCashSession={canOpenCashSession}
        canCloseCashSession={canCloseCashSession}
        onOpenSearch={() => handleOpenProductSearch()}
        onCharge={handleOpenPaymentModal}
        onOpenCashSession={handleOpenCashSessionModal}
        onCloseCashSession={handleOpenCloseCashSessionModal}
        canSuspend={canCharge && !isResumedCart}
        onSuspend={handleOpenSuspendPrompt}
        onNewSale={handleNewSale}
        suspendedDraftsCount={suspendedDraftsCount}
        onToggleSuspendedPanel={handleToggleSuspendedPanel}
        hubReachable={hubReachable}
      />

      {/* ENG-186 — Historial detrás de un cajón lateral. El header del
          Drawer aporta el botón de cerrar; la tabla conserva su propio
          título, por eso el Drawer va sin `title` (solo `ariaLabel`).
          `restoreFocusTo` devuelve el foco a la barra de búsqueda al cerrar
          para mantener el flujo de cajero (ENG-105f). */}
      <Drawer
        isOpen={isHistoryDrawerOpen}
        onClose={() => setIsHistoryDrawerOpen(false)}
        ariaLabel={t('view.history')}
        size="lg"
        contentClassName="p-0"
        restoreFocusTo={() => productInputRef.current}
        testId="sales-history-drawer"
      >
        <SalesHistoryTable
          sales={sales}
          isLoading={salesQuery.isLoading}
          error={salesQuery.error?.message ?? null}
          onRetry={() => {
            void salesQuery.refetch();
          }}
          onView={setSelectedSaleId}
          selectedSaleId={selectedHistorySaleId}
          onSelectedSaleIdChange={setSelectedHistorySaleId}
        />
      </Drawer>

      {/* ENG-186 — Ventas suspendidas detrás de un cajón lateral. El panel
          trae su propio header (título + cerrar), así que el Drawer va sin
          chrome (`showCloseButton={false}`, sin `title`). Ctrl+R sigue
          abriéndolo vía `handleToggleSuspendedPanel`. */}
      <Drawer
        isOpen={isSuspendedPanelOpen}
        onClose={() => setIsSuspendedPanelOpen(false)}
        ariaLabel={t('park.panelTitle')}
        showCloseButton={false}
        size="lg"
        contentClassName="p-0"
        restoreFocusTo={() => productInputRef.current}
        testId="sales-suspended-drawer"
      >
        <SuspendedSalesPanel
          isOpen={isSuspendedPanelOpen}
          onClose={() => setIsSuspendedPanelOpen(false)}
          onResume={handleResumeFromPanel}
        />
      </Drawer>

      <SalesModals
        isProductSearchOpen={isProductSearchOpen}
        productSearchDialogKey={productSearchDialogKey}
        onCloseProductSearch={() => setIsProductSearchOpen(false)}
        onSelectProduct={handleProductSelect}
        categories={categories}
        providers={providers}
        productSearchInitialQuery={productSearchInitialQuery}
        setCartItems={setCartItems}
        isPaymentModalOpen={isPaymentModalOpen}
        paymentModalKey={paymentModalKey}
        paymentTotal={draftSummary.total}
        customers={customers}
        isPaymentSaving={createMutation.isPending || completeDraftMutation.isPending}
        saleError={saleError}
        serviceChargeRate={serviceChargeRate}
        fastCashTrigger={fastCashTrigger}
        onClosePayment={() => {
          setIsPaymentModalOpen(false);
          setFastCashTrigger(0);
        }}
        onSubmitPayment={handleCheckout}
        selectedSaleId={selectedSaleId}
        onCloseSaleDetails={() => setSelectedSaleId(null)}
        isSuspendLabelPromptOpen={isSuspendLabelPromptOpen}
        isSuspending={isSuspending}
        suspendLabelDraft={suspendLabelDraft}
        onChangeSuspendLabel={setSuspendLabelDraft}
        onCloseSuspendPrompt={() => {
          if (isSuspending) return;
          setIsSuspendLabelPromptOpen(false);
        }}
        onConfirmSuspend={() => {
          void handleSuspendConfirm();
        }}
      />

      <CashSessionModals
        isCashSessionModalOpen={isCashSessionModalOpen}
        cashSessionModalKey={cashSessionModalKey}
        isOpeningCashSession={openCashSessionMutation.isPending}
        cashSessionError={cashSessionError}
        selectedRegisterAssignment={selectedRegisterAssignment}
        onCloseOpenModal={() => setIsCashSessionModalOpen(false)}
        onSubmitOpen={handleCreateCashSession}
        isCashSessionCloseModalOpen={isCashSessionCloseModalOpen}
        cashSessionCloseModalKey={cashSessionCloseModalKey}
        activeCashSession={activeCashSession}
        isClosingCashSession={closeCashSessionMutation.isPending}
        cashSessionCloseError={cashSessionCloseError}
        onCloseCloseModal={() => setIsCashSessionCloseModalOpen(false)}
        onSubmitClose={handleCloseCashSession}
        suspendedDraftsCount={suspendedDraftsCount}
        isCashSessionMovementModalOpen={isCashSessionMovementModalOpen}
        cashSessionMovementModalKey={cashSessionMovementModalKey}
        isRecordingMovement={recordCashMovementMutation.isPending}
        cashSessionMovementError={cashSessionMovementError}
        onCloseMovementModal={() => setIsCashSessionMovementModalOpen(false)}
        onSubmitMovement={handleRecordCashMovement}
      />
    </>
  );
}
