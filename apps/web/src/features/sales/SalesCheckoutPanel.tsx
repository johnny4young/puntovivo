import {
  FileText,
  PauseCircle,
  TriangleAlert,
  Truck,
  Undo2,
  UserRound,
  WalletCards,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  CheckoutPreflightPanel,
  PREFLIGHT_PRIMARY_ELEMENT_ID,
} from '@/features/sales/CheckoutPreflightPanel';
import { SalesRegisterAssignmentField } from '@/features/sales/SalesRegisterAssignmentField';
import { SalesTenderPicker } from '@/features/sales/SalesTenderPicker';
import { SalesCreditKey } from '@/features/sales/SalesCreditKey';
import { useHardwareCopy } from '@/features/sales/useHardwareCopy';
import { initialsOf } from '@/features/sales/handoff/handoffModel';

import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { getPayableCartTotal } from '@/features/sales/saleCartTotals';
import { ariaKeyshortcutsFor, shortcutDisplayFor } from '@/lib/shortcuts';
import { roundMoney } from '@/lib/money';
import { formatCurrency } from '@/lib/utils';
import type { InitialTender } from '@/features/sales/salePaymentModal.types';
import type { PreflightItem } from '@/features/sales/useCheckoutPreflight';
import type { SaleCartSummary } from '@/features/sales/saleCart';
import type { CashSession, RegisterAssignment, Site } from '@/types';
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
  /** Ticket lines that need a prescription, named next to the item count. */
  prescriptionLineCount?: number | undefined;
  /** Sum of the manual line discounts already inside the total. */
  discountAmount?: number | undefined;
  canCharge: boolean;
  canOpenCashSession: boolean;
  onCharge: () => void;
  onOpenCashSession: () => void;
  receiveHandoff?: ReceivableHandoff | null | undefined;
  onRegisterAssignmentChange: (assignmentId: string | null) => void;
  canSuspend?: boolean | undefined;
  onSuspend?: (() => void) | undefined;
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
  /** Opens the till abono modal when the attached customer owes a balance. */
  onPayCustomerAccount?: (() => void) | undefined;
  /** Opens the charge drawer on its customer picker. */
  onPickCustomer?: (() => void) | undefined;
  /** Opens the charge drawer on the invoice request; omitted when the site cannot invoice. */
  onRequestInvoice?: (() => void) | undefined;
  /** Opens the sales history, where a return starts from its sale. */
  onOpenReturns?: (() => void) | undefined;
  onOpenIncident?: (() => void) | undefined;
  isIncidentOpen?: boolean | undefined;
  /** The register sells on credit: Fiar sits beside Cobrar. */
  showsCreditKey?: boolean | undefined;
  /** Opens the charge drawer on credit; absent while the ticket cannot be charged. */
  onCredit?: (() => void) | undefined;
  /** What the customer would owe after this ticket; null while unknown. */
  creditProjectedBalance?: number | null | undefined;
  creditLimit?: number | undefined;
  /** «Entregar en obra» sits in the charge row. */
  showsDeliveryKey?: boolean | undefined;
  /** Marks the ticket for delivery, or sends the sale just charged; absent when neither applies. */
  onDelivery?: (() => void) | undefined;
  /** The ticket goes out as a delivery once charged. */
  deliveryActive?: boolean | undefined;
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
  prescriptionLineCount = 0,
  discountAmount = 0,
  canCharge,
  canOpenCashSession,
  onCharge,
  onOpenCashSession,
  receiveHandoff = null,
  onRegisterAssignmentChange,
  canSuspend,
  onSuspend,
  hubReachable,
  preflightItems = [],
  onFastCash,
  tender = 'cash',
  onTenderChange = () => {},
  cashDue,
  customerName = null,
  onPayCustomerAccount,
  onPickCustomer,
  onRequestInvoice,
  onOpenReturns,
  onOpenIncident,
  isIncidentOpen = false,
  showsCreditKey = false,
  onCredit,
  creditProjectedBalance = null,
  showsDeliveryKey = false,
  onDelivery,
  deliveryActive = false,
  creditLimit = 0,
}: SalesCheckoutPanelProps) {
  const { t } = useTranslation('sales');
  const priceIncludesTax = usePriceIncludesTax();
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
  const { currency } = useResolvedLocale();
  const payable = getPayableCartTotal(draftSummary, currency);
  const totalText = formatCurrency(payable.total);
  const consumptionTax = draftSummary.consumptionTaxAmount ?? 0;
  const vatAmount = roundMoney(draftSummary.taxAmount - consumptionTax);
  const creditKeyShown = !!cashSession && showsCreditKey;
  const { t: th, ready: hardwareReady } = useHardwareCopy();
  const deliveryKeyShown = !!cashSession && showsDeliveryKey && hardwareReady;
  const sideKeysShown = creditKeyShown || deliveryKeyShown;

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
          {(onPickCustomer || onRequestInvoice || onPayCustomerAccount) && (
            <div className="hidden gap-1.5 lg:flex">
              {onPayCustomerAccount && (
                <button
                  type="button"
                  className="btn-outline min-h-11 px-2.5 text-[13px] font-medium"
                  onClick={onPayCustomerAccount}
                  data-testid="checkout-customer-pay"
                >
                  {t('sell.account.pay')}
                </button>
              )}
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
              {/* Medicines name their prescription lines; the label stays on one line in the dock. */}
              {prescriptionLineCount > 0 ? (
                <span data-testid="checkout-prescription-count">
                  {t('sell.total.prescriptions', { count: prescriptionLineCount })}
                </span>
              ) : (
                t('sell.total.lines', { count: lineCount })
              )}
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
            {(vatAmount > 0 || consumptionTax === 0) && (
              <div>
                <dt>{t(priceIncludesTax ? 'sell.total.taxIncluded' : 'checkout.vat')}</dt>
                <dd>{formatCurrency(vatAmount)}</dd>
              </div>
            )}
            {consumptionTax > 0 && (
              <div data-testid="checkout-consumption-tax">
                <dt>{t('sell.total.consumptionTaxIncluded')}</dt>
                <dd>{formatCurrency(consumptionTax)}</dd>
              </div>
            )}
            {payable.roundingAdjustment !== 0 && (
              <div data-testid="checkout-rounding">
                <dt>{t('sell.total.rounding')}</dt>
                <dd>{formatCurrency(payable.roundingAdjustment, undefined, undefined, 2)}</dd>
              </div>
            )}
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

        {!cashSession && (
          <section className="sales-mini-card text-sm text-fg2" data-testid="checkout-register">
            <h3 className="sales-cap">{t('cashSession.title')}</h3>
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
          </section>
        )}
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

        <div className={sideKeysShown ? 'sales-charge-row' : 'contents'}>
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
          {sideKeysShown && (
            <div className="sales-charge-side">
              {creditKeyShown && (
                <SalesCreditKey
                  className="sales-secondary-key sales-credit-key"
                  onClick={onCredit}
                  disabled={!onCredit || isHubGated || preflightHasBlockers}
                  projectedBalance={creditProjectedBalance}
                  creditLimit={creditLimit}
                  active={tender === 'credit'}
                  testId="checkout-credit"
                />
              )}
              {deliveryKeyShown && (
                <button
                  type="button"
                  className="sales-secondary-key sales-delivery-key"
                  onClick={onDelivery}
                  disabled={!onDelivery}
                  aria-pressed={deliveryActive}
                  data-active={deliveryActive || undefined}
                  data-testid="checkout-delivery"
                >
                  <Truck className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {th('delivery.key')}
                </button>
              )}
            </div>
          )}
        </div>

        {(showSuspendAction || onOpenIncident || onOpenReturns) && (
          <div className="sales-park-row flex gap-1.5" data-testid="checkout-park-controls">
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
            {onOpenIncident && (
              <button
                type="button"
                className="sales-secondary-key sales-incident-key"
                onClick={onOpenIncident}
                aria-haspopup="dialog"
                aria-expanded={isIncidentOpen}
                data-testid="checkout-incident"
                aria-keyshortcuts={ariaKeyshortcutsFor('sales.incident')}
              >
                <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                {t('sell.actions.incident')}
                <kbd className="pv-kbd" aria-hidden="true">
                  {shortcutDisplayFor('sales.incident')}
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
