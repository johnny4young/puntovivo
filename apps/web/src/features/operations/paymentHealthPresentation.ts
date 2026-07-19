import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';

export type PaymentReconciliation = inferRouterOutputs<AppRouter>['payments']['reconciliation'];
export type PaymentMethodBreakdown =
  inferRouterOutputs<AppRouter>['payments']['methodBreakdown']['entries'];

export type PaymentSemanticTone = 'success' | 'warning' | 'danger' | 'neutral';

export const PAYMENT_BREAKDOWN_WINDOW_DAYS = 7;
export const RETRIABLE_PAYMENT_STATUSES = new Set([
  'declined',
  'timeout',
  'retrying',
  'dead_letter',
]);

export function paymentStatusTone(status: string | null): PaymentSemanticTone {
  if (status === 'approved' || status === 'settled') return 'success';
  if (status === 'declined' || status === 'timeout' || status === 'dead_letter') {
    return 'danger';
  }
  if (status === 'retrying' || status === 'submitting') return 'warning';
  return 'neutral';
}

export function paymentMismatchTone(type: string): PaymentSemanticTone {
  if (type === 'provider_issue') return 'danger';
  if (type === 'missing_provider_reference' || type === 'amount_mismatch') {
    return 'warning';
  }
  return 'neutral';
}

export function getPaymentErrorMessage(value: Record<string, unknown> | null): string | null {
  if (!value) return null;
  const message = value.message;
  if (typeof message === 'string') return message;
  const kind = value.kind;
  if (typeof kind === 'string') return kind;
  return JSON.stringify(value);
}
