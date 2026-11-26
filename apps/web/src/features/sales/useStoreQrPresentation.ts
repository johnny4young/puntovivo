import { useEffect, useRef, useState } from 'react';

import { roundMoney } from '@/lib/money';
import { trpc } from '@/lib/trpc';
import type { SaleTransferPresentation } from './salePaymentModal.types';
import { getOrCreatePresentationKey } from './transferPresentation';

interface UseStoreQrPresentationParams {
  siteId: string;
  /** Destination actually on screen, or null when the store QR is hidden. */
  destinationId: string | null;
  amount: number;
  /** True only when the store QR is the thing the customer is scanning. */
  enabled: boolean;
  onChange: (presentation: SaleTransferPresentation | null) => void;
}

interface StartedPresentation {
  key: string;
  id: string;
  destinationId: string;
  amount: number;
}

/**
 * Records the static store QR as a presentation while it is on screen.
 *
 * The QR never waits for this call: offline or a downed server simply leaves
 * the presentation unlinked, which the cashier can still sell (the tender is
 * optional server-side). The call is retried on window focus and whenever the
 * destination or settled total changes.
 */
export function useStoreQrPresentation({
  siteId,
  destinationId,
  amount,
  enabled,
  onChange,
}: UseStoreQrPresentationParams): void {
  const start = trpc.payments.startPresentation.useMutation();
  const startRef = useRef(start.mutateAsync);
  useEffect(() => {
    startRef.current = start.mutateAsync;
  });

  const roundedAmount = roundMoney(amount);
  const checkoutKey =
    enabled && siteId.length > 0 && destinationId !== null && roundedAmount > 0
      ? `${siteId}|${destinationId}|${roundedAmount}`
      : null;
  const [started, setStarted] = useState<StartedPresentation | null>(null);
  const [retryTick, setRetryTick] = useState(0);
  const presentation = started && started.key === checkoutKey ? started : null;

  useEffect(() => {
    if (checkoutKey === null || destinationId === null || presentation) return;
    let active = true;
    const idempotencyKey = getOrCreatePresentationKey({
      siteId,
      destinationId,
      amount: roundedAmount,
    });
    startRef
      .current({ siteId, destinationId, amount: roundedAmount, idempotencyKey })
      .then(result => {
        if (active) {
          setStarted({ key: checkoutKey, id: result.id, destinationId, amount: roundedAmount });
        }
      })
      .catch(() => {
        // Keep today's behaviour: the QR stays visible and the sale stays
        // possible. The next focus or checkout change retries silently.
      });
    return () => {
      active = false;
    };
  }, [checkoutKey, destinationId, presentation, retryTick, roundedAmount, siteId]);

  useEffect(() => {
    if (checkoutKey === null || presentation) return;
    const retry = () => setRetryTick(tick => tick + 1);
    window.addEventListener('focus', retry);
    return () => window.removeEventListener('focus', retry);
  }, [checkoutKey, presentation]);

  useEffect(() => {
    onChange(
      presentation
        ? {
            destinationId: presentation.destinationId,
            amount: presentation.amount,
            id: presentation.id,
          }
        : null
    );
  }, [onChange, presentation]);

  // The drawer unmounts its body on close, so this drops the id for the next
  // checkout while the stored idempotency key survives for a reopen.
  useEffect(() => () => onChange(null), [onChange]);
}
