import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useResolvedLocale } from '@/features/locale/LocaleProvider';
import { hasScaleBridge } from '@/features/peripherals/scale';
import { usePriceIncludesTax } from '@/features/pricing/PricingContext';
import { quantityForAmount } from '@/features/sales/productSelection';
import type { SaleCartItem } from '@/features/sales/saleCart';
import { getLineTotals } from '@/features/sales/saleCartTotals';
import type { WeighedItemSession } from '@/features/sales/useWeighedItem';
import { WeighedScaleKey } from '@/features/sales/WeighedScaleKey';
import {
  kilogramFormat,
  kilogramsOf,
  quantityForWeight,
  WEIGHT_PRESETS_KG,
} from '@/features/sales/weighedItem';
import { formatCurrency } from '@/lib/utils';

const PRESET_KEYS = { 0.25: 'quarter', 0.5: 'half', 1: 'one' } as const;
const ENTRIES = ['value', 'weight'] as const;

type Entry = (typeof ENTRIES)[number];
interface Choice {
  kind: 'preset' | 'scale' | Entry;
  value: number;
}

interface WeighedItemPanelProps {
  session: WeighedItemSession;
  /** The ticket line it fills (or the one it will add): price, tier and discount. */
  line: SaleCartItem;
  onApply: (quantity: number) => void;
  onClose: () => void;
  className?: string | undefined;
}

/** «¿Cuánto pesó?»: scale reading, weight keys, sell by value and a typed weight for a by-weight product. */
export function WeighedItemPanel({
  session,
  line,
  onApply,
  onClose,
  className = '',
}: WeighedItemPanelProps) {
  const { t } = useTranslation('weighedItems');
  const priceIncludesTax = usePriceIncludesTax();
  const { locale } = useResolvedLocale();
  const titleId = useId();
  const errorId = useId();
  const firstKeyRef = useRef<HTMLButtonElement>(null);
  const entryKeys = useRef<Record<Entry, HTMLButtonElement | null>>({ value: null, weight: null });
  const scaleKeyRef = useRef<HTMLButtonElement>(null);
  const withScale = hasScaleBridge();
  const [reading, setReading] = useState(false);
  const [choice, setChoice] = useState<Choice | null>(null);
  const [entry, setEntry] = useState<Entry | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { selection, grams } = session;
  const kgFormat = useMemo(() => kilogramFormat(locale), [locale]);
  const setScaleReading = useCallback((next: boolean) => {
    setReading(next);
    if (next) setError(null);
  }, []);
  useEffect(() => {
    firstKeyRef.current?.focus({ preventScroll: true });
  }, []);

  const resolve = ({ kind, value }: Choice) => {
    const result =
      kind === 'value'
        ? // The amount is what the customer pays, so it buys at the line's price after discount and tax.
          quantityForAmount(
            value,
            getLineTotals({ ...line, quantity: 1 }, priceIncludesTax).total,
            selection.product
          )
        : quantityForWeight(value, grams, selection.product);
    if ('quantity' in result) return result;
    return {
      error: t(`errors.${result.error}`, {
        minimum: 'minimum' in result ? kgFormat.format(kilogramsOf(result.minimum, grams)) : '',
      }),
    };
  };

  const commit = (next: Choice) => {
    const result = resolve(next);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    setError(null);
    setChoice(next);
    setEntry(null);
    setDraft('');
    onApply(result.quantity);
    // The field goes away; focus stays in the panel so Escape still closes it.
    if (next.kind === 'scale') scaleKeyRef.current?.focus();
    else if (next.kind !== 'preset') entryKeys.current[next.kind]?.focus();
  };

  const toggleEntry = (next: Entry) => {
    setEntry(current => (current === next ? null : next));
    setDraft('');
    setError(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    // A scale reading in flight owns the line until it lands.
    if (entry && !reading) commit({ kind: entry, value: Number(draft) });
  };

  // While typing, the readout previews the entry; otherwise it shows what is on the ticket.
  const draftValue = Number(draft);
  const preview = entry && draftValue > 0 ? resolve({ kind: entry, value: draftValue }) : null;
  const readoutQuantity =
    preview && 'quantity' in preview
      ? preview.quantity
      : session.applied > 0
        ? session.applied
        : null;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onClose();
  };

  return (
    <section
      className={`weighed-panel ${className}`}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      data-testid="weighed-item-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 id={titleId} className="min-w-0 text-[0.97rem] font-semibold text-fg1">
          {t('title', { name: selection.product.name })}
        </h3>
        <div className="ml-auto flex items-center gap-2">
          <output className="weighed-readout" aria-live="polite" data-testid="weighed-item-readout">
            {readoutQuantity === null
              ? null
              : t('readout', {
                  weight: kgFormat.format(kilogramsOf(readoutQuantity, grams)),
                  total: formatCurrency(
                    getLineTotals({ ...line, quantity: readoutQuantity }, priceIncludesTax).total
                  ),
                })}
          </output>
          <button
            type="button"
            className="btn-ghost min-h-11 min-w-11 px-2"
            onClick={onClose}
            aria-label={t('close')}
            data-testid="weighed-item-close"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="weighed-keys">
        {withScale && (
          <WeighedScaleKey
            buttonRef={scaleKeyRef}
            pressed={choice?.kind === 'scale'}
            reading={reading}
            onReadingChange={setScaleReading}
            onWeight={kilograms => commit({ kind: 'scale', value: kilograms })}
            onError={setError}
          />
        )}
        {WEIGHT_PRESETS_KG.map((kg, index) => (
          <button
            key={kg}
            ref={index === 0 ? firstKeyRef : undefined}
            type="button"
            className="weighed-key"
            disabled={reading}
            aria-pressed={choice?.kind === 'preset' && choice.value === kg}
            onClick={() => commit({ kind: 'preset', value: kg })}
            data-testid={`weighed-item-preset-${kg}`}
          >
            {t(`presets.${PRESET_KEYS[kg]}`)}
          </button>
        ))}
        {ENTRIES.map(kind => (
          <button
            key={kind}
            ref={node => {
              entryKeys.current[kind] = node;
            }}
            type="button"
            className="weighed-key is-wide"
            disabled={reading}
            aria-expanded={entry === kind}
            data-on={entry === kind || choice?.kind === kind || undefined}
            onClick={() => toggleEntry(kind)}
            data-testid={`weighed-item-${kind}`}
          >
            {kind === 'value' && choice?.kind === 'value' && entry !== 'value'
              ? t('value.buttonAmount', { amount: formatCurrency(choice.value) })
              : t(`${kind}.button`)}
          </button>
        ))}
      </div>

      {entry && (
        <form className="mt-2 flex items-end gap-2" onSubmit={submit} noValidate>
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-semibold text-fg1">
            {t(`${entry}.label`)}
            <input
              key={entry}
              type="number"
              inputMode={entry === 'value' ? 'numeric' : 'decimal'}
              min="0"
              step={entry === 'value' ? 'any' : '0.001'}
              className="input min-h-11"
              value={draft}
              onChange={event => {
                setDraft(event.target.value);
                setError(null);
              }}
              aria-invalid={error !== null}
              aria-describedby={error ? errorId : undefined}
              // The field opens from a deliberate tap; typing is the next step.
              autoFocus
              data-testid={`weighed-item-${entry}-input`}
            />
          </label>
          <button
            type="submit"
            className="btn-primary min-h-11"
            disabled={reading}
            data-testid="weighed-item-submit"
          >
            {t('add')}
          </button>
        </form>
      )}

      {error && (
        <p
          id={errorId}
          className="mt-2 text-sm text-danger-700"
          role="alert"
          data-testid="weighed-item-error"
        >
          {error}
        </p>
      )}
    </section>
  );
}
