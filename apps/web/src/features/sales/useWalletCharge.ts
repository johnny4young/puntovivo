import { useEffect, useRef, useState } from 'react';
import type { AppRouter } from '@puntovivo/server';
import type { inferRouterOutputs } from '@trpc/server';

import { trpc } from '@/lib/trpc';

export type WalletChargeState =
  { mode: 'idle' } | inferRouterOutputs<AppRouter>['payments']['startWalletCharge'];

const POLL_MS = 2_000;

/**
 * Opens a provider charge for the settled transfer amount when a live wallet
 * rail is ready, and polls it until the provider decides. A new amount, another
 * method or a closed sheet cancels the open charge; a submitted sale keeps it.
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
}): WalletChargeState {
  const key = enabled && siteId.length > 0 && amount > 0 ? `${siteId}:${amount}` : null;
  const [result, setResult] = useState<{ key: string; state: WalletChargeState } | null>(null);
  const start = trpc.payments.startWalletCharge.useMutation();
  const cancel = trpc.payments.cancelWalletCharge.useMutation();
  const startRef = useRef(start.mutateAsync);
  const cancelRef = useRef(cancel.mutate);
  const keepRef = useRef(keepOnLeave);
  useEffect(() => {
    startRef.current = start.mutateAsync;
    cancelRef.current = cancel.mutate;
    keepRef.current = keepOnLeave;
  });

  useEffect(() => {
    if (key === null) return;
    let active = true;
    let chargeId: string | null = null;
    const leave = () => {
      if (chargeId && !keepRef.current) cancelRef.current({ chargeId });
    };
    startRef
      .current({ siteId, amount })
      .then(state => {
        if (state.mode === 'live') chargeId = state.chargeId;
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
  }, [amount, key, siteId]);

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

  if (!live) return started;
  const polled = status.data?.chargeId === live.chargeId ? status.data.status : null;
  return { ...live, status: polled ?? live.status };
}
