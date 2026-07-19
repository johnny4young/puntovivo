/** ENG-178 — Presentational line editor for quotation creation. */
import { Plus, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { formatCurrency } from '@/lib/utils';

import {
  parseQuotationNumber,
  type DraftLine,
  type ProductOption,
  type ResolvedLine,
} from './quotationDraft';

interface QuotationLinesEditorProps {
  lines: readonly DraftLine[];
  resolvedLines: readonly ResolvedLine[];
  productOptions: readonly ProductOption[];
  productById: ReadonlyMap<string, ProductOption>;
  hasFieldError: boolean;
  hasAnyValidLine: boolean;
  onUpdateLine: (rowId: string, patch: Partial<DraftLine>) => void;
  onAddLine: () => void;
  onRemoveLine: (rowId: string) => void;
}

export function QuotationLinesEditor({
  lines,
  resolvedLines,
  productOptions,
  productById,
  hasFieldError,
  hasAnyValidLine,
  onUpdateLine,
  onAddLine,
  onRemoveLine,
}: QuotationLinesEditorProps) {
  const { t } = useTranslation('quotations');

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary-700">
          {t('create.linesTitle')}
        </h3>
        <button
          type="button"
          className="btn-ghost inline-flex items-center gap-1 py-1 text-sm"
          onClick={onAddLine}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('create.addLine')}
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-secondary-200">
        <table className="min-w-full divide-y divide-secondary-200 text-sm">
          <thead className="bg-secondary-50 text-xs uppercase tracking-wide text-secondary-500">
            <tr>
              <th scope="col" className="px-3 py-2 text-left">
                {t('create.columns.product')}
              </th>
              <th scope="col" className="px-3 py-2 text-left">
                {t('create.columns.tier', { defaultValue: 'Tarifa' })}
              </th>
              <th scope="col" className="px-3 py-2 text-center">
                {t('create.columns.quantity')}
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                {t('create.columns.unitPrice')}
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                {t('create.columns.discount')}
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                {t('create.columns.taxRate')}
              </th>
              <th scope="col" className="px-3 py-2 text-right">
                {t('create.columns.total')}
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">{t('create.removeLine')}</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-100">
            {lines.map((line, index) => {
              const resolved = resolvedLines[index];
              const currentQty = parseQuotationNumber(line.quantityInput);
              const setQty = (next: number) =>
                onUpdateLine(line.rowId, {
                  quantityInput: String(Math.max(0, next)),
                });
              const product = resolved?.product;

              return (
                <tr key={line.rowId}>
                  <td className="px-3 py-2 align-top">
                    <select
                      className={`input w-56 ${product ? '' : 'border-secondary-300'}`}
                      value={line.productId}
                      onChange={event => {
                        const next = productById.get(event.target.value);
                        onUpdateLine(line.rowId, {
                          productId: event.target.value,
                          unitPriceInput: next ? String(next.price) : line.unitPriceInput,
                        });
                      }}
                      aria-label={t('create.columns.product')}
                    >
                      <option value="">{t('create.linePlaceholder')}</option>
                      {productOptions.map(option => (
                        <option key={option.id} value={option.id}>
                          {option.name} — {option.sku}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="px-3 py-2 align-top">
                    {/* V7 — tier badge column. Read-only display of the
                     * product's first configured price tier. Falls back
                     * to "—" so the chrome stays present even when no
                     * wholesale tier is configured (handoff §7 read-only). */}
                    {product ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-primary-700">
                        {t('create.tierBadge', { defaultValue: 'Pista 1' })}
                      </span>
                    ) : (
                      <span className="text-[12px] text-secondary-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center align-top">
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line/70 text-secondary-700 transition hover:border-primary-300 hover:bg-primary-50 disabled:opacity-40"
                        disabled={!Number.isFinite(currentQty) || currentQty <= 0}
                        onClick={() => setQty((Number.isFinite(currentQty) ? currentQty : 0) - 1)}
                        aria-label={t('create.decrementQty', { defaultValue: 'Restar' })}
                      >
                        <span aria-hidden="true">−</span>
                      </button>
                      <input
                        type="number"
                        inputMode="decimal"
                        step="any"
                        min={0}
                        className="input h-9 w-14 text-center font-mono tabular-nums"
                        value={line.quantityInput}
                        onChange={event =>
                          onUpdateLine(line.rowId, { quantityInput: event.target.value })
                        }
                        aria-label={t('create.columns.quantity')}
                      />
                      <button
                        type="button"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line/70 text-secondary-700 transition hover:border-primary-300 hover:bg-primary-50"
                        onClick={() => setQty((Number.isFinite(currentQty) ? currentQty : 0) + 1)}
                        aria-label={t('create.incrementQty', { defaultValue: 'Sumar' })}
                      >
                        <span aria-hidden="true">+</span>
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      className="input w-28 text-right"
                      value={line.unitPriceInput}
                      onChange={event =>
                        onUpdateLine(line.rowId, { unitPriceInput: event.target.value })
                      }
                      aria-label={t('create.columns.unitPrice')}
                    />
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      max={100}
                      className="input w-20 text-right"
                      value={line.discountInput}
                      onChange={event =>
                        onUpdateLine(line.rowId, { discountInput: event.target.value })
                      }
                      aria-label={t('create.columns.discount')}
                    />
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <input
                      type="number"
                      inputMode="decimal"
                      step="any"
                      min={0}
                      className="input w-20 text-right"
                      value={line.taxRateInput}
                      onChange={event =>
                        onUpdateLine(line.rowId, { taxRateInput: event.target.value })
                      }
                      aria-label={t('create.columns.taxRate')}
                      placeholder={resolved?.product ? String(resolved.product.taxRate) : '0'}
                    />
                  </td>
                  <td className="px-3 py-2 text-right align-top font-medium text-secondary-900">
                    {formatCurrency(resolved?.total ?? 0)}
                  </td>
                  <td className="px-3 py-2 text-right align-top">
                    <button
                      type="button"
                      className="btn-ghost px-2 py-1 text-secondary-600 hover:text-danger-600"
                      onClick={() => onRemoveLine(line.rowId)}
                      aria-label={t('create.removeLine')}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasFieldError && (
        <p className="text-xs text-danger-700">{t('create.errors.lineQuantity')}</p>
      )}
      {!hasAnyValidLine && !hasFieldError && (
        <p className="text-xs text-secondary-500">{t('create.errors.noLines')}</p>
      )}
    </div>
  );
}
