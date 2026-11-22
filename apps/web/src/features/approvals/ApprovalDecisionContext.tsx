import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { useTranslation } from 'react-i18next';
import { formatPercent } from '@/lib/utils';

export type ApprovalDecisionContextData = NonNullable<
  inferRouterOutputs<AppRouter>['managerApprovals']['queue']['items'][number]['decisionContext']
>;

type Customer = NonNullable<ApprovalDecisionContextData['customer']>;
type Translate = ReturnType<typeof useTranslation>['t'];

function percent(value: number): string;
function percent(value: number | null): string | null;
function percent(value: number | null) {
  return value === null ? null : formatPercent(value, Number.isInteger(value) ? 0 : 1);
}

const CADENCE_MAX_DAYS = [
  ['daily', 1.5],
  ['weekly', 9],
  ['biweekly', 17],
  ['monthly', 35],
] as const;

function customerHabit(customer: Customer, t: Translate) {
  const days = customer.averageDaysBetween;
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
}

function ContextRow({ testId, title, detail, value }: RowProps) {
  return (
    <div data-testid={testId} className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <dt className="truncate text-xs font-semibold text-secondary-950">{title}</dt>
        {detail && <dd className="text-[11px] text-fg2">{detail}</dd>}
      </div>
      {value && (
        <dd className="shrink-0 text-base font-bold tabular-nums text-secondary-950">{value}</dd>
      )}
    </div>
  );
}

/** Customer habit, role limit and margin the approver weighs before the PIN. */
export function ApprovalDecisionContext({
  requestId,
  requesterName,
  context,
}: {
  requestId: string;
  requesterName: string;
  context: ApprovalDecisionContextData;
}) {
  const { t } = useTranslation('common');
  const { customer, discount, margin } = context;
  if (!customer && !discount && !margin) return null;
  const habit = customer && customerHabit(customer, t);
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
          title={t('common:userMenu.approvals.context.limit', { name: requesterName })}
          detail={t('common:userMenu.approvals.context.requested', {
            percent: percent(discount.percent),
          })}
          value={percent(discount.roleLimitPercent)}
        />
      )}
      {margin && (
        <ContextRow
          testId="approval-context-margin"
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
