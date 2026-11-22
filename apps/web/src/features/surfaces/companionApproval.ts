import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import type { TFunction } from 'i18next';
import { percent } from '@/features/approvals/approvalPercent';
import type { OperationsToday } from '@/features/dashboard/today/todayModel';
import { formatCurrency } from '@/lib/utils';

export type QueueItem = inferRouterOutputs<AppRouter>['managerApprovals']['queue']['items'][number];

/** The request's amount in the currency it was asked in; a drawer opening has none to show. */
export function shownAmount(item: QueueItem): string | null {
  const amount = item.summary.amount;
  return amount === undefined || item.action === 'cash_drawer_open'
    ? null
    : formatCurrency(amount, item.summary.currencyCode);
}

/** "Descuento de $ 74.400": what is being asked, with its amount when it has one. */
export function approvalWhat(item: QueueItem, t: TFunction): string {
  const amount = shownAmount(item);
  if (amount === null) return t(`common:userMenu.approvals.actions.${item.action}`);
  return item.action === 'sale_discount'
    ? t('companion:owner.discountWhat', { amount })
    : t('companion:owner.actionWhat', {
        label: t(`common:userMenu.approvals.actions.${item.action}`),
        amount,
      });
}

/** The requested share, when the request is a discount with a stored context. */
export function requestedPercent(item: QueueItem): string | null {
  const share = item.decisionContext?.discount?.percent;
  return share === undefined ? null : percent(share);
}

/** The register the requester is running, else the site: where the customer waits. */
export function waitingPlace(item: QueueItem, today: OperationsToday | undefined): string {
  return (
    today?.registers.find(register => register.cashierId === item.requesterId)?.registerName ??
    item.siteName
  );
}

/** The customer's usual discount, offered only when it is below what was asked. */
export function counterOffer(item: QueueItem): number | null {
  const context = item.decisionContext;
  const usual = context?.customer?.usualDiscountPercent ?? null;
  const asked = context?.discount?.percent ?? null;
  return usual !== null && asked !== null && usual > 0 && usual < asked ? usual : null;
}
