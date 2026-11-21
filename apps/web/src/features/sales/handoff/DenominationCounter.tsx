import { useTranslation } from 'react-i18next';
import { Minus, Plus } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import type { CashSessionDenomination } from '@/types';
import { isCashCoin } from '../cashDenominations';

const compactFormats = new Map<string, Intl.NumberFormat>();

function compactFormat(locale: string): Intl.NumberFormat {
  let format = compactFormats.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 2 });
    compactFormats.set(locale, format);
  }
  return format;
}

export function DenominationChip({
  value,
  currencyCode,
  small = false,
}: {
  value: number;
  currencyCode: string;
  small?: boolean;
}) {
  const { i18n } = useTranslation();
  const label = compactFormat(i18n.language).format(value);
  const coin = isCashCoin(value, currencyCode);
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center bg-fg2 font-display font-bold text-surface',
        coin ? 'rounded-full ring-2 ring-inset ring-surface/30' : 'rounded-md',
        small
          ? coin
            ? 'h-[26px] w-[26px] text-[10px]'
            : 'h-[26px] w-[46px] text-[11.5px]'
          : coin
            ? 'mx-[15px] h-9 w-9 text-xs'
            : 'h-9 w-[66px] text-sm'
      )}
    >
      {label}
    </span>
  );
}

interface DenominationCounterProps {
  denominations: CashSessionDenomination[];
  currencyCode: string;
  onChange: (index: number, count: number) => void;
  testIdPrefix: string;
  /** Rows kept in the count but not shown; indexes stay those of `denominations`. */
  hiddenValues?: ReadonlySet<number> | undefined;
}

/** Bills and coins counted one tap at a time; the count stays editable by keyboard. */
export function DenominationCounter({
  denominations,
  currencyCode,
  onChange,
  testIdPrefix,
  hiddenValues,
}: DenominationCounterProps) {
  const { t } = useTranslation('cashHandoffs');
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {denominations.map((row, index) => {
        if (hiddenValues?.has(row.value)) return null;
        const name = formatCurrency(row.value);
        return (
          <div
            key={row.value}
            data-testid={`${testIdPrefix}-${index}`}
            className="flex h-[58px] items-center gap-2 rounded-[15px] border-[1.5px] border-line bg-surface pl-2.5 pr-2"
          >
            <DenominationChip value={row.value} currencyCode={currencyCode} />
            <button
              type="button"
              className="ml-auto inline-flex h-11 w-11 items-center justify-center rounded-xl bg-surface-3 text-fg1 transition hover:bg-line disabled:opacity-40"
              aria-label={t('sheet.count.decrement', { denomination: name })}
              disabled={row.count <= 0}
              onClick={() => onChange(index, row.count - 1)}
            >
              <Minus className="h-4 w-4" aria-hidden="true" />
            </button>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              aria-label={t('sheet.count.countFor', { denomination: name })}
              data-testid={`${testIdPrefix}-${index}-count`}
              className="h-11 w-12 rounded-lg bg-transparent text-center font-display text-2xl font-bold tabular-nums text-fg1 outline-none focus:ring-2 focus:ring-primary-400/40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              value={row.count}
              onChange={event => {
                const next = Number.parseInt(event.target.value, 10);
                onChange(index, Number.isFinite(next) ? Math.max(0, next) : 0);
              }}
              onFocus={event => event.target.select()}
            />
            <button
              type="button"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-fg1 text-surface transition hover:opacity-90"
              aria-label={t('sheet.count.increment', { denomination: name })}
              onClick={() => onChange(index, row.count + 1)}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
