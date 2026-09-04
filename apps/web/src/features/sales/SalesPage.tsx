import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import { useLocation, useNavigate } from 'react-router';
import { useAuth } from '@/features/auth/AuthProvider';
import { useCashDrawerController } from '@/features/sales/useCashDrawerController';
import { useBarcodeProductScanner } from '@/features/sales/useBarcodeProductScanner';
import { useSalesMutations } from '@/features/sales/useSalesMutations';
import { useSalesFlows } from '@/features/sales/useSalesFlows';
import { useSalesCart } from '@/features/sales/useSalesCart';
import { useSalesModals } from '@/features/sales/useSalesModals';
import { useSalesPageData } from '@/features/sales/useSalesPageData';
import { SalesScreen } from '@/features/sales/SalesScreen';
import { useQuickCreateStore } from '@/features/sales/useQuickCreateStore';
import { useHubReachability } from '@/hooks/useHubReachability';
import { areSerialSelectionsComplete, getCartSummary } from '@/features/sales/saleCartTotals';
import { getCartDiscountAmount } from '@/features/sales/saleApprovalPricing';
import { useSalesInputFocus } from '@/features/sales/useSalesInputFocus';
import { useScannerFocusRestoration } from '@/features/sales/useScannerFocusRestoration';
import { useSalesKeyboardShortcuts } from '@/features/sales/useSalesKeyboardShortcuts';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { isTaskActivationKey, useTaskMeasurementController } from '@/lib/taskMeasurement';
import { readExternalSaleEntry } from './externalSaleEntry';

const LazyCashDrawerApprovalModal = lazy(() =>
  import('@/features/sales/CashDrawerApprovalModal').then(module => ({
    default: module.CashDrawerApprovalModal,
  }))
);

export function SalesPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const externalSale = readExternalSaleEntry(location.state);
  const priceIncludesTax = usePriceIncludesTax();
  const { currentTenant, currentSite, tenantSettings } = useTenant();
  const { currency } = useResolvedLocale();
  // restaurant service-charge rate flows from the tenant
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
  const [lastCompletedSaleId, setLastCompletedSaleId] = useState<string | null>(null);
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
    handleRemoveItem,
    handleClearCart,
    handleUndoCart,
  } = useSalesCart({ ownerKey, setProductSearchQuery, setSaleError });

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
    checkoutReadinessItems,
    hasRegisteredDrawer,
    scannerConfig,
  } = useSalesPageData({
    currentSite,
    currentTenant,
    user,
    selectedRegisterAssignmentId,
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
    onSaleCompleted: saleId => {
      setLastCompletedSaleId(saleId);
      saleMeasurement.finish('success');
    },
    onCashSessionRecoverySucceeded: () => saleMeasurement.recordRecoveryOutcome('succeeded'),
    onCashSessionRecoveryFailed: () => saleMeasurement.recordRecoveryOutcome('failed'),
  });

  const draftSummary = getCartSummary(cartItems, priceIncludesTax);
  const approvalDiscountAmount = getCartDiscountAmount(cartItems);
  const serialSelectionsComplete = areSerialSelectionsComplete(cartItems, currentSite?.id ?? null);
  const canCharge =
    !!currentSite &&
    hasActiveCashSession &&
    cartItems.length > 0 &&
    serialSelectionsComplete &&
    (!activeWorkspace?.sourceQuotationSiteId ||
      activeWorkspace.sourceQuotationSiteId === currentSite.id);
  const canCloseCashSession =
    !!currentSite && hasActiveCashSession && !closeCashSessionMutation.isPending;

  // slice 16 — the coupled sale-lifecycle flow handlers
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
  });

  // slice 16b-1 — the modal/UI controller (the F1 payment-open gate
  // + F2 fast-cash, product search, the three cash-session modals, the
  // suspended-panel toggle, the history-reprint jump) + the checkout
  // preflight live in `useSalesModals`. Product-search visibility belongs to
  // that controller; payment and cash-session visibility stay in the shell.
  const {
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
    onCheckoutValidationError: () => saleMeasurement.recordValidationError(),
    onCheckoutRecoveryAttempt: () => saleMeasurement.recordRecoveryAttempt(),
  });

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
  const handleMeasuredProductSelect = (selection: Parameters<typeof handleProductSelect>[0]) => {
    saleMeasurement.ensure('complete_sale');
    saleMeasurement.markUsableControl();
    handleProductSelect(selection);
  };

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

  // keep the product-search input focused across the cashier flow
  // so a USB HID barcode scanner always lands on the right target.
  useScannerFocusRestoration({
    productInputRef,
    isProductSearchOpen,
    isPaymentModalOpen,
    isQuickCreateProductMounted: shouldRenderQuickCreateProductGate,
    isQuickCreateCustomerMounted: shouldRenderQuickCreateCustomerGate,
  });

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
    canSuspend: canCharge && !itemsLocked,
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
    onOpenCashSession: canOpenCashSession ? handleOpenCashSessionModal : undefined,
    onOpenCashMovement: activeCashSession ? handleOpenCashSessionMovementModal : undefined,
    onOpenCashClose: canCloseCashSession ? () => setIsCashSessionCloseModalOpen(true) : undefined,
  });

  // Role-aware cash drawer kick and barcode scanner pipeline.
  // `hasRegisteredDrawer` / `scannerConfig` are derived from the
  // SHARED `peripherals.activeForSite` query inside `useSalesPageData` and
  // threaded in here; the modal-open flags gate the wedge listener so a scan
  // never fires while a modal owns the keyboard.
  const { onKickCashDrawer, isKickingCashDrawer, approvalModal } = useCashDrawerController({
    hasRegisteredDrawer,
  });
  useBarcodeProductScanner({
    scannerConfig,
    isResumedCart: itemsLocked,
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
        productSearchQuery={productSearchQuery}
        setProductSearchQuery={setProductSearchQuery}
        handleOpenProductSearch={handleMeasuredOpenProductSearch}
        productInputRef={productInputRef}
        setIsHistoryDrawerOpen={setIsHistoryDrawerOpen}
        setIsSuspendedPanelOpen={setIsSuspendedPanelOpen}
        suspendedDraftsCount={suspendedDraftsCount}
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
        handleRemoveItem={handleMeasuredRemoveItem}
        setSelectedCartItemKey={setSelectedCartItemKey}
        handleClearCart={handleMeasuredClearCart}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
        focusDiscountInput={focusDiscountInput}
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
        handleOpenCashSessionModal={handleOpenCashSessionModal}
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
        isHistoryDrawerOpen={isHistoryDrawerOpen}
        lastCompletedSaleId={lastCompletedSaleId}
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
        handleProductSelect={handleMeasuredProductSelect}
        productSearchInitialQuery={productSearchInitialQuery}
        setCartItems={setCartItems}
        isPaymentModalOpen={isPaymentModalOpen}
        paymentModalKey={paymentModalKey}
        isPaymentSaving={createMutation.isPending || completeDraftMutation.isPending}
        serviceChargeRate={serviceChargeRate}
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
