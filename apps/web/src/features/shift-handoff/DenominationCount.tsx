import { Minus, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { CashSessionDenomination } from '@/types';
import { denominationColor, denominationLabel, isCoin } from './shiftHandoffModel';

/** A note or coin drawn as cash: rectangular notes, round coins. */
export function DenominationChip({
  value,
  rank,
  size = 'md',
}: {
  value: number;
  rank: number;
  size?: 'sm' | 'md';
}) {
  const coin = isCoin(value);
  return (
    <span
      aria-hidden="true"
      style={{ backgroundColor: denominationColor(value, rank) }}
      className={cn(
        'inline-flex shrink-0 items-center justify-center font-numeric text-white',
        coin ? 'rounded-full' : 'rounded-md',
        size === 'md'
          ? coin
            ? 'h-9 w-9 text-xs'
            : 'h-9 w-16 text-sm'
          : coin
            ? 'h-6 w-6 text-[10px]'
            : 'h-6 w-10 text-xs'
      )}
    >
      {denominationLabel(value)}
    </span>
  );
}

/** The saved count as chips, only the denominations that were actually counted. */
export function DenominationSummary({
  denominations,
  testId,
}: {
  denominations: readonly CashSessionDenomination[];
  testId?: string;
}) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-2" data-testid={testId}>
      {denominations.map((row, rank) =>
        row.count > 0 ? (
          <li key={row.value} className="inline-flex items-center gap-1.5 text-sm font-semibold">
            <DenominationChip value={row.value} rank={rank} size="sm" />
            <span className="font-numeric">×{row.count}</span>
          </li>
        ) : null
      )}
    </ul>
  );
}

interface DenominationStepperProps {
  denominations: readonly CashSessionDenomination[];
  onChange: (next: CashSessionDenomination[]) => void;
  formatCurrency: (value: number) => string;
  disabled?: boolean;
}

/** One row per denomination with 44px minus and plus keys, sized for a till touchscreen. */
export function DenominationStepper({
  denominations,
  onChange,
  formatCurrency,
  disabled = false,
}: DenominationStepperProps) {
  const { t } = useTranslation('shiftHandoff');
  const setCount = (index: number, count: number) =>
    onChange(
      denominations.map((row, position) =>
        position === index ? { ...row, count: Math.max(0, Math.min(9999, count)) } : row
      )
    );

  return (
    <ul className="grid gap-2 sm:grid-cols-2" data-testid="denomination-stepper">
      {denominations.map((row, index) => {
        const name = formatCurrency(row.value);
        return (
          <li
            key={row.value}
            className="flex min-h-[58px] items-center gap-2 rounded-[15px] border border-line bg-surface py-1.5 pr-2 pl-2.5"
          >
            <DenominationChip value={row.value} rank={index} />
            <span className="sr-only">{name}</span>
            <button
              type="button"
              className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-surface-3 text-fg1 disabled:opacity-40"
              aria-label={t('count.decrement', { denomination: name })}
              disabled={disabled || row.count <= 0}
              onClick={() => setCount(index, row.count - 1)}
              data-testid={`denomination-minus-${row.value}`}
            >
              <Minus className="h-5 w-5" aria-hidden="true" />
            </button>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              aria-label={t('count.countFor', { denomination: name })}
              className="h-11 w-14 rounded-lg border border-transparent bg-transparent text-center font-numeric text-2xl text-fg1 outline-none focus:border-line-strong"
              value={row.count}
              disabled={disabled}
              onChange={event => setCount(index, Number(event.target.value.replace(/\D/g, '')))}
              data-testid={`denomination-count-${row.value}`}
            />
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-fg1 text-[var(--background)] disabled:opacity-40"
              aria-label={t('count.increment', { denomination: name })}
              disabled={disabled}
              onClick={() => setCount(index, row.count + 1)}
              data-testid={`denomination-plus-${row.value}`}
            >
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Numbered step pills: done steps get a check, the current one is filled. */
export function StepPills({
  steps,
  current,
  label,
}: {
  steps: readonly string[];
  current: number;
  label: string;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label={label}>
      {steps.map((step, index) => {
        const state = index < current ? 'done' : index === current ? 'now' : 'next';
        return (
          <li
            key={step}
            aria-current={state === 'now' ? 'step' : undefined}
            data-state={state}
            className={cn(
              'inline-flex h-9 items-center gap-2 rounded-full pr-3.5 pl-2 text-sm font-semibold',
              state === 'now' && 'bg-fg1 text-[var(--background)]',
              state === 'done' && 'text-fg1',
              state === 'next' && 'text-fg3'
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex h-[22px] w-[22px] items-center justify-center rounded-full border text-[13px]',
                state === 'done'
                  ? 'border-success-700 bg-success-700 text-white'
                  : state === 'now'
                    ? 'border-[var(--background)]'
                    : 'border-line-strong'
              )}
            >
              {state === 'done' ? '✓' : index + 1}
            </span>
            {step}
          </li>
        );
      })}
    </ol>
  );
}
