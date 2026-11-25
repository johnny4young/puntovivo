import {
  lazy,
  Suspense,
  useCallback,
  useState,
  type ComponentProps,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from '@/components/feedback/Drawer';
import { SalesCartWorkspace } from '@/features/sales/SalesCartWorkspace';
import { SalesCheckoutPanel } from '@/features/sales/SalesCheckoutPanel';
import type { CashSessionModals } from '@/features/sales/CashSessionModals';
import { SalesHeaderSection } from '@/features/sales/SalesHeaderSection';
import { SalesFlowRail } from '@/features/sales/SalesFlowRail';
import type { SalesModals } from '@/features/sales/SalesModals';
import { WorkspaceTabsSection } from '@/features/sales/WorkspaceTabsSection';
import { SalesMobileCheckoutBar } from '@/features/sales/SalesMobileCheckoutBar';
import { SalesQuickSearchBar } from '@/features/sales/SalesQuickSearchBar';
import { SalesShortcutStrip } from '@/features/sales/SalesShortcutStrip';
import { SalesStatusPills } from '@/features/sales/SalesStatusPills';
import { getSalesDockGates } from '@/features/sales/salesDockGates';
import { getPayableCartTotal } from '@/features/sales/saleCartTotals';
import { buildRegisterBarActions } from '@/features/sales/registerBarActions';
import { isTicketCustomerFrozen } from '@/features/sales/useCartWorkspaceStore';
import type { SalesCommandBar } from '@/features/sales/useSalesCommandBar';
import type { PreflightItem } from '@/features/sales/useCheckoutPreflight';
import { LastReadBanner } from '@/features/sales/LastReadBanner';
import type { LastRead } from '@/features/sales/useLastRead';
import type { PaymentFocusTarget } from '@/features/sales/useSalesModals';
import { roundMoney } from '@/lib/money';
import { percentOf } from '@/features/sales/cashTender';
import type { SuspendedSalesPanel } from '@/features/sales/SuspendedSalesPanel';
import type { ProductSearchSelection } from '@/types';
import type { SaleCartItem } from '@/features/sales/saleCart';
import { canAccessRole, managerOrAdminRoles } from '@/features/auth/roleAccess';
import { useRegisterZone } from '@/features/modules/useRegisterZone';
import { SaleCompleteStrip, type CompletedSaleSummary } from './SaleCompleteStrip';
import { usePrintSaleReceipt } from './useReceiptAutoPrint';
import { usePhoneLayout } from './usePhoneLayout';
import { hasAccount, useCustomerAccount } from './useCustomerAccount';
import { CustomerAccountBar } from './CustomerAccountBar';
import { PharmacyTicketNotices } from './PharmacyTicketNotices';
import { usePharmacyTicket } from './usePharmacyTicket';
import type { useShiftHandoff } from './handoff/useShiftHandoff';
import type { SaleDelivery } from './useSaleDelivery';

const LazySalesQuickAccess = lazy(() =>
  import('@/features/sales/SalesQuickAccess').then(module => ({ default: module.SalesQuickAccess }))
);

const LazySalesHistoryDrawerContent = lazy(() =>
  import('@/features/sales/SalesHistoryDrawerContent').then(module => ({
    default: module.SalesHistoryDrawerContent,
  }))
);

const LazyTillIncidentSheet = lazy(() => import('@/features/sales/incidents/TillIncidentSheet'));
const LazyTillReturnSheet = lazy(() => import('@/features/sales/returns/TillReturnSheet'));

const LazySalesModals = lazy(() =>
  import('@/features/sales/SalesModals').then(module => ({
    default: module.SalesModals,
  }))
);

const LazyCashSessionModals = lazy(() =>
  import('@/features/sales/CashSessionModals').then(module => ({
    default: module.CashSessionModals,
  }))
);

const LazyCustomerTillPaymentDialog = lazy(() => import('./CustomerTillPaymentDialog'));
const LazySaleDeliverySheet = lazy(() => import('./SaleDeliverySheet'));

const LazySuspendedSalesPanel = lazy(() =>
  import('@/features/sales/SuspendedSalesPanel').then(module => ({
    default: module.SuspendedSalesPanel,
  }))
);

type HeaderProps = ComponentProps<typeof SalesHeaderSection>;
type TabsProps = ComponentProps<typeof WorkspaceTabsSection>;
type CartProps = ComponentProps<typeof SalesCartWorkspace>;
type CheckoutProps = ComponentProps<typeof SalesCheckoutPanel>;
type SuspendedProps = ComponentProps<typeof SuspendedSalesPanel>;
type ModalsProps = ComponentProps<typeof SalesModals>;
type CashModalsProps = ComponentProps<typeof CashSessionModals>;

/**
 * Props for {@link SalesScreen}.
 *
 * slice 16b-2 — SalesPage's entire `return` JSX was relocated here so
 * the shell drops below the 500-LOC ceiling. SalesScreen is PURELY
 * presentational: it owns no state, runs no queries/mutations, and forwards
 * every value/handler to the already-extracted child components. The shell
 * assembles these props from its hooks. Forwarded handler/ref types are pinned
 * to the child components via `ComponentProps` indexed access so the seam
 * cannot drift; the tRPC query/mutation objects the old JSX read inline are
 * passed as DERIVED values instead (`isCashSessionLoading`, the four
 * `is*ing*` pending flags) so a presentational component never touches a
 * query/mutation handle. History owns its secondary query behind the drawer's
 * lazy boundary.
 */
export interface SalesScreenProps {
  // Header + product search
  productSearchQuery: string;
  setProductSearchQuery: Dispatch<SetStateAction<string>>;
  handleOpenProductSearch: (initialQuery?: string) => void;
  productInputRef: ComponentProps<typeof SalesQuickSearchBar>['inputRef'];
  onCameraCode: (code: string) => void;
  onTypedCode?: (query: string) => Promise<boolean>;
  setIsHistoryDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setIsSuspendedPanelOpen: Dispatch<SetStateAction<boolean>>;
  suspendedDraftsCount: number;
  customerDisplayEnabled: boolean;
  handleOpenCustomerDisplay: () => void;
  isResumedCart: boolean;
  isQuotationCart: boolean;
  itemsLocked: boolean;
  /** The parked-sales zone is on for this register. */
  parksSales: boolean;
  /** Shared with the keyboard shortcut so Suspender and Ctrl+P never disagree. */
  canSuspendActiveCart: boolean;
  activeWorkspace: HeaderProps['activeWorkspace'];
  // Workspace tabs
  ownedWorkspaces: TabsProps['ownedWorkspaces'];
  handleSelectWorkspace: TabsProps['onSelectWorkspace'];
  // Cart workspace
  cartItems: CartProps['items'];
  activeSelectedCartItemKey: CartProps['selectedItemKey'];
  draftSummary: CheckoutProps['draftSummary'];
  approvalDiscountAmount: number;
  currencyCode: string;
  favoriteScopeKey: string;
  saleError: CartProps['saleError'];
  handleQuantityChange: CartProps['onQuantityChange'];
  handleDiscountChange: CartProps['onDiscountChange'];
  handleSerialSelectionChange: CartProps['onSerialSelectionChange'];
  handleUnitChange: NonNullable<CartProps['onUnitChange']>;
  handleRemoveItem: CartProps['onRemove'];
  setSelectedCartItemKey: CartProps['onSelectItem'];
  handleClearCart: CartProps['onClearCart'];
  quantityInputRefFor: CartProps['quantityInputRefFor'];
  discountInputRefFor: CartProps['discountInputRefFor'];
  canUndoActiveCart: boolean;
  handleUndoCart: () => void;
  // customer price tier for the active ticket.
  activePriceTier: 1 | 2 | 3;
  handlePriceTierChange: (tier: 1 | 2 | 3) => void;
  // Checkout panel
  currentSite: CheckoutProps['currentSite'];
  activeCashSession: CheckoutProps['cashSession'];
  registerAssignments: CheckoutProps['registerAssignments'];
  selectedRegisterAssignment: CheckoutProps['selectedRegisterAssignment'];
  isCashSessionLoading: boolean;
  canCharge: boolean;
  canOpenCashSession: boolean;
  canCloseCashSession: boolean;
  userRole: CheckoutProps['userRole'];
  handleOpenPaymentModal: (
    fastCash?: boolean,
    tendered?: number | null,
    focusTarget?: PaymentFocusTarget | null
  ) => void;
  /** Opens (or re-applies) cash with the tendered amount; exact when omitted. */
  handleFastCash: (tendered?: number | null) => void;
  fastCashAmount: number | null;
  paymentFocusTarget: PaymentFocusTarget | null;
  ticketTender: CheckoutProps['tender'] & {};
  onTicketTenderChange: CheckoutProps['onTenderChange'] & {};
  lastRead: LastRead | null;
  cashierName: string | null;
  firstSuspendedDraft: CheckoutProps['firstSuspendedDraft'];
  canRequestInvoice: boolean;
  handleOpenCashSessionModal: () => void;
  handleOpenCloseCashSessionModal: () => void;
  handleOpenCashSessionMovementModal: () => void;
  onKickCashDrawer: CheckoutProps['onKickCashDrawer'];
  isKickingCashDrawer: boolean;
  setSelectedRegisterAssignmentId: CheckoutProps['onRegisterAssignmentChange'];
  handleOpenSuspendPrompt: () => void;
  handleNewSale: () => void;
  handleToggleSuspendedPanel: () => void;
  hubReachable: CheckoutProps['hubReachable'];
  preflightItems: CheckoutProps['preflightItems'];
  /** Server readiness items; cart preflight drops them while the ticket is empty. */
  readinessItems: PreflightItem[];
  // History drawer
  isHistoryDrawerOpen: boolean;
  isIncidentSheetOpen: boolean;
  /** The site scanner's key gap, so the incident sheet can tell a scan from a hand. */
  scanGapMs: number;
  setIsIncidentSheetOpen: Dispatch<SetStateAction<boolean>>;
  lastSale: CompletedSaleSummary | null;
  completedSale: CompletedSaleSummary | null;
  /** «Entregar en obra» key and the sheet it opens. */
  saleDelivery: SaleDelivery;
  onDismissCompletedSale: () => void;
  setSelectedSaleId: Dispatch<SetStateAction<string | null>>;
  selectedHistorySaleId: string | null;
  setSelectedHistorySaleId: Dispatch<SetStateAction<string | null>>;
  // Suspended-sales drawer
  isSuspendedPanelOpen: boolean;
  handleResumeFromPanel: SuspendedProps['onResume'];
  // Sales modals (product search / payment / sale details / suspend prompt)
  isProductSearchOpen: boolean;
  shouldRenderQuickCreateProductGate: boolean;
  shouldRenderQuickCreateCustomerGate: boolean;
  productSearchDialogKey: number;
  setIsProductSearchOpen: Dispatch<SetStateAction<boolean>>;
  handleProductSelect: (selection: ProductSearchSelection, quantity?: number) => void;
  /** «¿Cuánto pesó?» for the by-weight product just picked; it takes the keys' place. */
  weighPanel?: ReactNode;
  commandBar: SalesCommandBar;
  productSearchInitialQuery: string;
  setCartItems: ModalsProps['setCartItems'];
  isPaymentModalOpen: boolean;
  paymentModalKey: number;
  isPaymentSaving: boolean;
  serviceChargeRate: number;
  cashRoundingStep?: number | null | undefined;
  fastCashTrigger: number;
  setIsPaymentModalOpen: Dispatch<SetStateAction<boolean>>;
  setFastCashTrigger: Dispatch<SetStateAction<number>>;
  handleCheckout: ModalsProps['onSubmitPayment'];
  selectedSaleId: ModalsProps['selectedSaleId'];
  isSuspendLabelPromptOpen: boolean;
  isSuspending: boolean;
  suspendLabelDraft: string;
  setSuspendLabelDraft: Dispatch<SetStateAction<string>>;
  setIsSuspendLabelPromptOpen: Dispatch<SetStateAction<boolean>>;
  handleSuspendConfirm: (restaurant?: {
    tableId: string;
    guestCount: number;
  }) => boolean | Promise<boolean>;
  // Cash-session modals
  isCashSessionModalOpen: boolean;
  cashSessionModalKey: number;
  isOpeningCashSession: boolean;
  cashSessionError: string | null;
  setIsCashSessionModalOpen: Dispatch<SetStateAction<boolean>>;
  handleCreateCashSession: CashModalsProps['onSubmitOpen'];
  isCashSessionCloseModalOpen: boolean;
  cashSessionCloseModalKey: number;
  isClosingCashSession: boolean;
  cashSessionCloseError: string | null;
  setIsCashSessionCloseModalOpen: Dispatch<SetStateAction<boolean>>;
  handleCloseCashSession: CashModalsProps['onSubmitClose'];
  isCashSessionMovementModalOpen: boolean;
  cashSessionMovementModalKey: number;
  cashSessionMovementType: CashModalsProps['cashSessionMovementType'];
  /** Hand-over and receive entry points with their sheets. */
  shiftHandoff: ReturnType<typeof useShiftHandoff>;
  isRecordingMovement: boolean;
  cashSessionMovementError: string | null;
  setIsCashSessionMovementModalOpen: Dispatch<SetStateAction<boolean>>;
  handleRecordCashMovement: CashModalsProps['onSubmitMovement'];
  /** the just-closed session whose day-close ritual is showing. */
  dayCloseSessionId: string | null;
  setDayCloseSessionId: Dispatch<SetStateAction<string | null>>;
}

/**
 * The presentational composition of the /sales POS screen: header + workspace
 * tabs + the cart/checkout grid + the mobile checkout bar + the history /
 * suspended drawers + the sales and cash-session modal clusters. All children
 * are already-extracted components; SalesScreen only wires them. Behavior is
 * owned entirely by SalesPage and its hooks — this file is render-only.
 */
export function SalesScreen({
  productSearchQuery,
  setProductSearchQuery,
  handleOpenProductSearch,
  productInputRef,
  onCameraCode,
  onTypedCode,
  setIsHistoryDrawerOpen,
  setIsSuspendedPanelOpen,
  suspendedDraftsCount,
  customerDisplayEnabled,
  handleOpenCustomerDisplay,
  isResumedCart,
  isQuotationCart,
  itemsLocked,
  parksSales,
  canSuspendActiveCart,
  activeWorkspace,
  ownedWorkspaces,
  handleSelectWorkspace,
  cartItems,
  activeSelectedCartItemKey,
  draftSummary,
  approvalDiscountAmount,
  currencyCode,
  favoriteScopeKey,
  saleError,
  handleQuantityChange,
  handleDiscountChange,
  handleSerialSelectionChange,
  handleUnitChange,
  handleRemoveItem,
  setSelectedCartItemKey,
  handleClearCart,
  quantityInputRefFor,
  discountInputRefFor,
  canUndoActiveCart,
  handleUndoCart,
  activePriceTier,
  handlePriceTierChange,
  currentSite,
  activeCashSession,
  registerAssignments,
  selectedRegisterAssignment,
  isCashSessionLoading,
  canCharge,
  canOpenCashSession,
  canCloseCashSession,
  userRole,
  handleOpenPaymentModal,
  handleFastCash,
  fastCashAmount,
  paymentFocusTarget,
  ticketTender,
  onTicketTenderChange,
  lastRead,
  cashierName,
  firstSuspendedDraft,
  canRequestInvoice,
  handleOpenCashSessionModal,
  handleOpenCloseCashSessionModal,
  handleOpenCashSessionMovementModal,
  onKickCashDrawer,
  isKickingCashDrawer,
  setSelectedRegisterAssignmentId,
  handleOpenSuspendPrompt,
  handleNewSale,
  handleToggleSuspendedPanel,
  hubReachable,
  preflightItems,
  readinessItems,
  isHistoryDrawerOpen,
  isIncidentSheetOpen,
  scanGapMs,
  setIsIncidentSheetOpen,
  lastSale,
  completedSale,
  saleDelivery,
  onDismissCompletedSale,
  setSelectedSaleId,
  selectedHistorySaleId,
  setSelectedHistorySaleId,
  isSuspendedPanelOpen,
  handleResumeFromPanel,
  isProductSearchOpen,
  shouldRenderQuickCreateProductGate,
  shouldRenderQuickCreateCustomerGate,
  productSearchDialogKey,
  setIsProductSearchOpen,
  handleProductSelect,
  weighPanel,
  commandBar,
  productSearchInitialQuery,
  setCartItems,
  isPaymentModalOpen,
  paymentModalKey,
  isPaymentSaving,
  serviceChargeRate,
  cashRoundingStep = null,
  fastCashTrigger,
  setIsPaymentModalOpen,
  setFastCashTrigger,
  handleCheckout,
  selectedSaleId,
  isSuspendLabelPromptOpen,
  isSuspending,
  suspendLabelDraft,
  setSuspendLabelDraft,
  setIsSuspendLabelPromptOpen,
  handleSuspendConfirm,
  isCashSessionModalOpen,
  cashSessionModalKey,
  isOpeningCashSession,
  cashSessionError,
  setIsCashSessionModalOpen,
  handleCreateCashSession,
  isCashSessionCloseModalOpen,
  cashSessionCloseModalKey,
  isClosingCashSession,
  cashSessionCloseError,
  setIsCashSessionCloseModalOpen,
  handleCloseCashSession,
  isCashSessionMovementModalOpen,
  cashSessionMovementModalKey,
  cashSessionMovementType,
  shiftHandoff,
  isRecordingMovement,
  cashSessionMovementError,
  setIsCashSessionMovementModalOpen,
  handleRecordCashMovement,
  dayCloseSessionId,
  setDayCloseSessionId,
}: SalesScreenProps) {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const isPhone = usePhoneLayout();
  const showsQuickKeys = useRegisterZone('quick-keys');
  const takesTips = useRegisterZone('tip-split');
  const sellsInUnits = useRegisterZone('units-cut');
  // Sales parked before the zone was switched off stay reachable.
  const showsSuspended = parksSales || suspendedDraftsCount > 0;

  // Buttons pass their click event, which must not read as the fast cash flag.
  const handleCharge = () => handleOpenPaymentModal();
  const showCompletedSale = completedSale !== null && cartItems.length === 0;
  const completedSalePrint = usePrintSaleReceipt();
  // WhatsApp opens the receipt with its share review already showing.
  const [shareReceiptOnOpen, setShareReceiptOnOpen] = useState(false);
  // Stable: the history table memoizes its columns on this callback.
  const openSaleDetails = useCallback(
    (saleId: string | null, share = false) => {
      setShareReceiptOnOpen(share);
      setSelectedSaleId(saleId);
    },
    [setSelectedSaleId]
  );
  const customerLocked = activeWorkspace ? isTicketCustomerFrozen(activeWorkspace) : false;
  const { canOpenDrawerFromDock, printerMissing } = getSalesDockGates({
    canCharge,
    hubReachable,
    readinessItems,
  });
  const lockedCustomerName =
    activeWorkspace?.serverCustomerName ??
    activeWorkspace?.sourceQuotationCustomerName ??
    activeWorkspace?.sourceReturnCustomerName ??
    null;
  const lockedCustomerId =
    activeWorkspace?.serverCustomerId ??
    activeWorkspace?.sourceQuotationCustomerId ??
    activeWorkspace?.sourceReturnCustomerId ??
    null;
  // A frozen ticket keeps its own customer; otherwise the one attached with @.
  const ticketCustomerId = customerLocked
    ? lockedCustomerId
    : (activeWorkspace?.customerId ?? null);
  const ticketCustomerName = customerLocked
    ? lockedCustomerName
    : (activeWorkspace?.customerName ?? null);
  const closeIncidentSheet = useCallback(
    () => setIsIncidentSheetOpen(false),
    [setIsIncidentSheetOpen]
  );
  const openIncidentSheet = useCallback(
    () => setIsIncidentSheetOpen(true),
    [setIsIncidentSheetOpen]
  );
  const [isReturnSheetOpen, setIsReturnSheetOpen] = useState(false);
  const openReturnSheet = useCallback(() => setIsReturnSheetOpen(true), []);
  const closeReturnSheet = useCallback(() => setIsReturnSheetOpen(false), []);
  const printSale = (saleId: string) => {
    void completedSalePrint.print(saleId).finally(() => {
      productInputRef.current?.focus();
    });
  };
  const registerActions = buildRegisterBarActions({
    suspend: canSuspendActiveCart ? handleOpenSuspendPrompt : undefined,
    returns: openReturnSheet,
    incident: openIncidentSheet,
    newSale: handleNewSale,
    openDrawer:
      activeCashSession && onKickCashDrawer && !isKickingCashDrawer
        ? () => void onKickCashDrawer()
        : undefined,
    suspended: suspendedDraftsCount > 0 ? handleToggleSuspendedPanel : undefined,
    charge: canCharge ? handleCharge : undefined,
    fastCash: canCharge ? () => handleFastCash() : undefined,
    undo: canUndoActiveCart ? handleUndoCart : undefined,
    catalog: itemsLocked ? undefined : () => handleOpenProductSearch(''),
    cashMovement: activeCashSession ? handleOpenCashSessionMovementModal : undefined,
    openCashSession: canOpenCashSession ? handleOpenCashSessionModal : undefined,
    closeCashSession:
      activeCashSession && canCloseCashSession && hubReachable !== false
        ? handleOpenCloseCashSessionModal
        : undefined,
  });
  // Mirrors the charge drawer: quotations carry no service charge; coin rounding applies to cash only.
  const dueWithService =
    draftSummary.total + percentOf(draftSummary.total, isQuotationCart ? 0 : serviceChargeRate);
  const exactDue = getPayableCartTotal({ total: dueWithService }, currencyCode).total;
  const cashDue = getPayableCartTotal(
    { total: dueWithService },
    currencyCode,
    cashRoundingStep
  ).total;

  const { sellsOnCredit, account: customerAccount } = useCustomerAccount(ticketCustomerId);
  const pharmacyTicket = usePharmacyTicket(cartItems, ticketCustomerId, currentSite?.id);
  const showsPharmacyNotices = pharmacyTicket.hasNotices;
  // On phones only one card names the customer.
  const pharmacyNamesCustomer = pharmacyTicket.customerNote?.missing === false;
  const [isTillPaymentOpen, setIsTillPaymentOpen] = useState(false);
  // With nothing on the ticket the projection would only repeat the debt the bar shows.
  const shownAccount = ticketCustomerName && hasAccount(customerAccount) ? customerAccount : null;
  const creditLimit = shownAccount?.creditLimit ?? 0;
  const creditProjectedBalance =
    shownAccount && exactDue > 0 ? roundMoney(shownAccount.balance + exactDue) : null;
  const handleCredit = canCharge
    ? () => {
        onTicketTenderChange('credit');
        // Credit needs a customer, so the drawer opens on the picker unless one is set.
        handleOpenPaymentModal(false, null, ticketCustomerId ? null : 'customer');
      }
    : undefined;
  // The abono needs something owed and an open register that takes the cash.
  const canPayAccount =
    !!ticketCustomerId &&
    !!shownAccount &&
    shownAccount.balance > 0 &&
    !!activeCashSession &&
    hubReachable !== false;
  // Closed for good once it cannot be paid, so it never reopens on its own later.
  if (isTillPaymentOpen && !canPayAccount) setIsTillPaymentOpen(false);

  // Resuming a sale means the shift is not ending yet, so the close stops here.
  const handleResumeSuspended: typeof handleResumeFromPanel = (draft, options) => {
    setIsCashSessionCloseModalOpen(false);
    return handleResumeFromPanel(draft, options);
  };

  return (
    <>
      {/* At `pos:` the shell is bounded and only the ticket scrolls; below it the
          page scrolls and the dock keeps the total and Cobrar pinned. The search
          input is the scanner target, so it stays mounted and visible. */}
      <div className="sales-pos-shell flex flex-col gap-3 lg:pb-4 pos:min-h-0 pos:overflow-hidden pos:pb-0">
        <SalesFlowRail
          itemCount={draftSummary.itemCount}
          total={getPayableCartTotal(draftSummary, currencyCode).total}
          hasCashSession={!!activeCashSession}
          canOpenCashSession={canOpenCashSession}
          canCharge={canCharge}
          canOpenSearch={!itemsLocked}
          hubReachable={hubReachable}
          preflightItems={preflightItems}
          onOpenCashSession={handleOpenCashSessionModal}
          onOpenSearch={() => handleOpenProductSearch()}
          onCharge={handleCharge}
        />

        <SalesHeaderSection
          registerName={activeCashSession?.registerName ?? null}
          cashierName={cashierName}
          siteName={currentSite?.name ?? null}
          onOpenHistory={() => setIsHistoryDrawerOpen(true)}
          onOpenSuspended={showsSuspended ? () => setIsSuspendedPanelOpen(true) : undefined}
          suspendedDraftsCount={suspendedDraftsCount}
          customerDisplayEnabled={customerDisplayEnabled}
          onOpenCustomerDisplay={handleOpenCustomerDisplay}
          isResumedCart={isResumedCart}
          activeWorkspace={activeWorkspace ?? null}
          workspaceTabs={
            <WorkspaceTabsSection
              ownedWorkspaces={ownedWorkspaces}
              activeWorkspaceId={activeWorkspace?.id}
              onSelectWorkspace={handleSelectWorkspace}
              onNewSale={handleNewSale}
            />
          }
          priceTier={activePriceTier}
          onPriceTierChange={itemsLocked ? undefined : handlePriceTierChange}
          status={
            <SalesStatusPills
              scannerLocked={itemsLocked}
              hasReceiptPrinter={!printerMissing}
              onConfigurePrinter={printerMissing?.recoveryAction?.onClick}
            />
          }
        />

        <section className="sales-workbench-grid pos:min-h-0 pos:flex-1">
          <SalesCartWorkspace
            items={cartItems}
            discountSuggestionSiteId={currentSite?.id ?? null}
            pharmacyLines={pharmacyTicket.lines}
            selectedItemKey={activeSelectedCartItemKey}
            saleError={saleError}
            onQuantityChange={handleQuantityChange}
            onDiscountChange={handleDiscountChange}
            onSerialSelectionChange={handleSerialSelectionChange}
            onUnitChange={sellsInUnits ? handleUnitChange : undefined}
            priceTier={activePriceTier}
            onRemove={handleRemoveItem}
            onSelectItem={setSelectedCartItemKey}
            onClearCart={handleClearCart}
            quantityInputRefFor={quantityInputRefFor}
            discountInputRefFor={discountInputRefFor}
            canUndo={canUndoActiveCart}
            // The banner carries undo while it shows a read; phones have no banner.
            onUndo={lastRead && !isPhone ? undefined : handleUndoCart}
            itemsLocked={itemsLocked}
            searchBar={
              <SalesQuickSearchBar
                query={productSearchQuery}
                onQueryChange={setProductSearchQuery}
                onSubmit={handleOpenProductSearch}
                inputRef={productInputRef}
                disabled={itemsLocked}
                pendingQuantity={commandBar.pendingQuantity}
                onPendingQuantityChange={commandBar.setPendingQuantity}
                actions={registerActions}
                attachedCustomerId={ticketCustomerId}
                onAttachCustomer={commandBar.attachCustomer}
                onCreateCustomer={commandBar.createCustomer}
                customers={commandBar.customers}
                isLoadingCustomers={commandBar.isLoadingCustomers}
                onCameraCode={onCameraCode}
                onSubmitCode={onTypedCode}
              />
            }
            banner={
              showCompletedSale ? (
                <SaleCompleteStrip
                  sale={completedSale}
                  onPrint={() => printSale(completedSale.id)}
                  isPrinting={completedSalePrint.isPrinting}
                  onShare={() => openSaleDetails(completedSale.id, true)}
                  onOpenReceipt={() => openSaleDetails(completedSale.id)}
                  onDismiss={() => {
                    onDismissCompletedSale();
                    // The button disappears with the strip; the cashier goes back to scanning.
                    productInputRef.current?.focus();
                  }}
                />
              ) : isPhone ? undefined : (
                <LastReadBanner
                  read={lastRead}
                  canUndo={canUndoActiveCart}
                  onUndo={handleUndoCart}
                />
              )
            }
            quickAccessFirst={isPhone}
            account={
              shownAccount || showsPharmacyNotices ? (
                <>
                  {showsPharmacyNotices && (
                    <PharmacyTicketNotices
                      customerNote={pharmacyTicket.customerNote}
                      hasControlled={pharmacyTicket.hasControlled}
                      // The dock names the customer except on phones, where it is hidden.
                      customerName={isPhone ? ticketCustomerName : null}
                      onAssignCustomer={
                        commandBar.attachCustomer && !customerLocked
                          ? () => {
                              // The @ grammar attaches the customer to this ticket.
                              setProductSearchQuery('@');
                              productInputRef.current?.focus();
                            }
                          : undefined
                      }
                    />
                  )}
                  {shownAccount && (
                    <CustomerAccountBar
                      account={shownAccount}
                      customerName={isPhone && !pharmacyNamesCustomer ? ticketCustomerName : null}
                      onPay={canPayAccount ? () => setIsTillPaymentOpen(true) : undefined}
                    />
                  )}
                </>
              ) : undefined
            }
            quickAccess={
              weighPanel ??
              (showsQuickKeys && !itemsLocked && currentSite && favoriteScopeKey ? (
                <Suspense
                  fallback={
                    <div
                      className="sales-quick-keys-loading motion-safe:animate-pulse"
                      role="status"
                      aria-label={t('common:actions.loading')}
                    />
                  }
                >
                  <LazySalesQuickAccess
                    key={favoriteScopeKey}
                    scopeKey={favoriteScopeKey}
                    siteId={currentSite.id}
                    canEdit={canAccessRole(userRole, managerOrAdminRoles)}
                    hasCartItems={cartItems.length > 0}
                    onSelectProduct={handleProductSelect}
                  />
                </Suspense>
              ) : undefined)
            }
          />

          <SalesCheckoutPanel
            currentSite={currentSite}
            cashSession={activeCashSession}
            registerAssignments={registerAssignments}
            selectedRegisterAssignment={selectedRegisterAssignment}
            isCashSessionLoading={isCashSessionLoading}
            draftSummary={draftSummary}
            lineCount={cartItems.length}
            discountAmount={approvalDiscountAmount}
            canCharge={canCharge}
            canOpenCashSession={canOpenCashSession}
            canCloseCashSession={canCloseCashSession}
            userRole={userRole}
            onCharge={handleCharge}
            onOpenCashSession={handleOpenCashSessionModal}
            onCloseCashSession={handleOpenCloseCashSessionModal}
            onHandOver={hubReachable !== false ? shiftHandoff.handOver : undefined}
            receiveHandoff={shiftHandoff.receive}
            onOpenMovement={handleOpenCashSessionMovementModal}
            onKickCashDrawer={onKickCashDrawer}
            isKickingCashDrawer={isKickingCashDrawer}
            onRegisterAssignmentChange={setSelectedRegisterAssignmentId}
            canSuspend={canSuspendActiveCart}
            onSuspend={handleOpenSuspendPrompt}
            suspendedDraftsCount={suspendedDraftsCount}
            firstSuspendedDraft={firstSuspendedDraft}
            onToggleSuspendedPanel={showsSuspended ? handleToggleSuspendedPanel : undefined}
            hubReachable={hubReachable}
            preflightItems={preflightItems}
            onFastCash={handleFastCash}
            tender={ticketTender}
            onTenderChange={onTicketTenderChange}
            cashDue={cashDue}
            customerName={ticketCustomerName}
            onPickCustomer={
              canOpenDrawerFromDock && !customerLocked
                ? () => handleOpenPaymentModal(false, null, 'customer')
                : undefined
            }
            onRequestInvoice={
              canOpenDrawerFromDock && canRequestInvoice
                ? () => handleOpenPaymentModal(false, null, 'invoice')
                : undefined
            }
            // While the completion strip shows the sale, the card would repeat it.
            lastSale={showCompletedSale ? null : lastSale}
            onOpenLastSale={() => {
              if (lastSale) openSaleDetails(lastSale.id);
            }}
            onOpenReturns={openReturnSheet}
            onOpenIncident={openIncidentSheet}
            isIncidentOpen={isIncidentSheetOpen}
            showsCreditKey={sellsOnCredit}
            onCredit={handleCredit}
            creditProjectedBalance={creditProjectedBalance}
            creditLimit={creditLimit}
            prescriptionLineCount={pharmacyTicket.prescriptionLineCount}
            showsDeliveryKey={saleDelivery.shown}
            onDelivery={hubReachable === false ? undefined : saleDelivery.onKey}
            deliveryActive={saleDelivery.active}
          />
        </section>

        <SalesShortcutStrip itemsLocked={itemsLocked} showsParked={showsSuspended} />
      </div>

      <SalesMobileCheckoutBar
        draftSummary={draftSummary}
        cashSession={activeCashSession}
        canCharge={canCharge}
        canOpenCashSession={canOpenCashSession}
        onCharge={handleCharge}
        onOpenCashSession={handleOpenCashSessionModal}
        receiveHandoff={shiftHandoff.receive}
        canSuspend={canSuspendActiveCart}
        onSuspend={handleOpenSuspendPrompt}
        showsSuspend={parksSales}
        showsCredit={sellsOnCredit}
        suspendedDraftsCount={suspendedDraftsCount}
        onToggleSuspendedPanel={showsSuspended ? handleToggleSuspendedPanel : undefined}
        onCredit={handleCredit}
        creditProjectedBalance={creditProjectedBalance}
        creditLimit={creditLimit}
        creditActive={ticketTender === 'credit'}
        hubReachable={hubReachable}
      />

      {/* Historial detrás de un cajón lateral. El header del
          Drawer aporta el botón de cerrar; la tabla conserva su propio
          título, por eso el Drawer va sin `title` (solo `ariaLabel`).
          `restoreFocusTo` devuelve el foco a la barra de búsqueda al cerrar
          para mantener el flujo continuo del cajero. */}
      {isIncidentSheetOpen && (
        <Suspense fallback={null}>
          <LazyTillIncidentSheet
            onClose={closeIncidentSheet}
            ticketTotal={draftSummary.total}
            scanGapMs={scanGapMs}
            product={incidentProductFor(cartItems, lastRead?.key, activeSelectedCartItemKey)}
            actions={{
              returns: openReturnSheet,
              voidSale: () =>
                lastSale ? openSaleDetails(lastSale.id) : setIsHistoryDrawerOpen(true),
              cashMovement: activeCashSession ? handleOpenCashSessionMovementModal : undefined,
              reprint: () => (lastSale ? printSale(lastSale.id) : setIsHistoryDrawerOpen(true)),
            }}
            restoreFocusTo={() => productInputRef.current}
          />
        </Suspense>
      )}

      {isReturnSheetOpen && (
        <Suspense fallback={null}>
          <LazyTillReturnSheet
            onClose={closeReturnSheet}
            restoreFocusTo={() => productInputRef.current}
          />
        </Suspense>
      )}

      {isHistoryDrawerOpen && (
        <Drawer
          isOpen
          onClose={() => setIsHistoryDrawerOpen(false)}
          ariaLabel={t('view.history')}
          size="lg"
          contentClassName="p-0"
          restoreFocusTo={() => productInputRef.current}
          testId="sales-history-drawer"
        >
          <Suspense fallback={null}>
            <LazySalesHistoryDrawerContent
              onView={openSaleDetails}
              selectedSaleId={selectedHistorySaleId}
              onSelectedSaleIdChange={setSelectedHistorySaleId}
            />
          </Suspense>
        </Drawer>
      )}

      {/* Ventas suspendidas detrás de un cajón lateral. El panel
          trae su propio header (título + cerrar), así que el Drawer va sin
          chrome (`showCloseButton={false}`, sin `title`). Ctrl+R sigue
          abriéndolo vía `handleToggleSuspendedPanel`. */}
      {isTillPaymentOpen && canPayAccount && ticketCustomerId && shownAccount && (
        <Suspense fallback={null}>
          <LazyCustomerTillPaymentDialog
            customerId={ticketCustomerId}
            customerName={ticketCustomerName ?? ''}
            balance={shownAccount.balance}
            onClose={() => setIsTillPaymentOpen(false)}
          />
        </Suspense>
      )}

      {saleDelivery.sale && currentSite && (
        <Suspense fallback={null}>
          <LazySaleDeliverySheet
            siteId={currentSite.id}
            sale={saleDelivery.sale}
            onClose={saleDelivery.close}
          />
        </Suspense>
      )}

      {isSuspendedPanelOpen && (
        <Drawer
          isOpen
          onClose={() => setIsSuspendedPanelOpen(false)}
          ariaLabel={t('park.panelTitle')}
          showCloseButton={false}
          size="lg"
          contentClassName="p-0"
          restoreFocusTo={() => productInputRef.current}
          testId="sales-suspended-drawer"
        >
          <Suspense fallback={null}>
            <LazySuspendedSalesPanel
              isOpen
              onClose={() => setIsSuspendedPanelOpen(false)}
              onResume={handleResumeSuspended}
            />
          </Suspense>
        </Drawer>
      )}

      {(isProductSearchOpen ||
        isPaymentModalOpen ||
        selectedSaleId !== null ||
        isSuspendLabelPromptOpen ||
        shouldRenderQuickCreateProductGate ||
        shouldRenderQuickCreateCustomerGate) && (
        <Suspense fallback={null}>
          <LazySalesModals
            isProductSearchOpen={isProductSearchOpen}
            discountSuggestionSiteId={currentSite?.id ?? null}
            productSearchDialogKey={productSearchDialogKey}
            onCloseProductSearch={() => setIsProductSearchOpen(false)}
            onSelectProduct={handleProductSelect}
            productSearchInitialQuery={productSearchInitialQuery}
            setCartItems={setCartItems}
            isPaymentModalOpen={isPaymentModalOpen}
            paymentModalKey={paymentModalKey}
            paymentTotal={draftSummary.total}
            paymentConsumptionTax={draftSummary.consumptionTaxAmount}
            paymentApprovalSaleId={activeWorkspace?.serverSaleId ?? null}
            paymentApprovalCustomerId={ticketCustomerId}
            paymentCustomerLocked={customerLocked}
            paymentLockedCustomerName={ticketCustomerName}
            paymentApprovalItems={cartItems}
            paymentApprovalDiscountAmount={approvalDiscountAmount}
            promotionPricingEnabled={!isQuotationCart}
            currencyCode={currencyCode}
            isPaymentSaving={isPaymentSaving}
            saleError={saleError}
            serviceChargeRate={isQuotationCart ? 0 : serviceChargeRate}
            cashRoundingStep={cashRoundingStep}
            allowTip={takesTips && !isQuotationCart}
            fastCashTrigger={fastCashTrigger}
            fastCashAmount={fastCashAmount}
            paymentInitialMethod={ticketTender}
            paymentFocusTarget={paymentFocusTarget}
            paymentRestoreFocusTo={() => productInputRef.current}
            activePriceTier={activePriceTier}
            onCustomerPriceTierChange={itemsLocked ? undefined : handlePriceTierChange}
            onClosePayment={() => {
              setIsPaymentModalOpen(false);
              setFastCashTrigger(0);
            }}
            onSubmitPayment={handleCheckout}
            selectedSaleId={selectedSaleId}
            shareReceiptOnOpen={shareReceiptOnOpen}
            onCloseSaleDetails={() => openSaleDetails(null)}
            onExchangeStarted={() => setIsHistoryDrawerOpen(false)}
            isSuspendLabelPromptOpen={isSuspendLabelPromptOpen}
            isSuspending={isSuspending}
            suspendLabelDraft={suspendLabelDraft}
            onChangeSuspendLabel={setSuspendLabelDraft}
            onCloseSuspendPrompt={() => {
              if (isSuspending) return;
              setIsSuspendLabelPromptOpen(false);
            }}
            onConfirmSuspend={handleSuspendConfirm}
          />
        </Suspense>
      )}

      {shiftHandoff.sheets}

      {(isCashSessionModalOpen ||
        isCashSessionCloseModalOpen ||
        isCashSessionMovementModalOpen ||
        dayCloseSessionId !== null) && (
        <Suspense fallback={null}>
          <LazyCashSessionModals
            isCashSessionModalOpen={isCashSessionModalOpen}
            cashSessionModalKey={cashSessionModalKey}
            isOpeningCashSession={isOpeningCashSession}
            cashSessionError={cashSessionError}
            selectedRegisterAssignment={selectedRegisterAssignment}
            onCloseOpenModal={() => setIsCashSessionModalOpen(false)}
            onSubmitOpen={handleCreateCashSession}
            isCashSessionCloseModalOpen={isCashSessionCloseModalOpen}
            cashSessionCloseModalKey={cashSessionCloseModalKey}
            activeCashSession={activeCashSession}
            isClosingCashSession={isClosingCashSession}
            cashSessionCloseError={cashSessionCloseError}
            onCloseCloseModal={() => setIsCashSessionCloseModalOpen(false)}
            onSubmitClose={handleCloseCashSession}
            suspendedDraftsCount={suspendedDraftsCount}
            isCloseModalHidden={isSuspendedPanelOpen}
            onReviewSuspended={() => setIsSuspendedPanelOpen(true)}
            isCashSessionMovementModalOpen={isCashSessionMovementModalOpen}
            cashSessionMovementModalKey={cashSessionMovementModalKey}
            cashSessionMovementType={cashSessionMovementType}
            isRecordingMovement={isRecordingMovement}
            cashSessionMovementError={cashSessionMovementError}
            onCloseMovementModal={() => setIsCashSessionMovementModalOpen(false)}
            onSubmitMovement={handleRecordCashMovement}
            dayCloseSessionId={dayCloseSessionId}
            onCloseDayClose={() => setDayCloseSessionId(null)}
          />
        </Suspense>
      )}
    </>
  );
}

/** The line just read, else the selected one, else the newest: what an incident is usually about. */
function incidentProductFor(
  items: readonly SaleCartItem[],
  readKey: string | undefined,
  selectedKey: string | null | undefined
) {
  const line =
    items.find(item => item.key === readKey) ??
    items.find(item => item.key === selectedKey) ??
    items.at(-1);
  if (!line) return null;
  return {
    id: line.productId,
    name: line.productName,
    // The catalog price, which the server records as the system price, not a tier price.
    price: line.unitEquivalence === 1 ? (line.tierPrices?.price ?? null) : null,
  };
}
