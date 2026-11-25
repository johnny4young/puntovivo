import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCashDrawerController } from '@/features/sales/useCashDrawerController';
import { useBarcodeProductScanner } from '@/features/sales/useBarcodeProductScanner';
import { useSalesMutations } from '@/features/sales/useSalesMutations';
import { useSalesFlows } from '@/features/sales/useSalesFlows';
import { useSalesCart } from '@/features/sales/useSalesCart';
import { useSalesModals } from '@/features/sales/useSalesModals';
import { useSalesCommandBar } from '@/features/sales/useSalesCommandBar';
import { useWeighedItem } from '@/features/sales/useWeighedItem';
import { resolveRegisterAddQuantity } from '@/features/sales/saleCart';
import { useSalesPageData } from '@/features/sales/useSalesPageData';
import { useLastRead } from '@/features/sales/useLastRead';
import type { InitialTender } from '@/features/sales/salePaymentModal.types';
import { SalesScreen } from '@/features/sales/SalesScreen';
import { useQuickCreateStore } from '@/features/sales/useQuickCreateStore';
import { useHubReachability } from '@/hooks/useHubReachability';
import { areSerialSelectionsComplete } from '@/features/sales/saleCartTotals';
import { useSaleCartSummary } from './useSaleCartSummary';
import { getCartDiscountAmount } from '@/features/sales/saleApprovalPricing';
import { useSalesInputFocus } from '@/features/sales/useSalesInputFocus';
import { useScannerFocusRestoration } from '@/features/sales/useScannerFocusRestoration';
import { useSalesKeyboardShortcuts } from '@/features/sales/useSalesKeyboardShortcuts';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { useIsModuleActive } from '@/features/modules';
import { useRegisterZone } from '@/features/modules/useRegisterZone';
import { useCustomerDisplayPublisher } from '@/features/surfaces/useCustomerDisplayPublisher';
import { useCheckoutTransferDisplay } from '@/features/sales/checkoutTransferDisplay';
import { openCustomerDisplayWindow } from '@/features/surfaces/openCustomerDisplayWindow';
import { getOrCreateCustomerDisplayAccessId } from '@/features/surfaces/customerDisplayProjection';
import { useToast } from '@/components/feedback/ToastProvider';
import { isTaskActivationKey, useTaskMeasurementController } from '@/lib/taskMeasurement';
import { readExternalSaleEntry } from './externalSaleEntry';
import { readRestaurantChargeEntry } from './restaurantChargeEntry';
import { useTranslation } from 'react-i18next';
import type { CompletedSaleSummary } from './SaleCompleteStrip';
import { useEmbeddedServerState } from '@/hooks/useEmbeddedServerState';
import { getSalesDockGates } from './salesDockGates';
import { useShiftHandoff } from './handoff/useShiftHandoff';
import { useSaleDelivery } from './useSaleDelivery';

const LazyCashDrawerApprovalModal = lazy(() =>
  import('@/features/sales/CashDrawerApprovalModal').then(module => ({
    default: module.CashDrawerApprovalModal,
  }))
);

export function SalesPage() {
  const { t } = useTranslation('sales');
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const externalSale = readExternalSaleEntry(location.state);
  const priceIncludesTax = usePriceIncludesTax();
  const { currentTenant, currentSite, tenantSettings } = useTenant();
  const { currency } = useResolvedLocale();
  const customerDisplayEnabled = useIsModuleActive('customer-display');
  const parksAtCounter = useRegisterZone('promos-parked');
  const seatsTables = useRegisterZone('tables');
  // Seating a ticket at a table goes through the park prompt, so tables park too.
  const parksSales = parksAtCounter || seatsTables;
  const sellsOnCredit = useRegisterZone('credit');
  // restaurant service-charge rate flows from the tenant
  // setting into `SalePaymentModal`. 0 means disabled (default for
  // retail tenants); positive values auto-apply on every checkout.
  const serviceChargeRate = tenantSettings?.restaurant?.serviceChargeRate ?? 0;
  const cashRoundingStep = tenantSettings?.cashClose?.cashRoundingStep ?? null;
  const { user } = useAuth();
  const shouldRenderQuickCreateProductGate = useQuickCreateStore(
    state => state.requestedCreateProduct !== null
  );
  const shouldRenderQuickCreateCustomerGate = useQuickCreateStore(
    state => state.requestedCreateCustomer !== null
  );
  // `useHubReachability` is a no-op outside `hub_client`
  // mode. In hub_client mode, `reachable === false` flips the
  // checkout primary action to disabled via the panel's gate prop.
  // `null` (initial state before the first poll) and `true` both
  // pass through as "reachable enough"; only an explicit `false`
  // gates.
  const hubReachability = useHubReachability();
  const userRole = user?.role ?? 'cashier';
  const saleMeasurement = useTaskMeasurementController();

  useEffect(() => {
    saleMeasurement.ensure('complete_sale');
  }, [saleMeasurement]);

  // `ownerKey` (`${tenantId}:${userId}`) identifies the
  // signed-in cashier. It is injected into the cart, mutation, and flow
  // hooks so each scopes its workspace / drafts to the current operator.
  const ownerKey = currentTenant && user ? `${currentTenant.id}:${user.id}` : null;

  // slice 16b-1 — these UI / modal `useState` declarations STAY in
  // the shell because `useSalesMutations` injects their setters (it is wired
  // before `useSalesModals`) and several are read by more than one hook.
  // el POS es ahora la única superficie de /sales; el historial y
  // las ventas suspendidas viven detrás de cajones laterales (Drawer).
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [isIncidentSheetOpen, setIsIncidentSheetOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  // multi-cart workspace UX state. The label-prompt modal
  // captures an optional "Mesa 5" annotation before the Suspend server
  // orchestration runs; the suspended panel is toggled by Ctrl+R or
  // operator clicks.
  // The external-order link enters this page afresh. Initialize its read UI before
  // paint; clearing browser history below must not reset that local choice.
  const [isSuspendedPanelOpen, setIsSuspendedPanelOpen] = useState(
    () => externalSale?.draft === true
  );
  const [isSuspendLabelPromptOpen, setIsSuspendLabelPromptOpen] = useState(false);
  const [suspendLabelDraft, setSuspendLabelDraft] = useState('');
  const [isSuspending, setIsSuspending] = useState(false);
  const [selectedHistorySaleId, setSelectedHistorySaleId] = useState<string | null>(null);
  // Outlives the completion strip so the receipt stays one touch away.
  const [lastSale, setLastSale] = useState<CompletedSaleSummary | null>(null);
  // How each open ticket pays, chosen before the charge drawer opens.
  const [ticketTenders, setTicketTenders] = useState<Record<string, InitialTender>>({});
  const [completedSale, setCompletedSale] = useState<CompletedSaleSummary | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isCashSessionModalOpen, setIsCashSessionModalOpen] = useState(false);
  const [isCashSessionCloseModalOpen, setIsCashSessionCloseModalOpen] = useState(false);
  const [isCashSessionMovementModalOpen, setIsCashSessionMovementModalOpen] = useState(false);
  const [selectedRegisterAssignmentId, setSelectedRegisterAssignmentId] = useState<string | null>(
    null
  );
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(() =>
    externalSale && !externalSale.draft ? externalSale.id : null
  );
  const [saleError, setSaleError] = useState<string | null>(null);
  const [cashSessionError, setCashSessionError] = useState<string | null>(null);
  const [cashSessionCloseError, setCashSessionCloseError] = useState<string | null>(null);
  const [cashSessionMovementError, setCashSessionMovementError] = useState<string | null>(null);
  // set by the close mutation's success path; non-null mounts the
  // day-close ritual modal for that session.
  const [dayCloseSessionId, setDayCloseSessionId] = useState<string | null>(null);

  // slice 16b-1 — the active-cart lifecycle (materialization +
  // store-wrapper setters + the six cart-edit handlers) lives in
  // `useSalesCart`. It owns the workspace subscription; the shell injects
  // `ownerKey` + the two setters `handleProductSelect` touches.
  const {
    activeWorkspace,
    cartItems,
    ownedWorkspaces,
    isResumedCart,
    isQuotationCart,
    itemsLocked,
    canUndoActiveCart,
    activeSelectedCartItemKey,
    setCartItems,
    setSelectedCartItemKey,
    handleProductSelect,
    handlePriceTierChange,
    activePriceTier,
    handleQuantityChange,
    handleDiscountChange,
    handleSerialSelectionChange,
    handleUnitChange,
    handleRemoveItem,
    handleClearCart,
    handleUndoCart,
  } = useSalesCart({ ownerKey, setProductSearchQuery, setSaleError });
  const lastRead = useLastRead(cartItems, activeWorkspace?.id ?? null);
  const activeTicketId = activeWorkspace?.id ?? null;
  const chosenTender = (activeTicketId && ticketTenders[activeTicketId]) || 'cash';
  // A ticket left on credit falls back to cash once the store-credit zone is off.
  const ticketTender = chosenTender === 'credit' && !sellsOnCredit ? 'cash' : chosenTender;
  const handleTicketTenderChange = (tender: InitialTender) => {
    if (!activeTicketId) return;
    // Closed tickets drop out here, so the map never outgrows the open tabs.
    setTicketTenders(current => ({
      ...Object.fromEntries(
        ownedWorkspaces.flatMap(({ id }) => (current[id] ? [[id, current[id]]] : []))
      ),
      [activeTicketId]: tender,
    }));
  };

  const {
    productInputRef,
    focusProductInput,
    focusQuantityInput,
    focusDiscountInput,
    quantityInputRefFor,
    discountInputRefFor,
  } = useSalesInputFocus();

  useEffect(() => {
    if (currentSite && productInputRef.current) {
      saleMeasurement.markUsableControl();
    }
  }, [currentSite, productInputRef, saleMeasurement]);

  // The next sale has started, so the last one's summary no longer applies.
  if (completedSale && cartItems.length > 0) setCompletedSale(null);

  useEffect(() => {
    if (cartItems.length > 0) {
      saleMeasurement.ensure('complete_sale');
      saleMeasurement.markUsableControl();
      saleMeasurement.markFirstProgress();
    }
  }, [cartItems.length, saleMeasurement]);

  // slice 16b-2 — the operational read side (including the SINGLE shared
  // peripherals subscription), the normalized arrays + derived
  // flags, the `checkoutReadinessItems` preflight memo, `maybeAutoPrint`, and
  // the scanner/drawer derivations) lives in `useSalesPageData`. It is called
  // BEFORE `useSalesMutations` because the mutations consume `maybeAutoPrint`.
  const {
    activeCashSessionQuery,
    maybeAutoPrint,
    registerAssignments,
    selectedRegisterAssignment,
    activeCashSession,
    hasActiveCashSession,
    canOpenCashSession,
    suspendedDraftsCount,
    firstSuspendedDraft,
    canRequestInvoice,
    checkoutReadinessItems,
    hasRegisteredDrawer,
    scannerConfig,
  } = useSalesPageData({
    currentSite,
    currentTenant,
    user,
    selectedRegisterAssignmentId,
    hasCartItems: cartItems.length > 0,
  });
  const saleDelivery = useSaleDelivery({
    activeWorkspace,
    hasItems: cartItems.length > 0,
    completedSale,
    hasCashSession: hasActiveCashSession,
    userRole,
  });

  // slice 10 — the sales + cash-session mutation handles and the
  // shared finish-sale epilogue live in `useSalesMutations`. ALL the
  // state they mutate stays here in the shell; the setters are injected
  // so the dependency direction is shell → hook → shell, never hook ↔
  // hook. The flow handlers below call the returned mutation handles.
  const {
    createMutation,
    completeDraftMutation,
    suspendMutation,
    resumeMutation,
    discardDraftMutation,
    openRestaurantCheckMutation,
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
    setDayCloseSessionId,
    onSaleCompleted: sale => {
      setLastSale(sale);
      setCompletedSale(sale);
      saleMeasurement.finish('success');
      saleDelivery.onSaleCompleted(sale);
    },
    onCashSessionRecoverySucceeded: () => saleMeasurement.recordRecoveryOutcome('succeeded'),
    onCashSessionRecoveryFailed: () => saleMeasurement.recordRecoveryOutcome('failed'),
  });

  const draftSummary = useSaleCartSummary(cartItems, priceIncludesTax);
  const approvalDiscountAmount = getCartDiscountAmount(cartItems);
  const serialSelectionsComplete = areSerialSelectionsComplete(cartItems, currentSite?.id ?? null);
  const isServerRestarting = useEmbeddedServerState() === 'restarting';
  const canCharge =
    !isServerRestarting &&
    !!currentSite &&
    hasActiveCashSession &&
    cartItems.length > 0 &&
    serialSelectionsComplete &&
    (!activeWorkspace?.sourceQuotationSiteId ||
      activeWorkspace.sourceQuotationSiteId === currentSite.id);
  const canCloseCashSession =
    !!currentSite &&
    hasActiveCashSession &&
    !closeCashSessionMutation.isPending &&
    hubReachability.reachable !== false;
  const customerDisplayAccessId = useMemo(
    () =>
      customerDisplayEnabled && currentTenant?.id && currentSite?.id
        ? getOrCreateCustomerDisplayAccessId(currentTenant.id, currentSite.id)
        : null,
    [customerDisplayEnabled, currentSite, currentTenant]
  );

  const checkoutTransfer = useCheckoutTransferDisplay(state => state.transfer);
  useCustomerDisplayPublisher(
    customerDisplayAccessId && currentTenant && currentSite && activeCashSession
      ? {
          accessId: customerDisplayAccessId,
          tenantId: currentTenant.id,
          siteId: currentSite.id,
          cashSessionId: activeCashSession.id,
          registerName: activeCashSession.registerName,
          currency,
          items: cartItems,
          summary: draftSummary,
          priceIncludesTax,
          transfer: checkoutTransfer,
        }
      : null
  );

  const handleOpenCustomerDisplay = useCallback(() => {
    const reportFailure = () =>
      toast.error({
        title: t('view.customerDisplayOpenErrorTitle'),
        description: t('view.customerDisplayOpenErrorDescription'),
      });
    if (window.electron?.openCustomerDisplay) {
      if (!customerDisplayAccessId) {
        reportFailure();
        return;
      }
      void window.electron.openCustomerDisplay(customerDisplayAccessId).catch(reportFailure);
      return;
    }
    if (!customerDisplayAccessId || !openCustomerDisplayWindow(customerDisplayAccessId)) {
      reportFailure();
    }
  }, [customerDisplayAccessId, t, toast]);

  // slice 16 — the coupled sale-lifecycle flow handlers
  // (checkout, suspend, resume, new/select workspace) live in
  // `useSalesFlows`. The shell still owns ALL the state they read; the
  // read values + setters + the mutation handles are injected so the
  // dependency direction stays shell → hook, never hook ↔ hook.
  const pendingChargeSaleIdRef = useRef<string | null>(null);
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
    itemsLocked,
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
    openRestaurantCheckMutation,
    onResumedForCharge: saleId => {
      pendingChargeSaleIdRef.current = saleId;
    },
  });

  const weighing = useWeighedItem({
    cartItems,
    setCartItems,
    scope: activeWorkspace?.id ?? null,
    locked: itemsLocked,
    priceTier: activeWorkspace?.priceTier ?? 1,
    onApplied: setSelectedCartItemKey,
    className: 'shrink-0',
  });

  // slice 16b-1 — the modal/UI controller (the F1 payment-open gate
  // + F2 fast-cash, product search, the three cash-session modals, the
  // suspended-panel toggle, the history-reprint jump) + the checkout
  // preflight live in `useSalesModals`. Product-search visibility belongs to
  // that controller; payment and cash-session visibility stay in the shell.
  const commandBar = useSalesCommandBar({
    query: productSearchQuery,
    activeWorkspace: activeWorkspace ?? null,
    canCreateCustomer: userRole === 'admin' || userRole === 'manager',
    addProduct: (selection, quantity) => {
      saleMeasurement.ensure('complete_sale');
      saleMeasurement.markUsableControl();
      // A by-weight product asks its weight first, unless a quantity was typed.
      if (quantity === null && weighing.open(selection)) {
        setProductSearchQuery('');
        setSaleError(null);
        return;
      }
      weighing.close();
      handleProductSelect(selection, resolveRegisterAddQuantity(selection.product, quantity));
    },
  });

  const {
    preflight,
    isProductSearchOpen,
    setIsProductSearchOpen,
    productSearchInitialQuery,
    productSearchDialogKey,
    paymentModalKey,
    fastCashTrigger,
    fastCashAmount,
    paymentFocusTarget,
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
    handleOpenReplenishment,
    cashSessionMovementType,
    handleRecordCashMovement,
    handleToggleSuspendedPanel,
    handleReprintSelectedHistoryRow,
  } = useSalesModals({
    currentSite,
    cartItems,
    draftSummary,
    activeCashSession,
    hasActiveCashSession,
    isResumedCart,
    selectedRegisterAssignment,
    selectedHistorySaleId,
    checkoutReadinessItems,
    isPaymentModalOpen,
    productSearchQuery: commandBar.searchText,
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
    onCheckoutValidationError: () => saleMeasurement.recordValidationError(),
    onCheckoutRecoveryAttempt: () => saleMeasurement.recordRecoveryAttempt(),
  });

  const shiftHandoff = useShiftHandoff({
    siteId: currentSite?.id ?? null,
    activeCashSession,
    registerAssignments,
    selectedRegisterAssignment,
    hasReceiptPrinter: !getSalesDockGates({
      canCharge: false,
      hubReachable: true,
      readinessItems: checkoutReadinessItems,
    }).printerMissing,
    onResumeDraft: handleResumeFromPanel,
    onRequestChange: handleOpenReplenishment,
  });
  // Opening a register that is waiting to be received would discard its handoff.
  const openOrReceiveCashSession = shiftHandoff.receive?.isSelectedRegister
    ? shiftHandoff.receive.open
    : handleOpenCashSessionModal;

  const handleMeasuredRemoveItem = (itemKey: string) => {
    saleMeasurement.recordBacktrack();
    handleRemoveItem(itemKey);
  };
  const handleMeasuredClearCart = () => {
    if (cartItems.length > 0) {
      saleMeasurement.recordBacktrack();
    }
    handleClearCart();
  };
  const handleMeasuredUndoCart = () => {
    if (canUndoActiveCart) {
      saleMeasurement.recordBacktrack();
    }
    handleUndoCart();
  };
  const handleMeasuredOpenProductSearch = useCallback(
    (initialQuery?: string) => {
      if (itemsLocked) return;
      saleMeasurement.ensure('complete_sale');
      saleMeasurement.markUsableControl();
      handleOpenProductSearch(initialQuery);
    },
    [handleOpenProductSearch, itemsLocked, saleMeasurement]
  );

  // omnibox landing. When the command palette could not resolve
  // the typed query as an exact barcode, it navigates here with the query in
  // router state; consume it ONCE into the product-search dialog and clear
  // the state so back/refresh does not reopen the dialog.
  useEffect(() => {
    if (!externalSale) return;
    navigate(location.pathname, { replace: true, state: null });
  }, [externalSale, navigate, location.pathname]);
  const omniboxQuery = (location.state as { omniboxQuery?: string } | null)?.omniboxQuery;
  // `handleOpenProductSearch` is a plain closure (new identity per render),
  // so the effect re-runs on every render — the consumed ref makes those
  // re-runs no-ops and keeps each router-state query one-shot.
  const consumedOmniboxQueryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!omniboxQuery || consumedOmniboxQueryRef.current === omniboxQuery) return;
    consumedOmniboxQueryRef.current = omniboxQuery;
    handleMeasuredOpenProductSearch(omniboxQuery);
    navigate(location.pathname, { replace: true, state: null });
  }, [omniboxQuery, handleMeasuredOpenProductSearch, navigate, location.pathname]);

  // «Cobrar cuenta N» resumes the check, then charges it once its lines are on screen.
  const activeServerSaleId = activeWorkspace?.serverSaleId ?? null;
  useEffect(() => {
    const pending = pendingChargeSaleIdRef.current;
    if (!pending) return;
    // One shot: another ticket taking the screen first cancels the charge.
    pendingChargeSaleIdRef.current = null;
    if (activeServerSaleId === pending && cartItems.length > 0) handleOpenPaymentModal();
  }, [activeServerSaleId, cartItems.length, handleOpenPaymentModal]);
  const restaurantCharge = useMemo(
    () => readRestaurantChargeEntry(location.state),
    [location.state]
  );
  const consumedRestaurantChargeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!restaurantCharge || !ownerKey) return;
    if (consumedRestaurantChargeRef.current === restaurantCharge.id) return;
    consumedRestaurantChargeRef.current = restaurantCharge.id;
    navigate(location.pathname, { replace: true, state: null });
    void handleResumeFromPanel(restaurantCharge, { charge: true });
  }, [restaurantCharge, ownerKey, navigate, location.pathname, handleResumeFromPanel]);

  // keep the product-search input focused across the cashier flow
  // so a USB HID barcode scanner always lands on the right target.
  useScannerFocusRestoration({
    productInputRef,
    isProductSearchOpen,
    isPaymentModalOpen,
    isQuickCreateProductMounted: shouldRenderQuickCreateProductGate,
    isQuickCreateCustomerMounted: shouldRenderQuickCreateCustomerGate,
  });

  // An exchange link is committed only when its replacement sale completes.
  // A generic suspended draft cannot persist sourceReturnId yet, so parking
  // it would silently turn the exchange into an unrelated sale.
  const canSuspendActiveCart =
    parksSales && canCharge && !itemsLocked && activeWorkspace?.sourceReturnId == null;

  useSalesKeyboardShortcuts({
    selectedItemKey: activeSelectedCartItemKey,
    canCharge,
    canOpenSearch: !itemsLocked,
    isProductSearchOpen,
    isPaymentModalOpen,
    onOpenSearch: () => handleMeasuredOpenProductSearch(),
    onOpenPayment: handleOpenPaymentModal,
    onRemoveSelectedItem: handleMeasuredRemoveItem,
    focusProductInput,
    focusQuantityInput,
    focusDiscountInput,
    canSuspend: canSuspendActiveCart,
    onSuspend: handleOpenSuspendPrompt,
    onToggleSuspendedPanel: handleToggleSuspendedPanel,
    canToggleSuspendedPanel: suspendedDraftsCount > 0 || isSuspendedPanelOpen,
    onReprintSelectedHistoryRow:
      selectedHistorySaleId !== null ? handleReprintSelectedHistoryRow : undefined,
    // Mod+Z routes through the same handler the visible
    // "Deshacer" button uses so the toast surface stays consistent.
    onUndo: handleMeasuredUndoCart,
    // F2 routes through handleFastCash.
    onFastCash: handleFastCash,
    // register lifecycle. Each combo routes through the SAME
    // handler its visible button uses; unavailable actions pass
    // undefined so the combo stays inert instead of erroring.
    onNewSale: handleNewSale,
    onOpenCashSession:
      shiftHandoff.receive?.isSelectedRegister || canOpenCashSession
        ? openOrReceiveCashSession
        : undefined,
    onOpenCashMovement: activeCashSession ? handleOpenCashSessionMovementModal : undefined,
    onOpenCashClose: canCloseCashSession ? () => setIsCashSessionCloseModalOpen(true) : undefined,
    onOpenIncident: () => setIsIncidentSheetOpen(true),
  });

  // Role-aware cash drawer kick and barcode scanner pipeline.
  // `hasRegisteredDrawer` / `scannerConfig` are derived from the
  // SHARED `peripherals.activeForSite` query inside `useSalesPageData` and
  // threaded in here; the modal-open flags gate the wedge listener so a scan
  // never fires while a modal owns the keyboard.
  const { onKickCashDrawer, isKickingCashDrawer, approvalModal } = useCashDrawerController({
    hasRegisteredDrawer,
  });
  const { handleBarcodeScan, handleTypedCode } = useBarcodeProductScanner({
    scannerConfig,
    isResumedCart: itemsLocked,
    isProductSearchOpen,
    isPaymentModalOpen,
    isCashSessionModalOpen: isCashSessionModalOpen || shiftHandoff.isSheetOpen,
    isCashSessionCloseModalOpen,
    isCashSessionMovementModalOpen,
    productInputRef,
    setCartItems,
    setSelectedCartItemKey,
    setProductSearchQuery,
    setSaleError,
    takePendingQuantity: commandBar.takePendingQuantity,
  });

  return (
    <div
      className="contents"
      data-task-measurement="complete_sale"
      onPointerDownCapture={() => saleMeasurement.recordInteraction()}
      onKeyDownCapture={event => {
        if (isTaskActivationKey(event.key)) {
          saleMeasurement.recordInteraction();
        }
      }}
    >
      <SalesScreen
        parksSales={parksSales}
        canSuspendActiveCart={canSuspendActiveCart}
        productSearchQuery={productSearchQuery}
        setProductSearchQuery={setProductSearchQuery}
        handleOpenProductSearch={handleMeasuredOpenProductSearch}
        productInputRef={productInputRef}
        onCameraCode={code => void handleBarcodeScan(code)}
        onTypedCode={handleTypedCode}
        setIsHistoryDrawerOpen={setIsHistoryDrawerOpen}
        setIsSuspendedPanelOpen={setIsSuspendedPanelOpen}
        suspendedDraftsCount={suspendedDraftsCount}
        customerDisplayEnabled={customerDisplayEnabled}
        handleOpenCustomerDisplay={handleOpenCustomerDisplay}
        isResumedCart={isResumedCart}
        isQuotationCart={isQuotationCart}
        itemsLocked={itemsLocked}
        activeWorkspace={activeWorkspace}
        ownedWorkspaces={ownedWorkspaces}
        handleSelectWorkspace={handleSelectWorkspace}
        cartItems={cartItems}
        activeSelectedCartItemKey={activeSelectedCartItemKey}
        draftSummary={draftSummary}
        approvalDiscountAmount={approvalDiscountAmount}
        currencyCode={currency}
        favoriteScopeKey={
          currentTenant && currentSite ? `${currentTenant.id}:${currentSite.id}` : ''
        }
        saleError={saleError}
        handleQuantityChange={handleQuantityChange}
        handleDiscountChange={handleDiscountChange}
        handleSerialSelectionChange={handleSerialSelectionChange}
        handleUnitChange={handleUnitChange}
        handleRemoveItem={handleMeasuredRemoveItem}
        setSelectedCartItemKey={setSelectedCartItemKey}
        handleClearCart={handleMeasuredClearCart}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
        canUndoActiveCart={canUndoActiveCart}
        handleUndoCart={handleMeasuredUndoCart}
        activePriceTier={activePriceTier}
        handlePriceTierChange={handlePriceTierChange}
        currentSite={currentSite}
        activeCashSession={activeCashSession}
        registerAssignments={registerAssignments}
        selectedRegisterAssignment={selectedRegisterAssignment}
        isCashSessionLoading={activeCashSessionQuery.isLoading}
        canCharge={canCharge}
        canOpenCashSession={canOpenCashSession}
        canCloseCashSession={canCloseCashSession}
        userRole={userRole}
        handleOpenPaymentModal={handleOpenPaymentModal}
        handleOpenCashSessionModal={openOrReceiveCashSession}
        handleOpenCloseCashSessionModal={handleOpenCloseCashSessionModal}
        handleOpenCashSessionMovementModal={handleOpenCashSessionMovementModal}
        onKickCashDrawer={onKickCashDrawer}
        isKickingCashDrawer={isKickingCashDrawer}
        setSelectedRegisterAssignmentId={setSelectedRegisterAssignmentId}
        handleOpenSuspendPrompt={handleOpenSuspendPrompt}
        handleNewSale={handleNewSale}
        handleToggleSuspendedPanel={handleToggleSuspendedPanel}
        hubReachable={hubReachability.reachable ?? undefined}
        preflightItems={preflight.items}
        readinessItems={checkoutReadinessItems}
        isHistoryDrawerOpen={isHistoryDrawerOpen}
        isIncidentSheetOpen={isIncidentSheetOpen}
        scanGapMs={scannerConfig.interCharGapMs}
        setIsIncidentSheetOpen={setIsIncidentSheetOpen}
        lastSale={lastSale}
        lastRead={lastRead}
        ticketTender={ticketTender}
        onTicketTenderChange={handleTicketTenderChange}
        cashierName={user?.name ?? null}
        firstSuspendedDraft={firstSuspendedDraft}
        canRequestInvoice={canRequestInvoice}
        handleFastCash={handleFastCash}
        fastCashAmount={fastCashAmount}
        paymentFocusTarget={paymentFocusTarget}
        completedSale={completedSale}
        saleDelivery={saleDelivery}
        onDismissCompletedSale={() => setCompletedSale(null)}
        setSelectedSaleId={setSelectedSaleId}
        selectedHistorySaleId={selectedHistorySaleId}
        setSelectedHistorySaleId={setSelectedHistorySaleId}
        isSuspendedPanelOpen={isSuspendedPanelOpen}
        handleResumeFromPanel={handleResumeFromPanel}
        isProductSearchOpen={isProductSearchOpen}
        shouldRenderQuickCreateProductGate={shouldRenderQuickCreateProductGate}
        shouldRenderQuickCreateCustomerGate={shouldRenderQuickCreateCustomerGate}
        productSearchDialogKey={productSearchDialogKey}
        setIsProductSearchOpen={setIsProductSearchOpen}
        handleProductSelect={commandBar.selectProduct}
        weighPanel={weighing.panel}
        commandBar={commandBar}
        productSearchInitialQuery={productSearchInitialQuery}
        setCartItems={setCartItems}
        isPaymentModalOpen={isPaymentModalOpen}
        paymentModalKey={paymentModalKey}
        isPaymentSaving={createMutation.isPending || completeDraftMutation.isPending}
        serviceChargeRate={serviceChargeRate}
        cashRoundingStep={cashRoundingStep}
        fastCashTrigger={fastCashTrigger}
        setIsPaymentModalOpen={setIsPaymentModalOpen}
        setFastCashTrigger={setFastCashTrigger}
        handleCheckout={handleCheckout}
        selectedSaleId={selectedSaleId}
        isSuspendLabelPromptOpen={isSuspendLabelPromptOpen}
        isSuspending={isSuspending}
        suspendLabelDraft={suspendLabelDraft}
        setSuspendLabelDraft={setSuspendLabelDraft}
        setIsSuspendLabelPromptOpen={setIsSuspendLabelPromptOpen}
        handleSuspendConfirm={handleSuspendConfirm}
        isCashSessionModalOpen={isCashSessionModalOpen}
        cashSessionModalKey={cashSessionModalKey}
        isOpeningCashSession={openCashSessionMutation.isPending}
        cashSessionError={cashSessionError}
        setIsCashSessionModalOpen={setIsCashSessionModalOpen}
        handleCreateCashSession={handleCreateCashSession}
        isCashSessionCloseModalOpen={isCashSessionCloseModalOpen}
        cashSessionCloseModalKey={cashSessionCloseModalKey}
        isClosingCashSession={closeCashSessionMutation.isPending}
        cashSessionCloseError={cashSessionCloseError}
        setIsCashSessionCloseModalOpen={setIsCashSessionCloseModalOpen}
        handleCloseCashSession={handleCloseCashSession}
        isCashSessionMovementModalOpen={isCashSessionMovementModalOpen}
        cashSessionMovementModalKey={cashSessionMovementModalKey}
        cashSessionMovementType={cashSessionMovementType}
        shiftHandoff={shiftHandoff}
        isRecordingMovement={recordCashMovementMutation.isPending}
        cashSessionMovementError={cashSessionMovementError}
        setIsCashSessionMovementModalOpen={setIsCashSessionMovementModalOpen}
        handleRecordCashMovement={handleRecordCashMovement}
        dayCloseSessionId={dayCloseSessionId}
        setDayCloseSessionId={setDayCloseSessionId}
      />
      {approvalModal.isOpen && (
        <Suspense fallback={null}>
          <LazyCashDrawerApprovalModal {...approvalModal} />
        </Suspense>
      )}
    </div>
  );
}
