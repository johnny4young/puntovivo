import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { useTenant } from '@/features/tenant/TenantProvider';
import {
  dispatchDrawerKick,
  type DrawerKickOutcome,
  type HubDrawerBytesPayload,
} from '@/features/sales/receiptPrinter';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';

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
}

/**
 * ENG-062 / ENG-074b — manager-gated cash-drawer kick.
 *
 * The button only renders when (a) the user role can kick (manager/admin)
 * and (b) an active cash drawer is registered for the site; otherwise
 * `onKickCashDrawer` is undefined and SalesCheckoutPanel hides the button.
 * `dispatchDrawerKick` collapses the device_local / site_hub / hub_client
 * decision into a single outcome the UI can toast on: in hub_client mode
 * it asks the hub for `peripherals.buildDrawerKickBytes` and pipes the
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
  const isManagerOrAdmin = user?.role === 'manager' || user?.role === 'admin';
  const kickCashDrawerMutation = trpc.peripherals.kickCashDrawer.useMutation();
  // `useMutation()` returns a fresh object on every render, so depend
  // only on the stable `mutateAsync` reference — keeps the kick
  // handler identity stable without breaking exhaustive-deps.
  const kickCashDrawerMutateAsync = kickCashDrawerMutation.mutateAsync;
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
  const handleKickCashDrawer = useCallback(async () => {
    if (!currentSite) return;
    const siteId = currentSite.id;
    try {
      const result = await dispatchDrawerKick({
        serverKick: async () => {
          const r = await kickCashDrawerMutateAsync({ siteId });
          return r as DrawerKickOutcome;
        },
        fetchHubDrawerBytes: async () => {
          const r = await utils.peripherals.buildDrawerKickBytes.fetch({ siteId });
          return r as HubDrawerBytesPayload;
        },
      });
      handleDrawerKickOutcome(result);
    } catch (err) {
      const description = translateServerError(err, t, t('errors:server.unknown'));
      toast.error({
        title: t('sales:printer.kickDrawerFailed'),
        description,
      });
    }
  }, [
    currentSite,
    handleDrawerKickOutcome,
    kickCashDrawerMutateAsync,
    t,
    toast,
    utils,
  ]);
  const onKickCashDrawer =
    isManagerOrAdmin && hasRegisteredDrawer && !!currentSite
      ? handleKickCashDrawer
      : undefined;

  return { onKickCashDrawer, isKickingCashDrawer: kickCashDrawerMutation.isPending };
}
