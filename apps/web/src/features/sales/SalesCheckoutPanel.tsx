import { FileText, PauseCircle, Undo2, UserRound, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CheckoutPreflightPanel,
  PREFLIGHT_PRIMARY_ELEMENT_ID,
} from '@/features/sales/CheckoutPreflightPanel';
import { CashierPaceStrip } from '@/features/sales/CashierPaceStrip';
import { SalesRegisterAssignmentField } from '@/features/sales/SalesRegisterAssignmentField';
import { SalesTenderPicker } from '@/features/sales/SalesTenderPicker';
import { SalesCreditKey } from '@/features/sales/SalesCreditKey';
import { initialsOf } from '@/features/sales/handoff/handoffModel';

import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import { ariaKeyshortcutsFor, shortcutDisplayFor } from '@/lib/shortcuts';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import type { CompletedSaleSummary } from '@/features/sales/SaleCompleteStrip';
import type { InitialTender } from '@/features/sales/salePaymentModal.types';
import type { PreflightItem } from '@/features/sales/useCheckoutPreflight';
import type { SaleCartSummary } from '@/features/sales/saleCart';
import type { CashSession, RegisterAssignment, Site, UserRole } from '@/types';
import type { ReceivableHandoff } from './handoff/useShiftHandoff';
import { Button, SeverityMark } from '@/components/ui';

interface SalesCheckoutPanelProps {
  currentSite: Site | null;
  cashSession: CashSession | null;
  registerAssignments: RegisterAssignment[];
  selectedRegisterAssignment: RegisterAssignment | null;
  isCashSessionLoading: boolean;
  draftSummary: SaleCartSummary;
  /** Number of ticket lines, next to the unit count. */
  lineCount?: number | undefined;
  /** Sum of the manual line discounts already inside the total. */
  discountAmount?: number | undefined;
  canCharge: boolean;
  canOpenCashSession: boolean;
  canCloseCashSession: boolean;
  /** selects blind-close versus supervised-close guidance. */
  userRole?: UserRole | undefined;
  onCharge: () => void;
  onOpenCashSession: () => void;
  onCloseCashSession: () => void;
  /** Mid-day hand-over to the next cashier; absent when it cannot run. */
  onHandOver?: (() => void) | undefined;
  receiveHandoff?: ReceivableHandoff | null | undefined;
  onOpenMovement: () => void;
  /** Hidden when undefined: no supported drawer or no sales role. */
  onKickCashDrawer?: (() => void | Promise<void>) | undefined;
  isKickingCashDrawer?: boolean | undefined;
  onRegisterAssignmentChange: (assignmentId: string | null) => void;
  canSuspend?: boolean | undefined;
  onSuspend?: (() => void) | undefined;
  suspendedDraftsCount?: number | undefined;
  /** The most recent suspended sale, named on the parked card. */
  firstSuspendedDraft?: { label: string; total: number } | null | undefined;
  onToggleSuspendedPanel?: (() => void) | undefined;
  /** `false` only in hub-client mode with the hub down: gates charge and open. */
  hubReachable?: boolean | undefined;
  /** Blockers disable Cobrar; warnings leave it enabled. */
  preflightItems?: readonly PreflightItem[] | undefined;
  /** Opens the charge drawer on cash with this amount tendered, or exact. */
  onFastCash?: ((tendered?: number | null) => void) | undefined;
  /** Tender remembered for this ticket. */
  tender?: InitialTender | undefined;
  onTenderChange?: ((tender: InitialTender) => void) | undefined;
  /** What a cash customer owes: the total plus any service charge. */
  cashDue?: number | undefined;
  /** Customer frozen on a resumed, quoted or exchange ticket. */
  customerName?: string | null | undefined;
  /** Opens the charge drawer on its customer picker. */
  onPickCustomer?: (() => void) | undefined;
  /** Opens the charge drawer on the invoice request; omitted when the site cannot invoice. */
  onRequestInvoice?: (() => void) | undefined;
  lastSale?: CompletedSaleSummary | null | undefined;
  onOpenLastSale?: (() => void) | undefined;
  /** Opens the sales history, where a return starts from its sale. */
  onOpenReturns?: (() => void) | undefined;
  /** The register sells on credit: Fiar sits beside Cobrar. */
  showsCreditKey?: boolean | undefined;
  /** Opens the charge drawer on credit; absent while the ticket cannot be charged. */
  onCredit?: (() => void) | undefined;
  /** What the customer would owe after this ticket; null while unknown. */
  creditProjectedBalance?: number | null | undefined;
  creditLimit?: number | undefined;
}

/** Characters of a condensed total that fit one line of the card. */
const TOTAL_FIT_CQI = 190;

// The sync backlog and the missing printer already have their own surfaces; so does a closed register.
const SHOWN_ELSEWHERE: ReadonlySet<PreflightItem['id']> = new Set([
  'sync_backlog',
  'receipt_hardware_missing',
]);

export function SalesCheckoutPanel({
  currentSite,
  cashSession,
  registerAssignments,
  selectedRegisterAssignment,
  isCashSessionLoading,
  draftSummary,
  lineCount = 0,
  discountAmount = 0,
  canCharge,
  canOpenCashSession,
  canCloseCashSession,
  userRole,
  onCharge,
  onOpenCashSession,
  onCloseCashSession,
  onHandOver,
  receiveHandoff = null,
  onOpenMovement,
  onKickCashDrawer,
  isKickingCashDrawer,
  onRegisterAssignmentChange,
  canSuspend,
  onSuspend,
  suspendedDraftsCount = 0,
  firstSuspendedDraft = null,
  onToggleSuspendedPanel,
  hubReachable,
  preflightItems = [],
  onFastCash,
  tender = 'cash',
  onTenderChange = () => {},
  cashDue,
  customerName = null,
  onPickCustomer,
  onRequestInvoice,
  lastSale = null,
  onOpenLastSale,
  onOpenReturns,
  showsCreditKey = false,
  onCredit,
  creditProjectedBalance = null,
  creditLimit = 0,
}: SalesCheckoutPanelProps) {
  const { t } = useTranslation('sales');
  const priceIncludesTax = usePriceIncludesTax();
  const hasSupervisedClose = userRole === 'admin' || userRole === 'manager';
  const isHubGated = hubReachable === false;
  const preflightHasBlockers = preflightItems.some(item => item.severity === 'blocker');
  const visiblePreflightItems = preflightItems.filter(
    item =>
      !SHOWN_ELSEWHERE.has(item.id) && (cashSession !== null || item.id !== 'cash_session_required')
  );
  const hasVisibleBlocker = visiblePreflightItems.some(item => item.severity === 'blocker');
  // Opening a register that is waiting to be received would discard its handoff.
  const receivesSelected = !cashSession && receiveHandoff?.isSelectedRegister === true;
  const primaryAction = cashSession
    ? onCharge
    : receivesSelected
      ? receiveHandoff!.open
      : onOpenCashSession;
  const primaryActionDisabled =
    isHubGated ||
    (cashSession ? !canCharge || preflightHasBlockers : !receivesSelected && !canOpenCashSession);
  const canFastCash = !!cashSession && canCharge && !isHubGated && !preflightHasBlockers;
  const isReady = canFastCash && visiblePreflightItems.length === 0;
  // Unavailable Suspend stays out of the tab order: a disabled key fails contrast.
  const showSuspendAction = !!onSuspend && canSuspend;
  const totalText = formatCurrency(draftSummary.total);
  const creditKeyShown = !!cashSession && showsCreditKey;

  return (
    <aside className="sales-settlement-dock" aria-labelledby="sales-dock-title">
      <h2 id="sales-dock-title" className="sr-only">
        {t('checkout.chargeSummary')}
      </h2>
      <div className="sales-dock-top">
        <div className="flex items-center gap-3">
          <span className="sales-avatar" aria-hidden="true">
            {customerName ? initialsOf(customerName) : <UserRound className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-base font-semibold text-fg1"
              data-testid="checkout-customer"
            >
              {customerName ?? t('payment.walkIn')}
            </p>
            {!customerName && (
              <p className="truncate text-xs text-fg3">{t('sell.customer.walkInHint')}</p>
            )}
          </div>
          {(onPickCustomer || onRequestInvoice) && (
            <div className="hidden gap-1.5 lg:flex">
              {onPickCustomer && (
                <button
                  type="button"
                  className="btn-outline min-h-11 min-w-11 gap-1.5 px-2.5 text-[13px]"
                  title={t('payment.customer')}
                  onClick={onPickCustomer}
                  data-testid="checkout-pick-customer"
                >
                  <UserRound className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only 2xl:not-sr-only">{t('payment.customer')}</span>
                  {/* Typing @ in the command bar is the faster way to the same pick. */}
                  <kbd className="pv-kbd hidden 2xl:inline-flex" aria-hidden="true">
                    @
                  </kbd>
                </button>
              )}
              {onRequestInvoice && (
                <button
                  type="button"
                  className="btn-outline min-h-11 min-w-11 gap-1.5 px-2.5 text-[13px]"
                  title={t('sell.customer.invoice')}
                  onClick={onRequestInvoice}
                  data-testid="checkout-request-invoice"
                >
                  <FileText className="h-4 w-4" aria-hidden="true" />
                  <span className="sr-only 2xl:not-sr-only">{t('sell.customer.invoice')}</span>
                </button>
              )}
            </div>
          )}
        </div>

        <div className="sales-total-card mt-3" data-testid="checkout-total">
          <div className="flex items-baseline justify-between gap-3">
            <span className="sales-cap">{t('sell.total.label')}</span>
            <span className="text-[13px] text-fg2">
              {t('sell.total.items', { count: draftSummary.itemCount })} ·{' '}
              {t('sell.total.lines', { count: lineCount })}
            </span>
          </div>
          <div
            className="sales-total-figure"
            style={{ fontSize: `min(8.5rem, ${TOTAL_FIT_CQI / Math.max(6, totalText.length)}cqi)` }}
          >
            {totalText}
          </div>
          <dl className="sales-total-breakdown">
            <div>
              <dt>{t('checkout.subtotal')}</dt>
              <dd>{formatCurrency(draftSummary.subtotal)}</dd>
            </div>
            {discountAmount > 0 && (
              <div className="text-success-700" data-testid="checkout-savings">
                <dt>{t('sell.total.savings')}</dt>
                <dd>−{formatCurrency(discountAmount)}</dd>
              </div>
            )}
            <div>
              <dt>{t(priceIncludesTax ? 'sell.total.taxIncluded' : 'checkout.vat')}</dt>
              <dd>{formatCurrency(draftSummary.taxAmount)}</dd>
            </div>
          </dl>
        </div>

        <p className="sr-only hidden lg:block" aria-live="polite" aria-atomic="true">
          {t('sell.total.items', { count: draftSummary.itemCount })} · {totalText}
        </p>
      </div>

      <div className="sales-dock-middle">
        {isReady && (
          <p className="flex items-start gap-2 text-sm" data-testid="checkout-ready">
            <SeverityMark severity="ready" />
            <span>
              <span className="font-semibold text-success-700">{t('sell.ready.title')}</span>
              <span className="text-fg3"> · {t('sell.ready.detail')}</span>
            </span>
          </p>
        )}

        {visiblePreflightItems.length > 0 && (
          <div className="hidden lg:block">
            <CheckoutPreflightPanel items={visiblePreflightItems} />
          </div>
        )}

        {isHubGated && (
          <p
            className="hidden text-xs text-danger-700 lg:block"
            data-testid="checkout-hub-gate-hint"
          >
            {t('checkout.hubGatedHint')}
          </p>
        )}

        <div className="hidden gap-2 lg:flex">
          {lastSale && onOpenLastSale && (
            <section className="sales-mini-card" data-testid="checkout-last-sale">
              <h3 className="sales-cap">{t('sell.lastSale.title')}</h3>
              <p className="mt-1 flex items-baseline justify-between gap-2">
                <b className="truncate font-mono text-[13px]">{lastSale.saleNumber}</b>
                <b className="font-numeric text-lg">{formatCurrency(lastSale.total)}</b>
              </p>
              <button
                type="button"
                className="sales-mini-link"
                onClick={onOpenLastSale}
                data-testid="sales-open-last-receipt"
              >
                {t('sell.lastSale.open')}
              </button>
            </section>
          )}
          {onToggleSuspendedPanel && (
            <section className="sales-mini-card" data-testid="checkout-parked">
              <h3 className="sales-cap">
                {t('sell.parked.title')} ·{' '}
                <span data-testid="suspended-drafts-badge">{suspendedDraftsCount}</span>
              </h3>
              {firstSuspendedDraft && (
                <p className="mt-1 flex items-baseline justify-between gap-2">
                  <b className="truncate text-[13px]">{firstSuspendedDraft.label}</b>
                  <b className="font-numeric text-lg">
                    {formatCurrency(firstSuspendedDraft.total)}
                  </b>
                </p>
              )}
              <button
                type="button"
                className="sales-mini-link"
                onClick={onToggleSuspendedPanel}
                data-testid="checkout-open-suspended-panel"
                aria-keyshortcuts={
                  suspendedDraftsCount > 0
                    ? ariaKeyshortcutsFor('sales.toggleSuspended')
                    : undefined
                }
              >
                {suspendedDraftsCount > 0 ? t('park.resumeAction') : t('park.panelTitle')}
                {suspendedDraftsCount > 0 && (
                  <kbd className="pv-kbd" aria-hidden="true">
                    {shortcutDisplayFor('sales.toggleSuspended')}
                  </kbd>
                )}
              </button>
            </section>
          )}
        </div>

        <section className="sales-mini-card text-sm text-fg2" data-testid="checkout-register">
          <h3 className="sales-cap">{t('cashSession.title')}</h3>
          {cashSession ? (
            <div className="mt-1 space-y-1.5">
              <p>
                {t('cashSession.openedAt')}: {formatDateTime(cashSession.openedAt)}
              </p>
              {/* opt-in pace HUD; renders nothing while off. */}
              <CashierPaceStrip hasActiveCashSession />
              <p className="text-xs text-fg3">
                {t(
                  hasSupervisedClose
                    ? 'cashSession.supervisedCloseHint'
                    : 'cashSession.blindCloseHint'
                )}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={onOpenMovement}
                  aria-keyshortcuts={ariaKeyshortcutsFor('sales.cashMovement')}
                >
                  {t('cashSession.recordMovementAction')}
                </button>
                {onKickCashDrawer && (
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={onKickCashDrawer}
                    disabled={isKickingCashDrawer}
                    data-testid="sales-kick-drawer"
                  >
                    {t('printer.kickDrawerCta')}
                  </button>
                )}
                {onHandOver && (
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={onHandOver}
                    data-testid="sales-hand-over"
                  >
                    {t('cashSession.handOverAction')}
                  </button>
                )}
                <button
                  type="button"
                  className="btn-outline"
                  onClick={onCloseCashSession}
                  disabled={isHubGated || !canCloseCashSession}
                  aria-keyshortcuts={ariaKeyshortcutsFor('sales.closeCashSession')}
                >
                  {t('cashSession.closeAction')}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 space-y-2">
              <SalesRegisterAssignmentField
                assignments={registerAssignments}
                selectedAssignment={selectedRegisterAssignment}
                disabled={!currentSite || isCashSessionLoading}
                onChange={onRegisterAssignmentChange}
              />
              <p>{t('cashSession.chargeBlocked')}</p>
              {receiveHandoff && !receivesSelected && (
                <button
                  type="button"
                  className="btn-outline"
                  onClick={receiveHandoff.open}
                  disabled={isHubGated}
                  data-testid="sales-receive-handoff"
                >
                  {t('cashSession.receiveAction', { register: receiveHandoff.registerName })}
                </button>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Pinned: the keys that charge stay where the hand already is. */}
      <div className="sales-dock-bottom">
        {cashSession && (
          <SalesTenderPicker
            tender={tender}
            onTenderChange={onTenderChange}
            cashDue={cashDue ?? draftSummary.total}
            onFastCash={canFastCash ? onFastCash : undefined}
          />
        )}

        <div className={creditKeyShown ? 'sales-charge-row' : 'contents'}>
        <Button
          className={cashSession ? 'sales-charge-key' : 'min-h-14 w-full text-base'}
          onClick={primaryAction}
          disabled={primaryActionDisabled}
          data-testid="checkout-primary-action"
          aria-keyshortcuts={ariaKeyshortcutsFor(
            cashSession ? 'sales.charge' : 'sales.openCashSession'
          )}
          aria-describedby={hasVisibleBlocker ? PREFLIGHT_PRIMARY_ELEMENT_ID : undefined}
          variant={cashSession ? 'charge' : 'primary'}
          type="button"
        >
          {!cashSession && <WalletCards className="h-5 w-5" aria-hidden="true" />}
          {cashSession
            ? t('checkout.chargeSale')
            : receivesSelected
              ? t('cashSession.receiveAction', { register: receiveHandoff!.registerName })
              : t('cashSession.openAction')}
          {cashSession && !primaryActionDisabled && (
            <kbd className="sales-charge-kbd" aria-hidden="true">
              {shortcutDisplayFor('sales.charge')}
            </kbd>
          )}
        </Button>
        {creditKeyShown && (
          <SalesCreditKey
            className="sales-secondary-key sales-credit-key"
            onClick={onCredit}
            disabled={!onCredit || isHubGated}
            projectedBalance={creditProjectedBalance}
            creditLimit={creditLimit}
            active={tender === 'credit'}
            testId="checkout-credit"
          />
        )}
        </div>

        {(showSuspendAction || onOpenReturns) && (
          <div className="flex gap-1.5" data-testid="checkout-park-controls">
            {showSuspendAction && (
              <button
                type="button"
                className="sales-secondary-key"
                onClick={onSuspend}
                data-testid="checkout-suspend"
                aria-keyshortcuts={ariaKeyshortcutsFor('sales.suspend')}
              >
                <PauseCircle className="h-4 w-4" aria-hidden="true" />
                {t('sell.actions.suspend')}
                <kbd className="pv-kbd" aria-hidden="true">
                  {shortcutDisplayFor('sales.suspend')}
                </kbd>
              </button>
            )}
            {onOpenReturns && (
              <button
                type="button"
                className="sales-secondary-key"
                onClick={onOpenReturns}
                data-testid="checkout-returns"
              >
                <Undo2 className="h-4 w-4" aria-hidden="true" />
                {t('sell.actions.returns')}
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
