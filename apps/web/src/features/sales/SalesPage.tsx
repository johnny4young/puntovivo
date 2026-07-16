import { lazy, Suspense, useState } from 'react';
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
import {
  getCartDiscountAmount,
  getCartSummary,
  getLineTotals,
} from '@/features/sales/saleCart';
import { useSalesInputFocus } from '@/features/sales/useSalesInputFocus';
import { useScannerFocusRestoration } from '@/features/sales/useScannerFocusRestoration';
import { useSalesKeyboardShortcuts } from '@/features/sales/useSalesKeyboardShortcuts';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';

const LazyCashDrawerApprovalModal = lazy(() =>
  import('@/features/sales/CashDrawerApprovalModal').then(module => ({
    default: module.CashDrawerApprovalModal,
  }))
);

export function SalesPage() {
  const { currentTenant, currentSite, tenantSettings } = useTenant();
  const { currency } = useResolvedLocale();
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
  const userRole = user?.role ?? 'cashier';

  // ENG-018b — `ownerKey` (`${tenantId}:${userId}`) identifies the
  // signed-in cashier. It is injected into the cart, mutation, and flow
  // hooks so each scopes its workspace / drafts to the current operator.
  const ownerKey = currentTenant && user ? `${currentTenant.id}:${user.id}` : null;

  // ENG-178 slice 16b-1 — these UI / modal `useState` declarations STAY in
  // the shell because `useSalesMutations` injects their setters (it is wired
  // before `useSalesModals`) and several are read by more than one hook.
  // ENG-186 — el POS es ahora la única superficie de /sales; el historial y
  // las ventas suspendidas viven detrás de cajones laterales (Drawer).
  const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  // ENG-018b — multi-cart workspace UX state. The label-prompt modal
  // captures an optional "Mesa 5" annotation before the Suspend server
  // orchestration runs; the suspended panel is toggled by Ctrl+R or
  // operator clicks.
  const [isSuspendedPanelOpen, setIsSuspendedPanelOpen] = useState(false);
  const [isSuspendLabelPromptOpen, setIsSuspendLabelPromptOpen] = useState(false);
  const [suspendLabelDraft, setSuspendLabelDraft] = useState('');
  const [isSuspending, setIsSuspending] = useState(false);
  const [selectedHistorySaleId, setSelectedHistorySaleId] = useState<string | null>(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isCashSessionModalOpen, setIsCashSessionModalOpen] = useState(false);
  const [isCashSessionCloseModalOpen, setIsCashSessionCloseModalOpen] = useState(false);
  const [isCashSessionMovementModalOpen, setIsCashSessionMovementModalOpen] = useState(false);
  const [selectedRegisterAssignmentId, setSelectedRegisterAssignmentId] = useState<string | null>(
    null
  );
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [cashSessionError, setCashSessionError] = useState<string | null>(null);
  const [cashSessionCloseError, setCashSessionCloseError] = useState<string | null>(null);
  const [cashSessionMovementError, setCashSessionMovementError] = useState<string | null>(null);
  // ENG-198 — set by the close mutation's success path; non-null mounts the
  // day-close ritual modal for that session.
  const [dayCloseSessionId, setDayCloseSessionId] = useState<string | null>(null);

  // ENG-178 slice 16b-1 — the active-cart lifecycle (materialization +
  // store-wrapper setters + the six cart-edit handlers) lives in
  // `useSalesCart`. It owns the workspace subscription; the shell injects
  // `ownerKey` + the two setters `handleProductSelect` touches.
  const {
    activeWorkspace,
    cartItems,
    ownedWorkspaces,
    isResumedCart,
    canUndoActiveCart,
    activeSelectedCartItemKey,
    setCartItems,
    setSelectedCartItemKey,
    handleProductSelect,
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

  // ENG-178 slice 16b-2 — the read side (the nine tRPC queries incl. the
  // SINGLE shared peripherals subscription, the normalized arrays + derived
  // flags, the `checkoutReadinessItems` preflight memo, `maybeAutoPrint`, and
  // the scanner/drawer derivations) lives in `useSalesPageData`. It is called
  // BEFORE `useSalesMutations` because the mutations consume `maybeAutoPrint`.
  const {
    salesQuery,
    activeCashSessionQuery,
    maybeAutoPrint,
    sales,
    customers,
    categories,
    providers,
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

  // ENG-178 slice 10 — the sales + cash-session mutation handles and the
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
  });

  const draftSummary = getCartSummary(cartItems);
  const approvalDiscountAmount = getCartDiscountAmount(cartItems);
  const selectedSerialIds = cartItems.flatMap(item => item.serialIds ?? []);
  const serialSelectionsComplete = cartItems.every(
    item =>
      !item.tracksSerials ||
      (item.serialIds ?? []).length === getLineTotals(item).normalizedQuantity
  ) && new Set(selectedSerialIds).size === selectedSerialIds.length;
  const canCharge =
    !!currentSite && hasActiveCashSession && cartItems.length > 0 && serialSelectionsComplete;
  const canCloseCashSession =
    !!currentSite && hasActiveCashSession && !closeCashSessionMutation.isPending;

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

  // ENG-178 slice 16b-1 — the modal/UI controller (the F1 payment-open gate
  // + F2 fast-cash, product search, the three cash-session modals, the
  // suspended-panel toggle, the history-reprint jump) + the checkout
  // preflight live in `useSalesModals`. The payment / cash-session `isOpen`
  // + `*Error` state stays in the shell (injected into `useSalesMutations`),
  // so its setters are threaded in here.
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
  });

  // ENG-105f — keep the product-search input focused across the cashier flow
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
    canToggleSuspendedPanel: suspendedDraftsCount > 0 || isSuspendedPanelOpen,
    onReprintSelectedHistoryRow:
      selectedHistorySaleId !== null ? handleReprintSelectedHistoryRow : undefined,
    // ENG-105d — Mod+Z routes through the same handler the visible
    // "Deshacer" button uses so the toast surface stays consistent.
    onUndo: handleUndoCart,
    // ENG-105e — F2 routes through handleFastCash.
    onFastCash: handleFastCash,
  });

  // ENG-062 / ENG-106c3 — role-aware cash drawer kick + ENG-061 barcode scanner
  // pipeline. `hasRegisteredDrawer` / `scannerConfig` are derived from the
  // SHARED `peripherals.activeForSite` query inside `useSalesPageData` and
  // threaded in here; the modal-open flags gate the wedge listener so a scan
  // never fires while a modal owns the keyboard.
  const { onKickCashDrawer, isKickingCashDrawer, approvalModal } = useCashDrawerController({
    hasRegisteredDrawer,
  });
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
      <SalesScreen
        productSearchQuery={productSearchQuery}
        setProductSearchQuery={setProductSearchQuery}
        handleOpenProductSearch={handleOpenProductSearch}
        productInputRef={productInputRef}
        setIsHistoryDrawerOpen={setIsHistoryDrawerOpen}
        setIsSuspendedPanelOpen={setIsSuspendedPanelOpen}
        suspendedDraftsCount={suspendedDraftsCount}
        isResumedCart={isResumedCart}
        activeWorkspace={activeWorkspace}
        ownedWorkspaces={ownedWorkspaces}
        handleSelectWorkspace={handleSelectWorkspace}
        cartItems={cartItems}
        activeSelectedCartItemKey={activeSelectedCartItemKey}
        draftSummary={draftSummary}
        approvalDiscountAmount={approvalDiscountAmount}
        currencyCode={currency}
        saleError={saleError}
        handleQuantityChange={handleQuantityChange}
        handleDiscountChange={handleDiscountChange}
        handleSerialSelectionChange={handleSerialSelectionChange}
        handleRemoveItem={handleRemoveItem}
        setSelectedCartItemKey={setSelectedCartItemKey}
        handleClearCart={handleClearCart}
        quantityInputRefFor={quantityInputRefFor}
        discountInputRefFor={discountInputRefFor}
        canUndoActiveCart={canUndoActiveCart}
        handleUndoCart={handleUndoCart}
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
        sales={sales}
        salesLoading={salesQuery.isLoading}
        salesError={salesQuery.error?.message ?? null}
        onRetrySales={() => {
          void salesQuery.refetch();
        }}
        setSelectedSaleId={setSelectedSaleId}
        selectedHistorySaleId={selectedHistorySaleId}
        setSelectedHistorySaleId={setSelectedHistorySaleId}
        isSuspendedPanelOpen={isSuspendedPanelOpen}
        handleResumeFromPanel={handleResumeFromPanel}
        isProductSearchOpen={isProductSearchOpen}
        productSearchDialogKey={productSearchDialogKey}
        setIsProductSearchOpen={setIsProductSearchOpen}
        handleProductSelect={handleProductSelect}
        categories={categories}
        providers={providers}
        productSearchInitialQuery={productSearchInitialQuery}
        setCartItems={setCartItems}
        isPaymentModalOpen={isPaymentModalOpen}
        paymentModalKey={paymentModalKey}
        customers={customers}
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
    </>
  );
}
