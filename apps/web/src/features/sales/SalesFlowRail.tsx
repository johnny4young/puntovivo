import { AlertTriangle, CheckCircle2, Search, WalletCards } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  PrimaryTaskButton,
  PrioritizedBanner,
  type PrioritizedBannerTone,
} from '@/components/experience';
import { Button } from '@/components/ui';
import type { PreflightItem } from '@/features/sales/useCheckoutPreflight';
import { formatCurrency } from '@/lib/utils';
import { ariaKeyshortcutsFor } from '@/lib/shortcuts';

interface SalesFlowRailProps {
  itemCount: number;
  total: number;
  hasCashSession: boolean;
  canOpenCashSession: boolean;
  canCharge: boolean;
  canOpenSearch?: boolean | undefined;
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
  canOpenSearch = true,
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
        shortcutId: undefined,
        ActionIcon: AlertTriangle,
        tone: 'critical' as PrioritizedBannerTone,
      };
    }

    if (!hasCashSession) {
      return {
        title: tOperation('openRegisterTitle'),
        description: tOperation('openRegisterDescription'),
        actionLabel: tSales('cashSession.openAction'),
        action: onOpenCashSession,
        actionDisabled: !canOpenCashSession,
        shortcutId: 'sales.openCashSession',
        ActionIcon: WalletCards,
        tone: 'warning' as PrioritizedBannerTone,
      };
    }

    if (itemCount === 0) {
      return {
        title: tOperation('startTitle'),
        description: tOperation('startDescription'),
        actionLabel: tSales('quickSearch.search'),
        action: onOpenSearch,
        actionDisabled: !canOpenSearch,
        shortcutId: canOpenSearch ? 'sales.productSearch' : undefined,
        ActionIcon: Search,
        tone: 'neutral' as PrioritizedBannerTone,
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
        shortcutId: undefined,
        ActionIcon: AlertTriangle,
        tone: 'critical' as PrioritizedBannerTone,
      };
    }

    return {
      title: tOperation('reviewTitle'),
      description: tOperation('reviewDescription'),
      actionLabel: tSales('checkout.chargeSale'),
      action: onCharge,
      actionDisabled: !canCharge,
      shortcutId: 'sales.charge',
      ActionIcon: CheckCircle2,
      tone: 'ready' as PrioritizedBannerTone,
    };
  })();

  const { title, description, actionLabel, action, actionDisabled, shortcutId, ActionIcon, tone } =
    operation;

  const optionalMessage = optionalWarning
    ? optionalWarning.messageValues
      ? tSales(optionalWarning.messageKey, optionalWarning.messageValues)
      : tSales(optionalWarning.messageKey)
    : null;

  return (
    <PrioritizedBanner
      icon={ActionIcon}
      eyebrow={tOperation('nextStep')}
      title={title}
      description={description}
      tone={tone}
      density="compact"
      aria-label={tOperation('ariaLabel')}
      testId="sales-operation-strip"
      metaClassName="w-full @xl:w-auto"
      meta={
        <div
          className="grid min-w-[13rem] grid-cols-2 overflow-hidden rounded-xl border border-secondary-200/70 bg-surface-2/85"
          aria-live="polite"
          aria-atomic="true"
        >
          <div className="flex min-w-0 flex-col justify-center px-3 py-2">
            <span className="text-[0.58rem] font-bold uppercase tracking-[0.16em] text-primary-800">
              {hasCashSession ? tOperation('registerOpen') : tOperation('registerClosed')}
            </span>
            <strong className="mt-0.5 font-mono text-sm text-secondary-950">
              {tOperation('items', { count: itemCount })}
            </strong>
          </div>
          <div className="flex min-w-0 flex-col justify-center border-l border-secondary-200/70 px-3 py-2">
            <span className="text-[0.58rem] font-bold uppercase tracking-[0.16em] text-primary-800">
              {tOperation('total')}
            </span>
            <strong className="mt-0.5 font-mono text-sm text-secondary-950">
              {formatCurrency(total)}
            </strong>
          </div>
        </div>
      }
      actionClassName="hidden h-full min-w-40 @2xl:block"
      action={
        <PrimaryTaskButton
          className="h-full min-h-12 w-full justify-center shadow-[inset_4px_0_0_var(--success-500),inset_0_-3px_0_rgba(3,15,25,0.48)]"
          onClick={action}
          disabled={actionDisabled}
          aria-keyshortcuts={shortcutId ? ariaKeyshortcutsFor(shortcutId) : undefined}
          data-testid="checkout-primary-action"
          type="button"
        >
          <ActionIcon className="h-4 w-4" aria-hidden="true" />
          {actionLabel}
        </PrimaryTaskButton>
      }
      details={
        optionalMessage && !primaryBlocker && !isHubBlocked ? (
          <details className="text-xs text-secondary-700">
            <summary className="w-fit max-w-full cursor-pointer font-bold">
              {tOperation('optionalSetup')}
            </summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p>{optionalMessage}</p>
              {optionalWarning?.recoveryAction && (
                <Button
                  type="button"
                  variant="ghost"
                  size="compact"
                  onClick={optionalWarning.recoveryAction.onClick}
                >
                  {tSales(optionalWarning.recoveryAction.labelKey)}
                </Button>
              )}
            </div>
          </details>
        ) : undefined
      }
    />
  );
}
