import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ProductSearchDialog } from '@/components/dialogs/ProductSearchDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useAuth } from '@/features/auth/AuthProvider';
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
import { SalesCartWorkspace } from '@/features/sales/SalesCartWorkspace';
import { SalesCheckoutPanel } from '@/features/sales/SalesCheckoutPanel';
import { SaleDetailsModal } from '@/features/sales/SaleDetailsModal';
import { SalesHistoryTable } from '@/features/sales/SalesHistoryTable';
import { SalesMobileCheckoutBar } from '@/features/sales/SalesMobileCheckoutBar';
import { SalesOverview } from '@/features/sales/SalesOverview';
import { SuspendedSalesPanel } from '@/features/sales/SuspendedSalesPanel';
import {
  SalePaymentModal,
  type SalePaymentValues,
} from '@/features/sales/SalePaymentModal';
import {
  getCartItemKey,
  getCartSummary,
  mergeCartItem,
  updateCartItem,
  type SaleCartItem,
} from '@/features/sales/saleCart';
import { getCheckoutPaymentState } from '@/features/sales/checkoutPayment';
import { getActiveCartSelectionKey } from '@/features/sales/salesKeyboard';
import { useSalesInputFocus } from '@/features/sales/useSalesInputFocus';
import { useSalesKeyboardShortcuts } from '@/features/sales/useSalesKeyboardShortcuts';
import {
  selectActiveWorkspace,
  useCartWorkspaceStore,
} from '@/features/sales/useCartWorkspaceStore';
import { useTenant } from '@/features/tenant/TenantProvider';
import { invalidateGroups } from '@/lib/invalidateGroups';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';
import type {
  CashMovement,
  CashSession,
  CashSessionReport,
  Category,
  Customer,
  Provider,
  RegisterAssignment,
  Sale,
} from '@/types';

export function SalesPage() {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const utils = trpc.useUtils();
  const toast = useToast();
  const { currentTenant, currentSite } = useTenant();
  const { user } = useAuth();

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
  const updateCartAction = useCartWorkspaceStore(state => state.updateCart);
  const setSelectedItemAction = useCartWorkspaceStore(
    state => state.setSelectedItem
  );

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
  // Silence unused-binding warnings for refs that Commit 2 consumers
  // (Suspend button, resumed-cart banner) will wire into the UI. The
  // store actions we only invoke via the `setCartItems` wrappers are
  // named here so the API surface stays greppable.
  void updateCartAction;
  void setSelectedItemAction;
  void isResumedCart;
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
  const salesQuery = trpc.sales.list.useQuery({ page: 1, perPage: 50 });
  const summaryQuery = trpc.sales.summary.useQuery();
  const customersQuery = trpc.customers.list.useQuery({ page: 1, perPage: 100, isActive: true });
  const categoriesQuery = trpc.categories.tree.useQuery();
  const providersQuery = trpc.providers.list.useQuery({ page: 1, perPage: 100 });
  const activeCashSessionQuery = trpc.cashSessions.getActive.useQuery(
    { siteId: currentSite?.id },
    {
      enabled: !!currentSite,
    }
  );
  const activeCashSession = (activeCashSessionQuery.data as CashSession | null | undefined) ?? null;
  const cashMovementsQuery = trpc.cashSessions.movements.useQuery(
    {
      sessionId: activeCashSession?.id,
      limit: 8,
    },
    {
      enabled: !!activeCashSession?.id,
    }
  );
  const cashSessionReportQuery = trpc.cashSessions.report.useQuery(
    { limit: 6 },
    {
      enabled: !!currentSite,
    }
  );
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

  // Shared epilogue for both "finish a sale" paths: sales.create for a
  // fresh cart, and sales.completeDraft for a resumed draft. Both need
  // to invalidate the same query set and both want the workspace to
  // reset to a fresh blank draft.
  const finishSaleEpilogue = useCallback(
    async (itemCount: number) => {
      await invalidateGroups(utils, [
        u => u.cashSessions.getActive,
        u => u.cashSessions.movements,
        u => u.cashSessions.report,
        u => u.cashSessions.registerAssignments,
        u => u.sales.list,
        u => u.sales.listDrafts,
        u => u.sales.summary,
        u => u.inventory.listMovements,
        u => u.inventory.listStock,
        u => u.products.list,
        u => u.products.search,
      ]);
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
      toast.success({
        title: t('toast.success'),
        description: `${itemCount} ${t('toast.successDetail')}`,
      });
    },
    [ownerKey, t, toast, utils, setIsPaymentModalOpen]
  );

  const createMutation = trpc.sales.create.useMutation({
    onSuccess: async (_data, variables) => {
      // Drafts created via the Suspend orchestration skip the epilogue
      // — `handleSuspendConfirm` handles invalidation + workspace
      // reset + the localized "Sale suspended" toast itself so the
      // operator never sees the "Sale completed" message on a
      // still-in-flight suspend.
      if (variables.status !== 'completed') {
        return;
      }
      await finishSaleEpilogue(variables.items.length);
    },
    onError: onErrorToast(toast, t),
  });

  // ENG-018c — completing a resumed draft. `items` is locked server
  // side so we do not send it; the cashier can only add payments /
  // notes at this point.
  const completeDraftMutation = trpc.sales.completeDraft.useMutation({
    onSuccess: async result => {
      await finishSaleEpilogue(result.items.length);
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
  const suspendMutation = trpc.sales.suspend.useMutation();
  const resumeMutation = trpc.sales.resume.useMutation();
  // ENG-018b — used both by the SuspendedSalesPanel (which has its own
  // internal mutation) AND by the orphan-cleanup path inside
  // `handleSuspendConfirm` below. Keeping a page-level handle lets us
  // compensate if `sales.suspend` throws after `sales.create(draft)`
  // already created + stock-debited the row.
  const discardDraftMutation = trpc.sales.discardDraft.useMutation();
  const openCashSessionMutation = trpc.cashSessions.open.useMutation({
    onSuccess: async cashSession => {
      await invalidateGroups(utils, [
        u => u.cashSessions.getActive,
        u => u.cashSessions.report,
        u => u.cashSessions.registerAssignments,
      ]);
      setCashSessionError(null);
      setIsCashSessionModalOpen(false);
      toast.success({
        title: t('cashSession.toast.openSuccessTitle'),
        description: t('cashSession.toast.openSuccessDescription', {
          registerName: cashSession.registerName,
          amount: formatCurrency(cashSession.openingFloat),
        }),
      });
    },
    onError: onErrorToast(toast, t, {
      extra: description => setCashSessionError(description),
    }),
  });
  const closeCashSessionMutation = trpc.cashSessions.close.useMutation({
    onSuccess: async cashSession => {
      await invalidateGroups(utils, [
        u => u.cashSessions.getActive,
        u => u.cashSessions.report,
        u => u.cashSessions.registerAssignments,
      ]);
      setCashSessionCloseError(null);
      setIsCashSessionCloseModalOpen(false);

      const overShort = cashSession.overShort ?? 0;
      const absoluteOverShort = formatCurrency(Math.abs(overShort));
      const description =
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

      toast.success({
        title: t('cashSession.toast.closeSuccessTitle'),
        description,
      });
    },
    onError: onErrorToast(toast, t, {
      extra: description => setCashSessionCloseError(description),
    }),
  });
  const recordCashMovementMutation = trpc.cashSessions.recordMovement.useMutation({
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

  const summary = summaryQuery.data;
  const draftSummary = getCartSummary(cartItems);
  const activeSelectedCartItemKey = getActiveCartSelectionKey(cartItems, selectedCartItemKey);
  const hasActiveCashSession = !!activeCashSession;
  const canCharge = !!currentSite && hasActiveCashSession && cartItems.length > 0;
  const sales = (salesQuery.data?.items ?? []) as Sale[];
  const customers = ((customersQuery.data?.items ?? []) as Customer[]).filter(
    customer => customer.isActive
  );
  const categories = (categoriesQuery.data?.items ?? []) as Category[];
  const providers = ((providersQuery.data?.items ?? []) as Provider[]).filter(
    provider => provider.isActive
  );
  const cashMovements = activeCashSession ? ((cashMovementsQuery.data ?? []) as CashMovement[]) : [];
  const cashSessionReport = (cashSessionReportQuery.data as CashSessionReport | undefined) ?? null;
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

  const handleOpenProductSearch = (initialQuery = productSearchQuery) => {
    setProductSearchInitialQuery(initialQuery.trim());
    setProductSearchDialogKey(current => current + 1);
    setIsProductSearchOpen(true);
  };

  const handleOpenPaymentModal = () => {
    if (!currentSite || cartItems.length === 0) {
      return;
    }

    if (!hasActiveCashSession) {
      handleOpenCashSessionModal();
      return;
    }

    setSaleError(null);
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

  const handleCheckout = async (values: SalePaymentValues) => {
    try {
      const payment = getCheckoutPaymentState(values, draftSummary.total);
      // ENG-018c — resumed carts complete via `sales.completeDraft` so
      // we do not re-send items (locked at create-time) and do not
      // double-debit stock. Fresh carts continue on the classic
      // `sales.create` path.
      if (activeWorkspace?.serverSaleId) {
        await completeDraftMutation.mutateAsync({
          saleId: activeWorkspace.serverSaleId,
          paymentMethod: payment.paymentMethod,
          paymentStatus: payment.paymentStatus,
          amountReceived: payment.amountReceived,
          notes: values.notes || undefined,
          payments: payment.payments,
        });
        return;
      }

      await createMutation.mutateAsync({
        customerId: values.customerId || undefined,
        items: cartItems.map(item => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
        })),
        paymentMethod: payment.paymentMethod,
        paymentStatus: payment.paymentStatus,
        status: 'completed',
        amountReceived: payment.amountReceived,
        discountAmount: 0,
        notes: values.notes || undefined,
        // Phase 2 Tier-2 step 5 — split-tender list, or undefined on the
        // legacy single-tender path. Shape is owned by `getCheckoutPaymentState`
        // so the "is-this-a-split?" decision lives in exactly one place.
        payments: payment.payments,
      });
    } catch (error) {
      setSaleError(translateServerError(error, t, t('errors:server.unknown')));
    }
  };

  // ENG-018b — multi-cart orchestration.
  const handleOpenSuspendPrompt = () => {
    if (!canCharge || isResumedCart) {
      return;
    }
    setSuspendLabelDraft('');
    setIsSuspendLabelPromptOpen(true);
  };

  const handleSuspendConfirm = async () => {
    if (isSuspending) {
      return;
    }
    if (cartItems.length === 0 || !ownerKey) {
      setIsSuspendLabelPromptOpen(false);
      return;
    }
    setIsSuspending(true);
    // Track the draft id across the two-step orchestration so we can
    // compensate if step 2 fails: the server already created the row
    // + debited stock in step 1, and a lingering orphan draft
    // (status='draft', suspendedAt=null) would never surface in
    // `sales.listDrafts` (which filters `suspended_at IS NOT NULL`).
    let pendingDraftId: string | null = null;
    try {
      const draft = await createMutation.mutateAsync({
        items: cartItems.map(item => ({
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
        })),
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
      });
      pendingDraftId = draft.id;
      // `status !== 'completed'` short-circuits the create epilogue so
      // we now own the workspace reset + invalidations + toast.
      const label = suspendLabelDraft.trim();
      await suspendMutation.mutateAsync({
        saleId: draft.id,
        label: label.length > 0 ? label : undefined,
      });
      // Success — clear the tracker so the catch block does not try to
      // discard an already-suspended draft.
      pendingDraftId = null;
      await invalidateGroups(utils, [
        u => u.sales.list,
        u => u.sales.listDrafts,
        u => u.sales.summary,
        u => u.inventory.listStock,
        u => u.products.list,
        u => u.products.search,
      ]);
      const storeState = useCartWorkspaceStore.getState();
      if (storeState.activeId) {
        storeState.removeWorkspace(storeState.activeId);
      }
      if (ownerKey) {
        storeState.createDraft(ownerKey);
      }
      setIsSuspendLabelPromptOpen(false);
      setSuspendLabelDraft('');
      toast.success({ title: t('park.toastSuspendTitle') });
    } catch (error) {
      toast.error({
        title: t('park.toastErrorTitle'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
      // Compensate: step 1 succeeded (stock already debited) but
      // step 2 threw. Discard the orphan so ENG-018c's reversal
      // loop returns the items to stock — otherwise the cashier
      // would permanently leak inventory with no UI path to
      // recover (listDrafts filters out non-suspended drafts).
      if (pendingDraftId) {
        try {
          await discardDraftMutation.mutateAsync({
            saleId: pendingDraftId,
          });
          await invalidateGroups(utils, [
            u => u.inventory.listStock,
            u => u.products.list,
            u => u.products.search,
          ]);
        } catch {
          // Best-effort: the original error is the one the
          // cashier needs to see. Swallowing a second failure
          // here avoids layering a cleanup-failed toast on top.
        }
      }
    } finally {
      setIsSuspending(false);
    }
  };

  const handleNewSale = () => {
    if (!ownerKey) {
      return;
    }
    // Spawn a fresh blank workspace and set it active. The previous
    // cart stays in the store so the cashier can switch back to it
    // later; if they want it on the server they hit Suspend instead.
    useCartWorkspaceStore.getState().createDraft(ownerKey);
  };

  const handleSelectWorkspace = (workspaceId: string) => {
    useCartWorkspaceStore.getState().setActive(workspaceId);
  };

  const handleToggleSuspendedPanel = () => {
    setIsSuspendedPanelOpen(open => !open);
  };

  const handleResumeFromPanel = async (draft: { id: string }) => {
    try {
      const resumed = await resumeMutation.mutateAsync({ saleId: draft.id });
      if (!ownerKey) {
        return;
      }
      const label = resumed.suspendedLabel ?? null;
      // Map the server-side items back into `SaleCartItem` shape so
      // the existing cart components keep rendering them unchanged.
      const items: SaleCartItem[] = (resumed.items ?? []).map(row => ({
        key: getCartItemKey(row.productId, row.unitId ?? ''),
        productId: row.productId,
        productName: row.productName ?? row.productId,
        productSku: row.productSku ?? '',
        unitId: row.unitId ?? '',
        unitName:
          row.unitName ?? row.unitAbbreviation ?? row.unitId ?? '',
        unitEquivalence: row.unitEquivalence ?? 1,
        quantity: row.quantity,
        unitPrice: row.unitPrice,
        discount: row.discount,
        taxRate: row.taxRate,
        availableStock: Number.POSITIVE_INFINITY,
        sellByFraction: false,
        fractionStep: null,
        fractionMinimum: null,
      }));
      useCartWorkspaceStore.getState().hydrateFromResumed({
        ownerKey,
        serverSaleId: resumed.id,
        serverSaleNumber: resumed.saleNumber,
        label,
        items,
      });
      setIsSuspendedPanelOpen(false);
      toast.success({ title: t('park.toastResumeTitle') });
    } catch (error) {
      toast.error({
        title: t('park.toastErrorTitle'),
        description: translateServerError(error, t, t('errors:server.unknown')),
      });
    }
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
  });

  return (
    <>
      <div className="space-y-6 pb-24 xl:pb-0">
        <SalesOverview
          currentSiteName={currentSite?.name ?? null}
          isSummaryLoading={summaryQuery.isLoading}
          todaySalesTotal={summary?.todaySalesTotal ?? 0}
          transactionCount={summary?.transactionCount ?? 0}
          averageOrder={summary?.averageOrder ?? 0}
          draftTotal={draftSummary.total}
          canCharge={canCharge}
          canOpenCashSession={canOpenCashSession}
          canCloseCashSession={canCloseCashSession}
          cashSession={activeCashSession}
          registerAssignments={registerAssignments}
          selectedRegisterAssignment={selectedRegisterAssignment}
          isCashSessionLoading={activeCashSessionQuery.isLoading}
          cashMovements={cashMovements}
          isCashMovementsLoading={cashMovementsQuery.isLoading}
          cashSessionReport={cashSessionReport}
          isCashSessionReportLoading={cashSessionReportQuery.isLoading}
          productSearchQuery={productSearchQuery}
          onProductSearchQueryChange={setProductSearchQuery}
          onOpenSearch={() => handleOpenProductSearch(productSearchQuery)}
          onCharge={handleOpenPaymentModal}
          onOpenCashSession={handleOpenCashSessionModal}
          onCloseCashSession={handleOpenCloseCashSessionModal}
          onOpenMovement={handleOpenCashSessionMovementModal}
          onRegisterAssignmentChange={setSelectedRegisterAssignmentId}
          productInputRef={productInputRef}
        />

        {isResumedCart && activeWorkspace?.serverSaleNumber && (
          <div
            className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-900"
            role="status"
            data-testid="resumed-cart-banner"
          >
            <p className="font-semibold">
              {activeWorkspace.label
                ? t('park.resumedBannerWithLabel', {
                    saleNumber: activeWorkspace.serverSaleNumber,
                    label: activeWorkspace.label,
                  })
                : t('park.resumedBanner', {
                    saleNumber: activeWorkspace.serverSaleNumber,
                  })}
            </p>
            <p className="mt-1 text-xs text-primary-800/80">
              {t('park.resumedBannerHint')}
            </p>
          </div>
        )}

        {ownedWorkspaces.length > 1 && (
          <section
            className="rounded-2xl border border-line/80 bg-surface px-4 py-3 shadow-sm"
            aria-label={t('park.localWorkspacesTitle')}
            data-testid="cart-workspace-switcher"
          >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-secondary-950">
                  {t('park.localWorkspacesTitle')}
                </p>
                <p className="text-xs text-secondary-500">
                  {t('park.localWorkspacesDescription')}
                </p>
              </div>
            </div>
            <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {ownedWorkspaces.map((workspace, index) => {
                const workspaceSummary = getCartSummary(workspace.items);
                const fallbackLabel = t('park.localWorkspaceFallback', {
                  index: ownedWorkspaces.length - index,
                });
                const label =
                  workspace.label ??
                  (workspace.serverSaleNumber
                    ? t('park.localWorkspaceServerDraft', {
                        saleNumber: workspace.serverSaleNumber,
                      })
                    : fallbackLabel);
                const isActive = workspace.id === activeWorkspace?.id;

                return (
                  <button
                    key={workspace.id}
                    type="button"
                    className={
                      isActive
                        ? 'rounded-2xl border border-primary-300 bg-primary-50 px-3 py-2 text-left text-sm text-primary-900'
                        : 'rounded-2xl border border-line bg-white px-3 py-2 text-left text-sm text-secondary-700 hover:border-primary-200 hover:bg-primary-50/60'
                    }
                    onClick={() => handleSelectWorkspace(workspace.id)}
                    aria-pressed={isActive}
                    aria-label={t('park.localWorkspaceSelect', { label })}
                    data-testid="cart-workspace-switcher-item"
                  >
                    <span className="block whitespace-nowrap font-semibold">
                      {label}
                    </span>
                    <span className="mt-1 block whitespace-nowrap text-xs opacity-75">
                      {t('park.items', { count: workspaceSummary.itemCount })} ·{' '}
                      {formatCurrency(workspaceSummary.total)}
                    </span>
                    {isActive && (
                      <span className="mt-1 inline-flex rounded-full bg-primary-100 px-2 py-0.5 text-[0.65rem] font-semibold text-primary-700">
                        {t('park.localWorkspaceActive')}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {isSuspendedPanelOpen && (
          <SuspendedSalesPanel
            isOpen={isSuspendedPanelOpen}
            onClose={() => setIsSuspendedPanelOpen(false)}
            onResume={handleResumeFromPanel}
          />
        )}

        <section className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(320px,360px)]">
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
            onRegisterAssignmentChange={setSelectedRegisterAssignmentId}
            canSuspend={canCharge && !isResumedCart}
            onSuspend={handleOpenSuspendPrompt}
            onNewSale={handleNewSale}
            suspendedDraftsCount={suspendedDraftsCount}
            onToggleSuspendedPanel={handleToggleSuspendedPanel}
          />
        </section>

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
      />
      {isProductSearchOpen && (
        <ProductSearchDialog
          key={productSearchDialogKey}
          isOpen={isProductSearchOpen}
          onClose={() => setIsProductSearchOpen(false)}
          onSelect={handleProductSelect}
          categories={categories}
          providers={providers}
          initialQuery={productSearchInitialQuery}
          title={t('checkout.addProduct')}
          confirmLabel={t('checkout.addToCart')}
        />
      )}

      {isPaymentModalOpen && (
        <SalePaymentModal
          key={paymentModalKey}
          isOpen={isPaymentModalOpen}
          total={draftSummary.total}
          customers={customers}
          isSaving={createMutation.isPending || completeDraftMutation.isPending}
          error={saleError}
          onClose={() => setIsPaymentModalOpen(false)}
          onSubmit={handleCheckout}
        />
      )}

      {isCashSessionModalOpen && (
        <CashSessionOpenModal
          key={`${cashSessionModalKey}-${selectedRegisterAssignment?.id ?? 'none'}`}
          isOpen={isCashSessionModalOpen}
          isSaving={openCashSessionMutation.isPending}
          error={cashSessionError}
          defaultRegisterAssignment={selectedRegisterAssignment}
          onClose={() => setIsCashSessionModalOpen(false)}
          onSubmit={handleCreateCashSession}
        />
      )}
      {isCashSessionCloseModalOpen && (
        <CashSessionCloseModal
          key={cashSessionCloseModalKey}
          cashSession={activeCashSession}
          isOpen={isCashSessionCloseModalOpen}
          isSaving={closeCashSessionMutation.isPending}
          error={cashSessionCloseError}
          onClose={() => setIsCashSessionCloseModalOpen(false)}
          onSubmit={handleCloseCashSession}
          suspendedDraftsCount={suspendedDraftsCount}
        />
      )}
      {isCashSessionMovementModalOpen && (
        <CashSessionMovementModal
          key={cashSessionMovementModalKey}
          isOpen={isCashSessionMovementModalOpen}
          isSaving={recordCashMovementMutation.isPending}
          error={cashSessionMovementError}
          onClose={() => setIsCashSessionMovementModalOpen(false)}
          onSubmit={handleRecordCashMovement}
        />
      )}

      {selectedSaleId && (
        <SaleDetailsModal
          saleId={selectedSaleId}
          isOpen={!!selectedSaleId}
          onClose={() => setSelectedSaleId(null)}
        />
      )}

      {isSuspendLabelPromptOpen && (
        <Modal
          isOpen={isSuspendLabelPromptOpen}
          onClose={() => {
            if (isSuspending) return;
            setIsSuspendLabelPromptOpen(false);
          }}
          title={t('park.labelPromptTitle')}
          size="sm"
          footer={
            <>
              <ModalButton
                onClick={() => {
                  if (isSuspending) return;
                  setIsSuspendLabelPromptOpen(false);
                }}
                disabled={isSuspending}
              >
                {t('common:actions.cancel')}
              </ModalButton>
              <ModalButton
                variant="primary"
                onClick={() => {
                  void handleSuspendConfirm();
                }}
                disabled={isSuspending}
              >
                {isSuspending ? `${t('park.labelPromptConfirm')}…` : t('park.labelPromptConfirm')}
              </ModalButton>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-secondary-600">
              {t('park.labelPromptDescription')}
            </p>
            <input
              type="text"
              value={suspendLabelDraft}
              onChange={event => setSuspendLabelDraft(event.target.value)}
              placeholder={t('park.labelPlaceholder')}
              maxLength={80}
              className="block w-full rounded-md border border-secondary-300 bg-white px-3 py-2 text-sm"
              autoFocus
              disabled={isSuspending}
              data-testid="suspend-label-input"
            />
          </div>
        </Modal>
      )}
    </>
  );
}
