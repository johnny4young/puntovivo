import { AlertTriangle, CheckCircle2, Search, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui';
import type { PreflightItem } from '@/features/sales/useCheckoutPreflight';
import { formatCurrency } from '@/lib/utils';

interface SalesFlowRailProps {
  itemCount: number;
  total: number;
  hasCashSession: boolean;
  canOpenCashSession: boolean;
  canCharge: boolean;
  hubReachable?: boolean | undefined;
  preflightItems?: readonly PreflightItem[] | undefined;
  onOpenCashSession: () => void;
  onOpenSearch: () => void;
  onCharge: () => void;
}

/**
 * Compact operational summary for the first POS viewport.
 *
 * The former three-stage hero explained the whole sale on every visit. This
 * strip instead exposes only current state, total, and the next valid action.
 * Technical readiness reminders stay behind an explicit disclosure.
 */
export function SalesFlowRail({
  itemCount,
  total,
  hasCashSession,
  canOpenCashSession,
  canCharge,
  hubReachable,
  preflightItems = [],
  onOpenCashSession,
  onOpenSearch,
  onCharge,
}: SalesFlowRailProps) {
  const { t: tOperation } = useTranslation('salesOperation');
  const { t: tSales } = useTranslation('sales');
  const primaryBlocker = preflightItems.find(item => item.severity === 'blocker');
  const optionalWarning = preflightItems.find(
    item => item.severity === 'warning' && item.id !== 'sync_backlog'
  );
  const isHubBlocked = hubReachable === false;

  const operation = (() => {
    if (isHubBlocked) {
      return {
        title: tOperation('blockedTitle'),
        description: tOperation('blockedDescription'),
        actionLabel: tSales('checkout.chargeSale'),
        action: onCharge,
        actionDisabled: true,
        ActionIcon: AlertTriangle,
      };
    }

    if (!hasCashSession) {
      return {
        title: tOperation('openRegisterTitle'),
        description: tOperation('openRegisterDescription'),
        actionLabel: tSales('cashSession.openAction'),
        action: onOpenCashSession,
        actionDisabled: !canOpenCashSession,
        ActionIcon: WalletCards,
      };
    }

    if (itemCount === 0) {
      return {
        title: tOperation('startTitle'),
        description: tOperation('startDescription'),
        actionLabel: tSales('quickSearch.search'),
        action: onOpenSearch,
        actionDisabled: false,
        ActionIcon: Search,
      };
    }

    if (primaryBlocker) {
      return {
        title: tOperation('reviewRequiredTitle'),
        description: primaryBlocker.messageValues
          ? tSales(primaryBlocker.messageKey, primaryBlocker.messageValues)
          : tSales(primaryBlocker.messageKey),
        actionLabel: primaryBlocker.recoveryAction
          ? tSales(primaryBlocker.recoveryAction.labelKey)
          : tSales('checkout.chargeSale'),
        action: primaryBlocker.recoveryAction?.onClick ?? onCharge,
        actionDisabled: !primaryBlocker.recoveryAction,
        ActionIcon: AlertTriangle,
      };
    }

    return {
      title: tOperation('reviewTitle'),
      description: tOperation('reviewDescription'),
      actionLabel: tSales('checkout.chargeSale'),
      action: onCharge,
      actionDisabled: !canCharge,
      ActionIcon: CheckCircle2,
    };
  })();

  const { title, description, actionLabel, action, actionDisabled, ActionIcon } = operation;

  const optionalMessage = optionalWarning
    ? optionalWarning.messageValues
      ? tSales(optionalWarning.messageKey, optionalWarning.messageValues)
      : tSales(optionalWarning.messageKey)
    : null;

  return (
    <section
      className="sales-operation-strip"
      aria-label={tOperation('ariaLabel')}
      data-testid="sales-operation-strip"
    >
      <div className="sales-operation-next">
        <span>{tOperation('nextStep')}</span>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>

      <div className="sales-operation-facts" aria-live="polite" aria-atomic="true">
        <div>
          <span>
            {hasCashSession
              ? tOperation('registerOpen')
              : tOperation('registerClosed')}
          </span>
          <strong>{tOperation('items', { count: itemCount })}</strong>
        </div>
        <div>
          <span>{tOperation('total')}</span>
          <strong>{formatCurrency(total)}</strong>
        </div>
      </div>

      {optionalMessage && !primaryBlocker && !isHubBlocked && (
        <details className="sales-operation-detail">
          <summary>{tOperation('optionalSetup')}</summary>
          <div>
            <p>{optionalMessage}</p>
            {optionalWarning?.recoveryAction && (
              <button type="button" onClick={optionalWarning.recoveryAction.onClick}>
                {tSales(optionalWarning.recoveryAction.labelKey)}
              </button>
            )}
          </div>
        </details>
      )}

      <Button
        className="sales-operation-action hidden min-h-12 justify-center lg:inline-flex"
        onClick={action}
        disabled={actionDisabled}
        data-testid="checkout-primary-action"
        variant="primary"
        type="button"
      >
        <ActionIcon className="h-4 w-4" aria-hidden="true" />
        {actionLabel}
      </Button>
    </section>
  );
}
