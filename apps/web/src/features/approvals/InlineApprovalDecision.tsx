import { ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagerApprovalAction } from '@puntovivo/shared/manager-approval';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';

interface InlineApprovalDecisionProps {
  action: ManagerApprovalAction;
  requestId: string;
  onDecided: () => Promise<void> | void;
}

/**
 * Fresh manager credential handoff for a blocked shared-terminal action.
 *
 * The cashier remains the authenticated session owner and keeps the exact cart
 * mounted. A different eligible manager/admin selects their identity and enters
 * a one-use staff PIN; the server records that person as the decision actor and
 * never returns or retains the credential.
 */
export function InlineApprovalDecision({
  action,
  requestId,
  onDecided,
}: InlineApprovalDecisionProps) {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const [approverId, setApproverId] = useState('');
  const [pin, setPin] = useState('');
  const input = useMemo(() => ({ action, requestId }), [action, requestId]);
  const approversQuery = trpc.managerApprovals.availableApprovers.useQuery(input, {
    staleTime: 0,
  });
  const configuredApprovers = useMemo(
    () => (approversQuery.data ?? []).filter(approver => approver.hasPin),
    [approversQuery.data]
  );
  const effectiveApproverId = configuredApprovers.some(approver => approver.id === approverId)
    ? approverId
    : (configuredApprovers[0]?.id ?? '');

  const decisionMutation = useCriticalMutation('managerApprovals.decideWithPin', {
    onSuccess: async () => {
      setPin('');
      await Promise.all([
        utils.managerApprovals.mine.invalidate(),
        utils.managerApprovals.availableApprovers.invalidate(input),
      ]);
      await onDecided();
      toast.success({ title: t('sales:approval.inline.success') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'common:userMenu.approvals.errorTitle',
      extra: () => setPin(''),
    }),
  });

  const approve = () => {
    if (!effectiveApproverId || pin.length !== 6 || decisionMutation.isPending) return;
    decisionMutation.mutate({
      requestId,
      approverId: effectiveApproverId,
      pin,
      decision: 'approved',
    });
  };

  return (
    <div
      className="mt-3 rounded-xl border border-primary-200 bg-primary-50/70 p-3"
      data-testid={`inline-approval-${action}`}
    >
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-700" aria-hidden="true" />
        <div>
          <p className="text-xs font-semibold text-primary-950">
            {t('sales:approval.inline.title')}
          </p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-primary-800">
            {t('sales:approval.inline.help')}
          </p>
        </div>
      </div>

      {approversQuery.isLoading ? (
        <p className="mt-3 text-xs text-primary-800" role="status">
          {t('common:userMenu.approvals.loading')}
        </p>
      ) : approversQuery.error ? (
        <div className="mt-3">
          <p className="text-xs text-danger-700" role="alert">
            {t('sales:approval.inline.loadError')}
          </p>
          <button
            type="button"
            className="btn-outline mt-2 w-full justify-center text-xs"
            onClick={() => void approversQuery.refetch()}
          >
            {t('common:actions.retry')}
          </button>
        </div>
      ) : configuredApprovers.length === 0 ? (
        <p className="mt-3 text-xs text-warning-800" role="status">
          {(approversQuery.data?.length ?? 0) > 0
            ? t('sales:approval.inline.pinMissing')
            : t('sales:approval.inline.empty')}
        </p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end">
          <label className="block">
            <span className="text-[11px] font-medium text-primary-950">
              {t('sales:approval.inline.approverLabel')}
            </span>
            <select
              className="input mt-1 h-10"
              value={effectiveApproverId}
              onChange={event => setApproverId(event.target.value)}
              disabled={decisionMutation.isPending}
            >
              {configuredApprovers.map(approver => (
                <option key={approver.id} value={approver.id}>
                  {approver.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-medium text-primary-950">
              {t('sales:approval.inline.pinLabel')}
            </span>
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={6}
              className="input mt-1 h-10 font-mono tracking-[0.3em]"
              value={pin}
              onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder={t('common:userMenu.approvals.pinPlaceholder')}
              disabled={decisionMutation.isPending}
            />
          </label>
          <button
            type="button"
            className="btn-primary h-10 justify-center text-xs"
            disabled={!effectiveApproverId || pin.length !== 6 || decisionMutation.isPending}
            onClick={approve}
          >
            {decisionMutation.isPending
              ? t('common:actions.loading')
              : t('sales:approval.inline.submit')}
          </button>
        </div>
      )}
    </div>
  );
}
