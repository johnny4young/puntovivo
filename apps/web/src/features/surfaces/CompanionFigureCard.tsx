import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface CompanionFigureCardProps {
  id: string;
  kicker: string;
  total: string;
  /** Whole percent against the same weekday last week, or null without a comparison. */
  change: number | null;
  weekday: string;
  testId: string;
  children: ReactNode;
}

/** A day's total with its change against last week, above what explains it. */
export function CompanionFigureCard({
  id,
  kicker,
  total,
  change,
  weekday,
  testId,
  children,
}: CompanionFigureCardProps) {
  const { t } = useTranslation('companion');
  return (
    <section
      className="rounded-[20px] border border-line bg-surface px-4 pt-3.5 pb-3"
      aria-labelledby={id}
      data-testid={testId}
    >
      <p id={id} className="text-[11px] font-semibold tracking-[0.14em] text-fg3 uppercase">
        {kicker}
      </p>
      <div className="flex items-baseline justify-between gap-3">
        <p
          className="font-numeric text-[2.4rem] leading-tight font-bold text-fg1"
          data-testid={`${testId}-total`}
        >
          {total}
        </p>
        {change !== null && (
          <p
            className={cn(
              'shrink-0 text-sm font-bold',
              change >= 0 ? 'text-success-700' : 'text-danger-700'
            )}
            data-testid={`${testId}-change`}
          >
            <span aria-hidden="true">
              {change >= 0 ? '▲' : '▼'} {Math.abs(change)} %
            </span>
            <span className="sr-only">
              {t(change >= 0 ? 'owner.changeUp' : 'owner.changeDown', {
                percent: Math.abs(change),
                weekday,
              })}
            </span>
          </p>
        )}
      </div>
      {children}
    </section>
  );
}
