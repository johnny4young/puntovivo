import { ArrowDownLeft, ArrowUpRight, BanknoteArrowDown, BanknoteArrowUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import type { CashMovement, CashMovementType } from '@/types';

interface CashSessionMovementTimelineProps {
  movements: CashMovement[];
  isLoading: boolean;
}

function isPositiveMovement(type: CashMovementType) {
  return type === 'sale' || type === 'paid_in' || type === 'replenishment';
}

function getMovementIcon(type: CashMovementType) {
  if (type === 'sale' || type === 'paid_in') {
    return ArrowUpRight;
  }

  if (type === 'refund' || type === 'paid_out') {
    return ArrowDownLeft;
  }

  if (type === 'skim') {
    return BanknoteArrowDown;
  }

  return BanknoteArrowUp;
}

export function CashSessionMovementTimeline({
  movements,
  isLoading,
}: CashSessionMovementTimelineProps) {
  const { t } = useTranslation('sales');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-secondary-950">
            {t('cashSession.timeline.title')}
          </h3>
          <p className="mt-1 text-sm text-secondary-500">
            {t('cashSession.timeline.description')}
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-[20px] border border-dashed border-secondary-300 bg-white/70 px-4 py-5 text-sm text-secondary-500">
          {t('cashSession.timeline.loading')}
        </div>
      ) : movements.length === 0 ? (
        <div className="rounded-[20px] border border-dashed border-secondary-300 bg-white/70 px-4 py-5 text-sm text-secondary-500">
          {t('cashSession.timeline.empty')}
        </div>
      ) : (
        <div className="space-y-2">
          {movements.map(movement => {
            const Icon = getMovementIcon(movement.type);
            const positive = isPositiveMovement(movement.type);
            const signedAmount = `${positive ? '+' : '-'}${formatCurrency(movement.amount)}`;

            return (
              <article
                key={movement.id}
                className="rounded-[20px] border border-secondary-200 bg-white px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px]',
                      positive
                        ? 'bg-success-50 text-success-700'
                        : 'bg-warning-50 text-warning-700'
                    )}
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-secondary-950">
                          {movement.note || t(`cashSession.movementTypes.${movement.type}`)}
                        </p>
                        <p className="mt-1 text-xs text-secondary-500">
                          {t(`cashSession.movementTypes.${movement.type}`)} ·{' '}
                          {movement.createdByName || t('cashSession.timeline.unknownCashier')} ·{' '}
                          {formatDateTime(movement.createdAt)}
                        </p>
                      </div>
                      <p
                        className={cn(
                          'text-sm font-semibold',
                          positive ? 'text-success-700' : 'text-warning-700'
                        )}
                      >
                        {signedAmount}
                      </p>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
