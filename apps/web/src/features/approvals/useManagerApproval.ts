import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ManagerApprovalAction } from '@puntovivo/shared/manager-approval';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import type { ApprovalRequestView } from '@/features/sales/useCheckoutApprovals';

export interface UseManagerApprovalInput<Action extends ManagerApprovalAction> {
  action: Action;
  resourceType: string;
  resourceId: string | null;
  summary: { label: string; amount?: number | undefined; currencyCode?: string | undefined };
  enabled: boolean;
}

/** ENG-106c3 — one exact non-checkout resource approval for the current actor. */
export function useManagerApproval<Action extends ManagerApprovalAction>(
  input: UseManagerApprovalInput<Action>
) {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const enabled = input.enabled && input.resourceId !== null;
  const ownQuery = trpc.managerApprovals.mine.useQuery(
    { limit: 20 },
    { enabled, refetchInterval: enabled ? 2_000 : false }
  );
  const requestMutation = useCriticalMutation('managerApprovals.request', {
    onSuccess: async () => {
      await utils.managerApprovals.mine.invalidate();
      toast.success({ title: t('sales:approval.requested') });
    },
    onError: onErrorToast(toast, t, { titleKey: 'sales:approval.requestError' }),
  });

  const view = useMemo<ApprovalRequestView<Action>>(() => {
    const request = input.resourceId
      ? (ownQuery.data ?? []).find(
          row =>
            row.action === input.action &&
            row.resourceType === input.resourceType &&
            row.resourceId === input.resourceId
        )
      : undefined;
    return {
      action: input.action,
      requestId: request?.id ?? null,
      status: request?.status ?? 'not_requested',
      decisionReason: request?.decisionReason ?? null,
      approvalsCollected: request?.approvalsCollected ?? 0,
      requiredApprovals: request?.requiredApprovals ?? 1,
    };
  }, [input.action, input.resourceId, input.resourceType, ownQuery.data]);

  const requestApproval = (action: Action, reason: string) => {
    if (!input.resourceId || action !== input.action || requestMutation.isPending) return;
    requestMutation.mutate({
      action,
      reason: reason.trim(),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      summary: input.summary,
    });
  };

  return {
    views: [view],
    approvalRequestId: view.status === 'approved' ? view.requestId : null,
    allApproved: !input.enabled || (view.status === 'approved' && view.requestId !== null),
    isLoading: enabled && ownQuery.isLoading,
    error: ownQuery.error,
    isRequesting: requestMutation.isPending,
    requestApproval,
    refetch: ownQuery.refetch,
  };
}
