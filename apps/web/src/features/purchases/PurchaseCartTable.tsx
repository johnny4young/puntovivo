import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { MIN_OPERATIONAL_QUANTITY } from '@puntovivo/shared/unit-math';
import { formatCurrency } from '@/lib/utils';
import { hasDuplicateSerialNumbers, parseSerialNumbers } from '@/features/inventory/serialNumbers';
import {
  getPurchaseLineTotal,
  getPurchaseNormalizedQuantity,
  type PurchaseCartItem,
} from '@/features/purchases/purchaseCart';

interface PurchaseCartTableProps {
  items: PurchaseCartItem[];
  onQuantityChange: (itemKey: string, quantity: number) => void;
  onCostChange: (itemKey: string, costPerUnit: number) => void;
  onSerialNumbersChange: (itemKey: string, serialNumbers: string) => void;
  onRemove: (itemKey: string) => void;
}

export function PurchaseCartTable({
  items,
  onQuantityChange,
  onCostChange,
  onSerialNumbersChange,
  onRemove,
}: PurchaseCartTableProps) {
  const { t } = useTranslation('purchases');
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-2 px-4 py-10 text-center text-sm text-secondary-500">
        {t('checkout.empty')}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-line">
          <thead className="bg-surface-2">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
              <th className="px-3 py-2.5">{t('cart.product')}</th>
              <th className="px-3 py-2.5">{t('cart.qty')}</th>
              <th className="px-3 py-2.5">{t('cart.costPerUnit')}</th>
              <th className="px-3 py-2.5">{t('cart.baseUnits')}</th>
              <th className="px-3 py-2.5">{t('cart.lineTotal')}</th>
              <th className="w-12 px-2 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line bg-surface">
            {items.map(item => {
              const hasDuplicateSerials =
                item.tracksSerials && hasDuplicateSerialNumbers(item.serialNumbers);

              return (
                <tr key={item.key}>
                  <td className="px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-secondary-900">{item.productName}</p>
                      <p className="text-xs text-secondary-500">
                        {item.productSku}
                        {' · '}
                        {item.unitName}
                        {' · '}
                        {t('cart.currentStock', { count: item.currentStock })}
                      </p>
                      {item.tracksSerials && (
                        <div className="mt-3 min-w-64">
                          <label htmlFor={`purchase-serials-${item.key}`} className="label">
                            {t('cart.serialNumbers')}
                          </label>
                          <textarea
                            id={`purchase-serials-${item.key}`}
                            className="input mt-1 min-h-20 font-mono text-xs"
                            value={item.serialNumbers}
                            onChange={event => onSerialNumbersChange(item.key, event.target.value)}
                            placeholder={t('cart.serialNumbersPlaceholder')}
                            aria-invalid={hasDuplicateSerials}
                          />
                          <p className="mt-1 text-xs text-secondary-500">
                            {t('cart.serialCount', {
                              count: parseSerialNumbers(item.serialNumbers).length,
                            })}
                          </p>
                          {hasDuplicateSerials && (
                            <p className="mt-1 text-xs text-danger-600" role="alert">
                              {t('cart.serialNumbersDuplicate')}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="number"
                      min={MIN_OPERATIONAL_QUANTITY}
                      step="any"
                      className="input w-20"
                      value={item.quantity}
                      readOnly={item.tracksSerials}
                      aria-readonly={item.tracksSerials}
                      aria-label={t('cart.quantityFor', { name: item.productName })}
                      onChange={event =>
                        onQuantityChange(
                          item.key,
                          Math.max(
                            MIN_OPERATIONAL_QUANTITY,
                            Number(event.target.value) || MIN_OPERATIONAL_QUANTITY
                          )
                        )
                      }
                    />
                  </td>
                  <td className="px-3 py-2.5">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="input w-28"
                      value={item.costPerUnit}
                      aria-label={t('cart.costFor', { name: item.productName })}
                      onChange={event =>
                        onCostChange(item.key, Math.max(0, Number(event.target.value) || 0))
                      }
                    />
                  </td>
                  <td className="px-3 py-2.5 text-sm text-secondary-700">
                    {getPurchaseNormalizedQuantity(item)}
                  </td>
                  <td className="px-3 py-2.5 text-sm font-medium text-secondary-900">
                    {formatCurrency(getPurchaseLineTotal(item))}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <button
                      type="button"
                      className="btn-ghost btn-icon h-9 w-9 text-danger-500 hover:text-danger-700"
                      aria-label={t('cart.removeItem', { name: item.productName })}
                      onClick={() => onRemove(item.key)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
