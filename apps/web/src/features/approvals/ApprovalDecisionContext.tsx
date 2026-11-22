import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { percent } from './approvalPercent';

export type ApprovalDecisionContextData = NonNullable<
  inferRouterOutputs<AppRouter>['managerApprovals']['queue']['items'][number]['decisionContext']
>;

type Customer = NonNullable<ApprovalDecisionContextData['customer']>;
type Translate = ReturnType<typeof useTranslation>['t'];

const CADENCE_MAX_DAYS = [
  ['daily', 1.5],
  ['weekly', 9],
  ['biweekly', 17],
  ['monthly', 35],
] as const;

function customerHabit(customer: Customer, t: Translate) {
  const days = customer.daysPerVisit;
  const cadence = days === null ? undefined : CADENCE_MAX_DAYS.find(([, max]) => days <= max);
  return cadence
    ? t(`common:userMenu.approvals.context.cadence.${cadence[0]}`)
    : t('common:userMenu.approvals.context.purchases', {
        count: customer.purchases,
        days: customer.windowDays,
      });
}

interface RowProps {
  testId: string;
  title: string;
  detail: string | null;
  value: string | null;
  large: boolean;
}

function ContextRow({ testId, title, detail, value, large }: RowProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3',
        large ? 'py-2.5' : 'py-2'
      )}
    >
      <dt
        className={cn(
          'col-start-1 truncate font-semibold text-secondary-950',
          large ? 'text-[15px]' : 'text-xs'
        )}
      >
        {title}
      </dt>
      {detail && (
        <dd className={cn('col-start-1 text-fg2', large ? 'text-[13px]' : 'text-[11px]')}>
          {detail}
        </dd>
      )}
      {value && (
        <dd
          className={cn(
            'col-start-2 row-span-2 row-start-1 font-bold tabular-nums text-secondary-950',
            large ? 'font-numeric text-[1.3rem]' : 'text-base'
          )}
        >
          {value}
        </dd>
      )}
    </div>
  );
}

/** Customer habit, role limit and margin the approver weighs before the PIN. */
export function ApprovalDecisionContext({
  requestId,
  requesterName,
  context,
  large = false,
}: {
  requestId: string;
  requesterName: string;
  context: ApprovalDecisionContextData;
  /** Phone-size rows for the owner's decide sheet. */
  large?: boolean;
}) {
  const { t } = useTranslation('common');
  const { customer, discount, margin } = context;
  if (!customer && !discount && !margin) return null;
  const habit = customer && customerHabit(customer, t);
  // Admins have no role limit, so only the requested share is shown.
  const requested = discount
    ? t('common:userMenu.approvals.context.requested', { percent: percent(discount.percent) })
    : '';
  const marginValue =
    margin && (discount ? margin.withDiscountPercent : margin.withoutDiscountPercent);

  return (
    <dl
      data-testid={`approval-context-${requestId}`}
      className="mt-1.5 divide-y divide-line border-y border-line"
    >
      {customer && (
        <ContextRow
          testId="approval-context-customer"
          large={large}
          title={customer.name}
          detail={
            customer.usualDiscountPercent === null
              ? habit
              : `${habit} · ${t('common:userMenu.approvals.context.usualDiscount')}`
          }
          value={percent(customer.usualDiscountPercent)}
        />
      )}
      {discount && (
        <ContextRow
          testId="approval-context-limit"
          large={large}
          title={
            discount.roleLimitPercent === null
              ? requested
              : t('common:userMenu.approvals.context.limit', { name: requesterName })
          }
          detail={discount.roleLimitPercent === null ? null : requested}
          value={percent(discount.roleLimitPercent)}
        />
      )}
      {margin && (
        <ContextRow
          testId="approval-context-margin"
          large={large}
          title={t('common:userMenu.approvals.context.margin')}
          detail={
            discount
              ? t('common:userMenu.approvals.context.marginWithout', {
                  percent: percent(margin.withoutDiscountPercent),
                })
              : null
          }
          value={percent(marginValue)}
        />
      )}
    </dl>
  );
}
