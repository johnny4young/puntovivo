import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CheckoutApprovalAction,
  CheckoutApprovalContext,
} from '@puntovivo/shared/checkout-approval';
import type { ManagerApprovalAction } from '@puntovivo/shared/manager-approval';
import {
  CHECKOUT_APPROVAL_RESOURCE_TYPE,
  serializeCheckoutApprovalContext,
} from '@puntovivo/shared/checkout-approval';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { hashCheckoutApprovalPayload } from './checkoutApprovals';

export type CheckoutApprovalStatus =
  'pending' | 'approved' | 'rejected' | 'cancelled' | 'executing' | 'consumed' | 'expired';

export interface ApprovalRequestView<Action extends ManagerApprovalAction = ManagerApprovalAction> {
  action: Action;
  requestId: string | null;
  status: CheckoutApprovalStatus | 'not_requested';
  decisionReason: string | null;
}

export type CheckoutApprovalView = ApprovalRequestView<CheckoutApprovalAction>;

export function useCheckoutApprovals(input: {
  actions: CheckoutApprovalAction[];
  context: CheckoutApprovalContext;
  summaryLabel: string;
  amountByAction: Partial<Record<CheckoutApprovalAction, number>>;
  currencyCode: string;
}) {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const serializedContext = useMemo(
    () => serializeCheckoutApprovalContext(input.context),
    [input.context]
  );
  const [hashedResource, setHashedResource] = useState<{
    source: string;
    resourceId: string;
  } | null>(null);
  const resourceId =
    hashedResource?.source === serializedContext ? hashedResource.resourceId : null;

  useEffect(() => {
    let active = true;
    void hashCheckoutApprovalPayload(serializedContext).then(nextResourceId => {
      if (active) {
        setHashedResource({ source: serializedContext, resourceId: nextResourceId });
      }
    });
    return () => {
      active = false;
    };
  }, [serializedContext]);

  const enabled = input.actions.length > 0 && resourceId !== null;
  const ownQuery = trpc.managerApprovals.mine.useQuery(
    { limit: 20 },
    {
      enabled,
      refetchInterval: enabled ? 2_000 : false,
    }
  );
  const requestMutation = useCriticalMutation('managerApprovals.request', {
    onSuccess: async (request, variables) => {
      if (
        request.resourceType === CHECKOUT_APPROVAL_RESOURCE_TYPE &&
        request.resourceId &&
        variables.checkoutContext
      ) {
        const submittedSource = serializeCheckoutApprovalContext(variables.checkoutContext);
        const canonicalResourceId = request.resourceId;
        // The server owns canonical checkout identity fields such as tenant
        // currency. Replace only the hash for the context this mutation
        // submitted; a newer context may already have finished hashing.
        setHashedResource(current =>
          current?.source === submittedSource
            ? { source: submittedSource, resourceId: canonicalResourceId }
            : current
        );
      }
      await utils.managerApprovals.mine.invalidate();
      toast.success({ title: t('sales:approval.requested') });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'sales:approval.requestError',
    }),
  });

  const views = useMemo<CheckoutApprovalView[]>(() => {
    const rows = ownQuery.data ?? [];
    return input.actions.map(action => {
      const request = resourceId
        ? rows.find(
            row =>
              row.action === action &&
              row.resourceType === CHECKOUT_APPROVAL_RESOURCE_TYPE &&
              row.resourceId === resourceId
          )
        : undefined;
      return {
        action,
        requestId: request?.id ?? null,
        status: request?.status ?? 'not_requested',
        decisionReason: request?.decisionReason ?? null,
      };
    });
  }, [input.actions, ownQuery.data, resourceId]);

  const approvalRequests = views.flatMap(view =>
    view.status === 'approved' && view.requestId
      ? [{ action: view.action, requestId: view.requestId }]
      : []
  );
  const allApproved =
    input.actions.length === 0 ||
    (resourceId !== null && approvalRequests.length === input.actions.length);

  const requestApproval = (action: CheckoutApprovalAction, reason: string) => {
    if (!resourceId || requestMutation.isPending) return;
    const amount = input.amountByAction[action];
    requestMutation.mutate({
      action,
      reason: reason.trim(),
      resourceType: CHECKOUT_APPROVAL_RESOURCE_TYPE,
      resourceId,
      checkoutContext: input.context,
      summary: {
        label: input.summaryLabel,
        ...(amount !== undefined ? { amount, currencyCode: input.currencyCode.toUpperCase() } : {}),
      },
    });
  };

  return {
    views,
    approvalRequests,
    allApproved,
    isHashing: input.actions.length > 0 && resourceId === null,
    isLoading: enabled && ownQuery.isLoading,
    error: ownQuery.error,
    isRequesting: requestMutation.isPending,
    requestApproval,
    refetch: ownQuery.refetch,
  };
}
