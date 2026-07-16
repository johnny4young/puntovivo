import { Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
      <div className="rounded-xl border border-dashed border-secondary-300 bg-secondary-50 px-4 py-10 text-center text-sm text-secondary-500">
        {t('checkout.empty')}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-secondary-200">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-secondary-200">
          <thead className="bg-secondary-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-secondary-500">
              <th className="px-4 py-3">{t('cart.product')}</th>
              <th className="px-4 py-3">{t('cart.qty')}</th>
              <th className="px-4 py-3">{t('cart.costPerUnit')}</th>
              <th className="px-4 py-3">{t('cart.baseUnits')}</th>
              <th className="px-4 py-3">{t('cart.lineTotal')}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary-200 bg-white">
            {items.map(item => {
              const hasDuplicateSerials =
                item.tracksSerials && hasDuplicateSerialNumbers(item.serialNumbers);

              return (
                <tr key={item.key}>
                  <td className="px-4 py-3">
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
                        <div className="mt-3 min-w-72">
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
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={0.01}
                      step="any"
                      className="input w-24"
                      value={item.quantity}
                      readOnly={item.tracksSerials}
                      aria-readonly={item.tracksSerials}
                      onChange={event =>
                        onQuantityChange(
                          item.key,
                          Math.max(0.01, Number(event.target.value) || 0.01)
                        )
                      }
                    />
                  </td>
                  <td className="px-4 py-3">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className="input w-32"
                      value={item.costPerUnit}
                      onChange={event =>
                        onCostChange(item.key, Math.max(0, Number(event.target.value) || 0))
                      }
                    />
                  </td>
                  <td className="px-4 py-3 text-sm text-secondary-700">
                    {getPurchaseNormalizedQuantity(item)}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-secondary-900">
                    {formatCurrency(getPurchaseLineTotal(item))}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      className="btn-ghost btn-icon h-8 w-8 text-danger-500 hover:text-danger-700"
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
