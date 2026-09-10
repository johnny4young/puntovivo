import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatQuantity } from '@puntovivo/shared/unit-math';
import {
  createLotReceiptDraft,
  formatLotExpiryDate,
  parsePositiveQuantity,
  quantitiesMatch,
  sumExactLotAllocations,
  sumLotReceiptQuantity,
  type ExactLotAllocationDraft,
  type ExactLotOption,
  type LotReceiptDraft,
} from './lotForm';

interface LotReceiptEditorProps {
  value: LotReceiptDraft[];
  onChange: (value: LotReceiptDraft[]) => void;
  expectedBaseQuantity?: number;
  maximumBaseQuantity?: number;
  disabled?: boolean;
  idPrefix: string;
}

export function LotReceiptEditor({
  value,
  onChange,
  expectedBaseQuantity,
  maximumBaseQuantity,
  disabled = false,
  idPrefix,
}: LotReceiptEditorProps) {
  const { t } = useTranslation('inventory');
  const total = sumLotReceiptQuantity(value);
  const exceedsMaximum = maximumBaseQuantity !== undefined && total - maximumBaseQuantity > 1e-6;
  const mismatchesExpected =
    expectedBaseQuantity !== undefined && !quantitiesMatch(total, expectedBaseQuantity);
  const duplicateLots = new Set<string>();
  const seenLots = new Set<string>();
  for (const row of value) {
    const normalized = row.lotNumber.trim().toLocaleLowerCase();
    if (!normalized) continue;
    if (seenLots.has(normalized)) duplicateLots.add(normalized);
    seenLots.add(normalized);
  }

  function updateRow(id: string, changes: Partial<LotReceiptDraft>) {
    onChange(value.map(row => (row.id === id ? { ...row, ...changes } : row)));
  }

  return (
    <fieldset className="mt-4 rounded-xl border border-secondary-200 p-4">
      <legend className="px-1 text-sm font-medium text-secondary-900">
        {t('lots.receipt.title')}
      </legend>
      <p className="mb-3 text-xs text-secondary-500">{t('lots.receipt.help')}</p>
      <div className="space-y-3">
        {value.map((row, index) => {
          const normalizedLot = row.lotNumber.trim().toLocaleLowerCase();
          const duplicate = normalizedLot.length > 0 && duplicateLots.has(normalizedLot);
          const invalidQuantity =
            row.baseQuantity.trim().length > 0 && parsePositiveQuantity(row.baseQuantity) <= 0;
          return (
            <div
              key={row.id}
              className="grid gap-3 rounded-lg bg-secondary-50 p-3 md:grid-cols-[1.4fr_1fr_1fr_auto]"
            >
              <label className="block">
                <span className="label">{t('lots.receipt.lotNumber')}</span>
                <input
                  id={`${idPrefix}-lot-${index}`}
                  className="input mt-1"
                  value={row.lotNumber}
                  maxLength={120}
                  disabled={disabled}
                  aria-invalid={duplicate}
                  onChange={event => updateRow(row.id, { lotNumber: event.target.value })}
                />
                {duplicate && (
                  <span className="mt-1 block text-xs text-danger-700">
                    {t('lots.receipt.duplicate')}
                  </span>
                )}
              </label>
              <label className="block">
                <span className="label">{t('lots.receipt.expiresAt')}</span>
                <input
                  type="date"
                  className="input mt-1"
                  value={row.expiresAt}
                  disabled={disabled}
                  onChange={event => updateRow(row.id, { expiresAt: event.target.value })}
                />
              </label>
              <label className="block">
                <span className="label">{t('lots.receipt.baseQuantity')}</span>
                <input
                  type="number"
                  inputMode="decimal"
                  step="any"
                  min={0}
                  className="input mt-1"
                  value={row.baseQuantity}
                  disabled={disabled}
                  aria-invalid={invalidQuantity}
                  onChange={event => updateRow(row.id, { baseQuantity: event.target.value })}
                />
              </label>
              <button
                type="button"
                className="btn-ghost mt-6 self-start p-2"
                aria-label={t('lots.receipt.remove')}
                disabled={disabled || value.length === 1}
                onClick={() => onChange(value.filter(candidate => candidate.id !== row.id))}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          className="btn-secondary inline-flex items-center gap-2 py-1.5 text-sm"
          disabled={disabled || value.length >= 50}
          onClick={() => onChange([...value, createLotReceiptDraft()])}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('lots.receipt.add')}
        </button>
        <p
          className={`text-sm ${exceedsMaximum || mismatchesExpected ? 'text-danger-700' : 'text-secondary-600'}`}
          role={exceedsMaximum || mismatchesExpected ? 'alert' : undefined}
        >
          {expectedBaseQuantity !== undefined
            ? t('lots.receipt.totalExpected', {
                total: formatQuantity(total),
                expected: formatQuantity(expectedBaseQuantity),
              })
            : maximumBaseQuantity !== undefined
              ? t('lots.receipt.totalMaximum', {
                  total: formatQuantity(total),
                  maximum: formatQuantity(maximumBaseQuantity),
                })
              : t('lots.receipt.total', { total: formatQuantity(total) })}
        </p>
      </div>
    </fieldset>
  );
}

interface ExactLotAllocationEditorProps {
  options: ExactLotOption[];
  value: ExactLotAllocationDraft;
  onChange: (value: ExactLotAllocationDraft) => void;
  expectedQuantity?: number;
  disabled?: boolean;
  idPrefix: string;
  emptyMessage?: string;
  title?: string;
  help?: string;
}

export function ExactLotAllocationEditor({
  options,
  value,
  onChange,
  expectedQuantity,
  disabled = false,
  idPrefix,
  emptyMessage,
  title,
  help,
}: ExactLotAllocationEditorProps) {
  const { t } = useTranslation('inventory');
  const total = sumExactLotAllocations(value);
  const mismatchesExpected =
    expectedQuantity !== undefined && !quantitiesMatch(total, expectedQuantity);

  return (
    <fieldset className="mt-4 rounded-xl border border-secondary-200 p-4">
      <legend className="px-1 text-sm font-medium text-secondary-900">
        {title ?? t('lots.allocation.title')}
      </legend>
      <p className="mb-3 text-xs text-secondary-500">{help ?? t('lots.allocation.help')}</p>
      {options.length === 0 ? (
        <p className="text-sm text-warning-700">{emptyMessage ?? t('lots.allocation.empty')}</p>
      ) : (
        <div className="space-y-2">
          {options.map((option, index) => {
            const raw = value[option.id] ?? '';
            const quantity = parsePositiveQuantity(raw);
            const exceeds = quantity - option.availableQuantity > 1e-6;
            const translatedStatus = option.status
              ? t(`lots.allocation.statuses.${option.status}`, {
                  defaultValue: t('lots.allocation.unknownStatus'),
                })
              : t('lots.allocation.unknownStatus');
            return (
              <div
                key={option.id}
                className="grid items-end gap-2 rounded-lg bg-secondary-50 p-3 md:grid-cols-[1fr_auto_140px]"
              >
                <div>
                  <p className="font-mono text-sm text-secondary-900">{option.lotNumber}</p>
                  <p className="text-xs text-secondary-500">
                    {t('lots.allocation.metadata', {
                      status: translatedStatus,
                      expiry: option.expiresAt
                        ? formatLotExpiryDate(option.expiresAt) || t('lots.allocation.noExpiry')
                        : t('lots.allocation.noExpiry'),
                    })}
                  </p>
                </div>
                <p className="text-xs text-secondary-600">
                  {t('lots.allocation.available', {
                    quantity: formatQuantity(option.availableQuantity),
                  })}
                </p>
                <label className="block">
                  <span className="sr-only">
                    {t('lots.allocation.quantityFor', { lot: option.lotNumber })}
                  </span>
                  <input
                    id={`${idPrefix}-allocation-${index}`}
                    type="number"
                    inputMode="decimal"
                    step="any"
                    min={0}
                    max={option.availableQuantity}
                    className="input text-right"
                    value={raw}
                    disabled={disabled || option.availableQuantity <= 0}
                    aria-invalid={exceeds}
                    onChange={event =>
                      onChange({
                        ...value,
                        [option.id]: event.target.value,
                      })
                    }
                  />
                  {exceeds && (
                    <span className="mt-1 block text-xs text-danger-700">
                      {t('lots.allocation.exceeds')}
                    </span>
                  )}
                </label>
              </div>
            );
          })}
        </div>
      )}
      <p
        className={`mt-3 text-right text-sm ${mismatchesExpected ? 'text-danger-700' : 'text-secondary-600'}`}
        role={mismatchesExpected ? 'alert' : undefined}
      >
        {expectedQuantity === undefined
          ? t('lots.allocation.total', { total: formatQuantity(total) })
          : t('lots.allocation.totalExpected', {
              total: formatQuantity(total),
              expected: formatQuantity(expectedQuantity),
            })}
      </p>
    </fieldset>
  );
}
