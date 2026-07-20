import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { useManagerApproval } from '@/features/approvals/useManagerApproval';
import { useTenant } from '@/features/tenant/TenantProvider';
import {
  dispatchDrawerKick,
  type DrawerKickOutcome,
  type HubDrawerBytesPayload,
} from '@/features/sales/receiptPrinter';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import type { CashDrawerApprovalModalProps } from './CashDrawerApprovalModal';

/**
 * Params for {@link useCashDrawerController}.
 *
 * `hasRegisteredDrawer` is derived in SalesPage from the SHARED
 * `peripherals.activeForSite` query (see {@link useReceiptAutoPrint} —
 * one subscription for scanner + drawer + auto-print), so it is passed in
 * rather than re-queried here.
 */
interface UseCashDrawerControllerParams {
  /** True when the active site has a registered escpos cash drawer. */
  hasRegisteredDrawer: boolean;
}

/**
 * Return shape of {@link useCashDrawerController}.
 *
 * `onKickCashDrawer` is `undefined` when the user role cannot kick or no
 * drawer is registered — SalesCheckoutPanel hides the button entirely in
 * that case. `isKickingCashDrawer` mirrors the underlying mutation's
 * pending state for the button spinner.
 */
interface UseCashDrawerControllerResult {
  onKickCashDrawer: (() => Promise<void>) | undefined;
  isKickingCashDrawer: boolean;
  approvalModal: CashDrawerApprovalModalProps;
}

/**
 * /  /  — role-aware cash-drawer kick.
 *
 * The button only renders when (a) the user has a sales role
 * and (b) an active cash drawer is registered for the site; otherwise
 * `onKickCashDrawer` is undefined and SalesCheckoutPanel hides the button.
 * `dispatchDrawerKick` collapses the device_local / site_hub / hub_client
 * decision into a single outcome the UI can toast on. Cashiers first consume
 * a one-time manager grant in every authority mode. In hub_client mode it
 * asks the hub for `peripherals.buildDrawerKickBytes` and pipes the
 * bytes through the local hardware bridge; otherwise it routes to the
 * server-managed `kickCashDrawer` mutation.
 *
 * Acyclic leaf: depends only on shell values + globals, never calls back
 * into the page.
 */
export function useCashDrawerController({
  hasRegisteredDrawer,
}: UseCashDrawerControllerParams): UseCashDrawerControllerResult {
  const { t } = useTranslation(['sales', 'errors', 'common']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { currentSite } = useTenant();
  const [isApprovalOpen, setIsApprovalOpen] = useState(false);
  const isSalesRole =
    user?.role === 'cashier' || user?.role === 'manager' || user?.role === 'admin';
  const isLossPreventionPolicyRole = user?.role === 'cashier' || user?.role === 'manager';
  const baselineNeedsApproval = user?.role === 'cashier';
  const shiftPolicyQueryEnabled =
    isLossPreventionPolicyRole && hasRegisteredDrawer && !!currentSite;
  const shiftPolicyQuery = trpc.lossPrevention.evaluateShiftAction.useQuery(
    { action: 'cash_drawer_open', siteId: currentSite?.id ?? '' },
    {
      enabled: shiftPolicyQueryEnabled,
      refetchInterval: shiftPolicyQueryEnabled ? 30_000 : false,
      refetchOnWindowFocus: true,
      staleTime: 0,
    }
  );
  const needsApproval = baselineNeedsApproval || shiftPolicyQuery.data?.requiresApproval === true;
  const policyBlocked =
    shiftPolicyQueryEnabled && (shiftPolicyQuery.isFetching || shiftPolicyQuery.error !== null);
  const refetchShiftPolicy = shiftPolicyQuery.refetch;
  const kickCashDrawerMutation = useCriticalMutation('peripherals.kickCashDrawer');
  const buildDrawerKickBytesMutation = useCriticalMutation('peripherals.buildDrawerKickBytes');
  const approval = useManagerApproval({
    action: 'cash_drawer_open',
    resourceType: 'site',
    resourceId: currentSite?.id ?? null,
    summary: { label: currentSite?.name ?? '' },
    enabled: isApprovalOpen && needsApproval && hasRegisteredDrawer && !!currentSite,
  });
  // `useMutation()` returns a fresh object on every render, so depend
  // only on the stable `mutateAsync` reference — keeps the kick
  // handler identity stable without breaking exhaustive-deps.
  const kickCashDrawerMutateAsync = kickCashDrawerMutation.mutateAsync;
  const buildDrawerKickBytesMutateAsync = buildDrawerKickBytesMutation.mutateAsync;
  const handleDrawerKickOutcome = useCallback(
    (result: DrawerKickOutcome) => {
      if (result.status === 'ok') {
        toast.success({ title: t('sales:printer.kickDrawerSuccess') });
      } else if (result.status === 'no-drawer-registered') {
        toast.info({ title: t('sales:printer.noDrawerRegistered') });
      } else {
        toast.error({
          title: t('sales:printer.kickDrawerFailed'),
          description: result.errorMessage ?? result.error ?? '',
        });
      }
    },
    [t, toast]
  );
  const handleKickCashDrawer = useCallback(
    async (approvalRequestId?: string) => {
      if (!currentSite) return;
      const siteId = currentSite.id;
      try {
        const result = await dispatchDrawerKick({
          serverKick: async () => {
            const r = await kickCashDrawerMutateAsync({
              siteId,
              ...(approvalRequestId ? { approvalRequestId } : {}),
            });
            return r as DrawerKickOutcome;
          },
          fetchHubDrawerBytes: async () => {
            const r = await buildDrawerKickBytesMutateAsync({
              siteId,
              ...(approvalRequestId ? { approvalRequestId } : {}),
            });
            return r as HubDrawerBytesPayload;
          },
        });
        handleDrawerKickOutcome(result);
        setIsApprovalOpen(false);
      } catch (err) {
        const description = translateServerError(err, t, t('errors:server.unknown'));
        toast.error({
          title: t('sales:printer.kickDrawerFailed'),
          description,
        });
      } finally {
        if (approvalRequestId) {
          await utils.managerApprovals.mine.invalidate();
        }
        if (shiftPolicyQueryEnabled) {
          await refetchShiftPolicy();
        }
      }
    },
    [
      buildDrawerKickBytesMutateAsync,
      currentSite,
      handleDrawerKickOutcome,
      kickCashDrawerMutateAsync,
      t,
      toast,
      utils,
      refetchShiftPolicy,
      shiftPolicyQueryEnabled,
    ]
  );
  const onKickCashDrawer =
    isSalesRole && hasRegisteredDrawer && !!currentSite
      ? async () => {
          if (needsApproval || policyBlocked) {
            setIsApprovalOpen(true);
            return;
          }
          if (shiftPolicyQueryEnabled) {
            const refreshed = await shiftPolicyQuery.refetch();
            if (refreshed.error || refreshed.data?.requiresApproval) {
              setIsApprovalOpen(true);
              return;
            }
          }
          await handleKickCashDrawer();
        }
      : undefined;

  const isKickingCashDrawer =
    kickCashDrawerMutation.isPending || buildDrawerKickBytesMutation.isPending;

  const approvalModal: CashDrawerApprovalModalProps = {
    isOpen: isApprovalOpen,
    isLoading: approval.isLoading || shiftPolicyQuery.isFetching,
    isRequesting: approval.isRequesting,
    isDispatching: isKickingCashDrawer,
    hasError: approval.error !== null || shiftPolicyQuery.error !== null,
    allApproved: !policyBlocked && (!needsApproval || approval.allApproved),
    views: approval.views,
    onRequest: approval.requestApproval,
    onRefresh: () =>
      void Promise.all([
        approval.refetch(),
        ...(shiftPolicyQueryEnabled ? [shiftPolicyQuery.refetch()] : []),
      ]),
    onClose: () => {
      if (!isKickingCashDrawer) setIsApprovalOpen(false);
    },
    onConfirm: () => {
      if (policyBlocked || (needsApproval && !approval.approvalRequestId)) return;
      void handleKickCashDrawer(approval.approvalRequestId ?? undefined);
    },
  };

  return { onKickCashDrawer, isKickingCashDrawer, approvalModal };
}
