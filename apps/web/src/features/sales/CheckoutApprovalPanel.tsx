import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagerApprovalAction } from '@puntovivo/shared/manager-approval';
import type { ApprovalRequestView } from './useCheckoutApprovals';

interface CheckoutApprovalPanelProps<Action extends ManagerApprovalAction> {
  views: ApprovalRequestView<Action>[];
  isLoading: boolean;
  isHashing: boolean;
  isRequesting: boolean;
  hasError: boolean;
  onRequest: (action: Action, reason: string) => void;
  onRefresh: () => void;
  help?: string | undefined;
}

const RETRYABLE_STATUSES = new Set<ApprovalRequestView['status']>([
  'not_requested',
  'rejected',
  'cancelled',
  'consumed',
  'expired',
]);

/** ENG-106c2 — cashier-facing status, never an elevated manager session. */
export function CheckoutApprovalPanel<Action extends ManagerApprovalAction>({
  views,
  isLoading,
  isHashing,
  isRequesting,
  hasError,
  onRequest,
  onRefresh,
  help,
}: CheckoutApprovalPanelProps<Action>) {
  const { t } = useTranslation('sales');
  const [reasons, setReasons] = useState<Partial<Record<ManagerApprovalAction, string>>>({});

  if (views.length === 0) return null;

  return (
    <section
      className="rounded-xl border border-primary-200 bg-primary-50/60 p-4"
      aria-labelledby="checkout-approval-title"
      data-testid="checkout-approval-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary-700" aria-hidden="true" />
          <div>
            <h3 id="checkout-approval-title" className="text-sm font-semibold text-primary-950">
              {t('approval.title')}
            </h3>
            <p className="mt-0.5 text-xs text-primary-800">{help ?? t('approval.help')}</p>
          </div>
        </div>
        <button
          type="button"
          className="btn-ghost shrink-0 px-2 text-xs"
          onClick={onRefresh}
          disabled={isLoading || isHashing}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          {t('approval.refresh')}
        </button>
      </div>

      {hasError && (
        <p role="alert" className="mt-3 text-xs text-danger-700">
          {t('approval.statusError')}
        </p>
      )}

      <div className="mt-3 space-y-3">
        {views.map(view => {
          const reason = reasons[view.action] ?? '';
          const canRequest = RETRYABLE_STATUSES.has(view.status);
          return (
            <article
              key={view.action}
              className="rounded-lg border border-primary-200 bg-white p-3"
              data-testid={`checkout-approval-${view.action}`}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-secondary-950">
                  {t(`approval.actions.${view.action}`)}
                </p>
                <span
                  className={
                    view.status === 'approved'
                      ? 'rounded-full bg-success-100 px-2 py-0.5 text-xs font-medium text-success-800'
                      : view.status === 'rejected' || view.status === 'expired'
                        ? 'rounded-full bg-danger-100 px-2 py-0.5 text-xs font-medium text-danger-800'
                        : 'rounded-full bg-warning-100 px-2 py-0.5 text-xs font-medium text-warning-800'
                  }
                  role="status"
                  data-testid={`checkout-approval-status-${view.action}`}
                >
                  {isHashing || isLoading
                    ? t('approval.status.loading')
                    : t(`approval.status.${view.status}`)}
                </span>
              </div>

              {view.decisionReason && (
                <p className="mt-2 text-xs text-secondary-700">
                  {t('approval.decisionReason', { reason: view.decisionReason })}
                </p>
              )}

              {canRequest && !isHashing && !isLoading && (
                <div className="mt-3 space-y-2">
                  <label className="block">
                    <span className="text-xs font-medium text-secondary-800">
                      {t('approval.reasonLabel', {
                        action: t(`approval.actions.${view.action}`),
                      })}
                    </span>
                    <textarea
                      className="input mt-1 min-h-16 resize-y py-2 text-sm"
                      maxLength={500}
                      value={reason}
                      placeholder={t('approval.reasonPlaceholder')}
                      onChange={event =>
                        setReasons(current => ({
                          ...current,
                          [view.action]: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-primary w-full justify-center text-sm"
                    disabled={isRequesting || reason.trim().length < 3}
                    onClick={() => onRequest(view.action, reason)}
                  >
                    {isRequesting ? t('approval.requesting') : t('approval.request')}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}
