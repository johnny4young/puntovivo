import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppRouter } from '@puntovivo/server';
import type { inferRouterOutputs } from '@trpc/server';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { trpc } from '@/lib/trpc';

export type WalletChargeState =
  { mode: 'idle' } | inferRouterOutputs<AppRouter>['payments']['startWalletCharge'];

const POLL_MS = 2_000;

export interface WalletCharge {
  state: WalletChargeState;
  /** Operator-driven cancellation of the open Puntovivo attempt: stops the
   * UI, the polling and the provider charge when the rail supports it. It
   * never reverts a transfer the customer already sent — money that arrived
   * must still be reconciled against the store account. */
  cancelAttempt: () => void;
}

/**
 * Opens a provider charge for the settled transfer amount when a live wallet
 * rail is ready, and polls it until the provider decides. A new amount, another
 * method or a closed sheet cancels the open charge; a submitted sale keeps it.
 * If the provider had already approved a charge being left, the cashier is warned.
 */
export function useWalletCharge({
  siteId,
  amount,
  enabled,
  keepOnLeave,
}: {
  siteId: string;
  amount: number;
  enabled: boolean;
  keepOnLeave: boolean;
}): WalletCharge {
  const key = enabled && siteId.length > 0 && amount > 0 ? `${siteId}:${amount}` : null;
  const [result, setResult] = useState<{ key: string; state: WalletChargeState } | null>(null);
  const start = trpc.payments.startWalletCharge.useMutation();
  const cancel = trpc.payments.cancelWalletCharge.useMutation();
  const startRef = useRef(start.mutateAsync);
  const cancelRef = useRef(cancel.mutate);
  const keepRef = useRef(keepOnLeave);
  const chargeRef = useRef<{ chargeId: string; railLabel: string } | null>(null);
  const { t } = useTranslation('sales');
  const toast = useToast();
  const warnPaidRef = useRef((_rail: string) => {});
  useEffect(() => {
    startRef.current = start.mutateAsync;
    cancelRef.current = cancel.mutate;
    keepRef.current = keepOnLeave;
    warnPaidRef.current = rail =>
      toast.warning({ title: t('payment.wallet.leftApproved', { rail }) });
  });

  // One shared guard for both leaving paths: the sheet closes (amount, method
  // or unmount) and the explicit operator cancellation.
  const leave = useCallback(() => {
    const charge = chargeRef.current;
    if (!charge || keepRef.current) return;
    chargeRef.current = null;
    cancelRef.current(
      { chargeId: charge.chargeId },
      { onSuccess: left => left.status === 'approved' && warnPaidRef.current(charge.railLabel) }
    );
  }, []);

  useEffect(() => {
    if (key === null) return;
    let active = true;
    startRef
      .current({ siteId, amount })
      .then(state => {
        if (state.mode === 'live') chargeRef.current = { chargeId: state.chargeId, railLabel: state.railLabel };
        if (active) setResult({ key, state });
        else leave();
      })
      .catch(() => {
        if (active) setResult({ key, state: { mode: 'manual', providerUnavailable: true } });
      });
    return () => {
      active = false;
      leave();
    };
  }, [amount, key, leave, siteId]);

  const cancelAttempt = useCallback(() => {
    leave();
    setResult(null);
  }, [leave]);

  const started: WalletChargeState = result && result.key === key ? result.state : { mode: 'idle' };
  const live = started.mode === 'live' ? started : null;
  const status = trpc.payments.walletChargeStatus.useQuery(
    { chargeId: live?.chargeId ?? '' },
    {
      enabled: live?.status === 'pending',
      refetchInterval: query => (query.state.data?.status === 'pending' ? POLL_MS : false),
      staleTime: 0,
      gcTime: 0,
    }
  );

  if (!live) return { state: started, cancelAttempt };
  const polled = status.data?.chargeId === live.chargeId ? status.data.status : null;
  return { state: { ...live, status: polled ?? live.status }, cancelAttempt };
}
