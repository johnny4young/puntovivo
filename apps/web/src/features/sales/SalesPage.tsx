import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Drawer } from '@/components/feedback/Drawer';
import { useAuth } from '@/features/auth/AuthProvider';
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
import { useSalesCart } from '@/features/sales/useSalesCart';
import { useSalesModals } from '@/features/sales/useSalesModals';
import {
  type PreflightBlockerId,
  type PreflightItem,
} from '@/features/sales/useCheckoutPreflight';
import { useQuickCreateStore } from '@/features/sales/useQuickCreateStore';
import { useHubReachability } from '@/hooks/useHubReachability';
import { SalesHistoryTable } from '@/features/sales/SalesHistoryTable';
import { SalesMobileCheckoutBar } from '@/features/sales/SalesMobileCheckoutBar';
import { SuspendedSalesPanel } from '@/features/sales/SuspendedSalesPanel';
import { getCartSummary } from '@/features/sales/saleCart';
import { useSalesInputFocus } from '@/features/sales/useSalesInputFocus';
import { useScannerFocusRestoration } from '@/features/sales/useScannerFocusRestoration';
import { useSalesKeyboardShortcuts } from '@/features/sales/useSalesKeyboardShortcuts';
import {
  DEFAULT_WEDGE_CONFIG,
  type WedgeConfig,
} from '@/features/sales/useBarcodeWedgeListener';
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

  // ENG-018b — `ownerKey` (`${tenantId}:${userId}`) identifies the
  // signed-in cashier. It is injected into the cart, mutation, and flow
  // hooks so each scopes its workspace / drafts to the current operator.
  const ownerKey =
    currentTenant && user ? `${currentTenant.id}:${user.id}` : null;

  // ENG-178 slice 16b-1 — these UI / modal `useState` declarations STAY in
  // the shell because `useSalesMutations` injects their setters (it is wired
  // before `useSalesModals`) and several are read by more than one hook. They
  // are declared before the controller-hook calls so they can be threaded in.
  // ENG-186 — el POS es ahora la única superficie de /sales (carrito +
  // resumen de cobro). El historial pasó de un toggle segmentado a un
  // cajón lateral (Drawer) para que nunca compita verticalmente con el
  // flujo de cobro; los KPIs y el Control de caja ya viven en Dashboard
  // y Operations → Caja respectivamente.
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
  const [selectedHistorySaleId, setSelectedHistorySaleId] = useState<
    string | null
  >(null);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isCashSessionModalOpen, setIsCashSessionModalOpen] = useState(false);
  const [isCashSessionCloseModalOpen, setIsCashSessionCloseModalOpen] = useState(false);
  const [isCashSessionMovementModalOpen, setIsCashSessionMovementModalOpen] = useState(false);
  const [selectedRegisterAssignmentId, setSelectedRegisterAssignmentId] = useState<string | null>(null);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [saleError, setSaleError] = useState<string | null>(null);
  const [cashSessionError, setCashSessionError] = useState<string | null>(null);
  const [cashSessionCloseError, setCashSessionCloseError] = useState<string | null>(null);
  const [cashSessionMovementError, setCashSessionMovementError] = useState<string | null>(null);

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

  // ENG-178 slice 16b-1 — the modal/UI controller (the F1 payment-open
  // gate + F2 fast-cash, product search, the three cash-session modals,
  // the suspended-panel toggle, the history-reprint jump) + the checkout
  // preflight live in `useSalesModals`. `useCheckoutPreflight` moved inside
  // so `handleOpenPaymentModal`'s preflight read and the preflight
  // `onOpenCashSession` recovery stay intra-hook. The payment / cash-session
  // `isOpen` + `*Error` state stays in the shell (injected into
  // `useSalesMutations` above), so its setters are threaded in here.
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
    userRole: user?.role ?? 'cashier',
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
