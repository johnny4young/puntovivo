import { Check, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import { CHECKOUT_APPROVAL_RESOURCE_TYPE } from '@puntovivo/shared/checkout-approval';

type ApprovalDecision = 'approved' | 'rejected';

interface ActiveDecision {
  requestId: string;
  decision: ApprovalDecision;
}

interface ApprovalDecisionFormProps extends ActiveDecision {
  approverId: string;
  onCancel: () => void;
  onDecided: () => void;
}

/** Keep the short-lived PIN inside the active card's mount lifecycle. */
function ApprovalDecisionForm({
  requestId,
  decision,
  approverId,
  onCancel,
  onDecided,
}: ApprovalDecisionFormProps) {
  const { t } = useTranslation(['common', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [pin, setPin] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const decisionMutation = useCriticalMutation('managerApprovals.decideWithPin', {
    onSuccess: async result => {
      await utils.managerApprovals.queue.invalidate();
      onDecided();
      toast.success({
        title:
          result.status === 'pending'
            ? t('common:userMenu.approvals.partialSuccess', {
                collected: result.approvalsCollected,
                required: result.requiredApprovals,
              })
            : result.status === 'approved'
              ? t('common:userMenu.approvals.approvedSuccess')
              : t('common:userMenu.approvals.rejectedSuccess'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'common:userMenu.approvals.errorTitle',
      extra: () => setPin(''),
    }),
  });

  const submitDecision = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pin.length !== 6) return;

    if (decision === 'rejected') {
      const reason = rejectionReason.trim();
      if (!reason) return;
      decisionMutation.mutate({
        requestId,
        approverId,
        pin,
        decision: 'rejected',
        reason,
      });
      return;
    }

    decisionMutation.mutate({
      requestId,
      approverId,
      pin,
      decision: 'approved',
    });
  };

  return (
    <form className="mt-2 space-y-2" onSubmit={submitDecision}>
      <label className="block">
        <span className="text-[11px] font-medium text-secondary-800">
          {t('common:userMenu.approvals.pinLabel')}
        </span>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          className="input mt-1 h-9 font-mono tracking-[0.35em]"
          value={pin}
          onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder={t('common:userMenu.approvals.pinPlaceholder')}
          disabled={decisionMutation.isPending}
          autoFocus
        />
      </label>
      {decision === 'rejected' && (
        <label className="block">
          <span className="text-[11px] font-medium text-secondary-800">
            {t('common:userMenu.approvals.rejectionReasonLabel')}
          </span>
          <textarea
            className="input mt-1 min-h-16 resize-y py-2 text-xs"
            maxLength={500}
            value={rejectionReason}
            onChange={event => setRejectionReason(event.target.value)}
            placeholder={t('common:userMenu.approvals.rejectionReasonPlaceholder')}
            disabled={decisionMutation.isPending}
          />
        </label>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          className={
            decision === 'approved'
              ? 'btn-primary flex-1 justify-center px-2 text-xs'
              : 'btn-danger flex-1 justify-center px-2 text-xs'
          }
          disabled={
            decisionMutation.isPending ||
            pin.length !== 6 ||
            (decision === 'rejected' && !rejectionReason.trim())
          }
        >
          {decision === 'approved'
            ? t('common:userMenu.approvals.confirmApprove')
            : t('common:userMenu.approvals.confirmReject')}
        </button>
        <button
          type="button"
          className="btn-outline justify-center px-2 text-xs"
          disabled={decisionMutation.isPending}
          onClick={onCancel}
        >
          {t('common:actions.cancel')}
        </button>
      </div>
    </form>
  );
}

/**
 * ENG-106c1 — compact manager/admin queue for shared terminals.
 *
 * The component mounts only while the user menu is open, so its five-second
 * polling interval costs nothing while the operator is elsewhere. Every
 * decision asks for the current approver's PIN again; no PIN or elevated
 * session is retained after the attempt.
 */
export function ManagerApprovalQueue() {
  const { t } = useTranslation('common');
  const [activeDecision, setActiveDecision] = useState<ActiveDecision | null>(null);
  const queueQuery = trpc.managerApprovals.queue.useQuery({ limit: 5 }, { refetchInterval: 5_000 });

  const startDecision = (requestId: string, decision: ApprovalDecision) => {
    setActiveDecision({ requestId, decision });
  };

  const cancelDecision = () => {
    setActiveDecision(null);
  };

  const items = queueQuery.data?.items ?? [];
  const hasPin = queueQuery.data?.approver.hasPin ?? false;
  const visibleActiveDecision =
    activeDecision && items.some(item => item.id === activeDecision.requestId)
      ? activeDecision
      : null;

  return (
    <section
      aria-labelledby="manager-approval-queue-title"
      className="mt-3 rounded-2xl border border-line bg-surface-2/70 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-secondary-950">
          <ShieldCheck className="h-4 w-4 shrink-0 text-primary-700" aria-hidden="true" />
          <h3
            id="manager-approval-queue-title"
            className="truncate text-xs font-semibold uppercase tracking-[0.12em]"
          >
            {t('common:userMenu.approvals.title')}
          </h3>
        </div>
        {!queueQuery.isLoading && !queueQuery.error && (
          <span className="rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-semibold text-primary-800">
            {items.length}
          </span>
        )}
      </div>

      {queueQuery.isLoading ? (
        <p className="mt-2 text-xs text-fg2">{t('common:userMenu.approvals.loading')}</p>
      ) : queueQuery.error ? (
        <div className="mt-2">
          <p role="alert" className="text-xs text-danger-700">
            {t('common:userMenu.approvals.errorTitle')}
          </p>
          <button
            type="button"
            className="btn-ghost mt-2 w-full justify-center px-3 text-xs"
            onClick={() => void queueQuery.refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('common:actions.retry')}
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="mt-2 text-xs text-fg2">{t('common:userMenu.approvals.empty')}</p>
      ) : (
        <>
          {!hasPin && (
            <p role="status" className="mt-2 rounded-xl bg-warning-50 p-2 text-xs text-warning-800">
              {t('common:userMenu.approvals.pinMissing')}
            </p>
          )}
          <p className="mt-2 text-[11px] text-fg2">{t('common:userMenu.approvals.freshPinHint')}</p>
          <div className="mt-2 max-h-96 space-y-2 overflow-y-auto pr-0.5">
            {items.map(item => {
              const isActive = visibleActiveDecision?.requestId === item.id;
              return (
                <article key={item.id} className="rounded-xl border border-line bg-card p-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-secondary-950">
                        {t(`common:userMenu.approvals.actions.${item.action}`)}
                      </p>
                      <p className="mt-0.5 truncate text-[11px] text-fg2">
                        {item.resourceType === CHECKOUT_APPROVAL_RESOURCE_TYPE
                          ? t('common:userMenu.approvals.checkoutSummary')
                          : item.summary.label}
                      </p>
                    </div>
                    {item.summary.amount !== undefined && item.summary.currencyCode && (
                      <span className="shrink-0 text-xs font-semibold text-secondary-950">
                        {formatCurrency(item.summary.amount, item.summary.currencyCode)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[11px] text-secondary-700">{item.reason}</p>
                  <p className="mt-1 text-[10px] text-fg2">
                    {t('common:userMenu.approvals.requestedBy', {
                      name: item.requesterName,
                      site: item.siteName,
                    })}
                  </p>
                  <p className="mt-0.5 text-[10px] text-fg2">
                    {t('common:userMenu.approvals.expiresAt', {
                      time: formatDateTime(item.expiresAt),
                    })}
                  </p>
                  {item.requiredApprovals > 1 && (
                    <p className="mt-1 text-[10px] font-semibold text-primary-800">
                      {t('common:userMenu.approvals.progress', {
                        collected: item.approvalsCollected,
                        required: item.requiredApprovals,
                      })}
                    </p>
                  )}

                  {isActive ? (
                    <ApprovalDecisionForm
                      key={`${item.id}:${visibleActiveDecision.decision}`}
                      requestId={item.id}
                      decision={visibleActiveDecision.decision}
                      approverId={queueQuery.data!.approver.id}
                      onCancel={cancelDecision}
                      onDecided={cancelDecision}
                    />
                  ) : (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        className="btn-primary flex-1 justify-center px-2 text-xs"
                        disabled={!hasPin || visibleActiveDecision !== null}
                        onClick={() => startDecision(item.id, 'approved')}
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('common:userMenu.approvals.approve')}
                      </button>
                      <button
                        type="button"
                        className="btn-outline flex-1 justify-center px-2 text-xs"
                        disabled={!hasPin || visibleActiveDecision !== null}
                        onClick={() => startDecision(item.id, 'rejected')}
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                        {t('common:userMenu.approvals.reject')}
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
