import { useTranslation } from 'react-i18next';

import { trpc } from '@/lib/trpc';

interface SaleSerialSelectorProps {
  siteId: string | null;
  productId: string;
  productName: string;
  requiredCount: number;
  selectedIds: string[];
  unavailableIds?: string[] | undefined;
  onChange: (serialIds: string[]) => void;
}

export function SaleSerialSelector({
  siteId,
  productId,
  productName,
  requiredCount,
  selectedIds,
  unavailableIds = [],
  onChange,
}: SaleSerialSelectorProps) {
  const { t } = useTranslation('sales');
  const query = trpc.productSerials.list.useQuery(
    { siteId: siteId || '__missing__', productId, sellableOnly: true },
    { enabled: Boolean(siteId) }
  );
  const complete = selectedIds.length === requiredCount;

  return (
    <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-primary-900">
          {t('serials.title', { name: productName })}
        </p>
        <span className={complete ? 'pv-badge success' : 'pv-badge warning'}>
          {t('serials.progress', { selected: selectedIds.length, required: requiredCount })}
        </span>
      </div>
      {!siteId ? (
        <p className="mt-2 text-xs text-danger-700">{t('serials.siteRequired')}</p>
      ) : query.isLoading ? (
        <p className="mt-2 text-xs text-secondary-600" role="status">
          {t('serials.loading')}
        </p>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <p className="mt-2 text-xs text-danger-700">{t('serials.noneAvailable')}</p>
      ) : (
        <div className="mt-2 grid max-h-36 gap-2 overflow-y-auto sm:grid-cols-2">
          {query.data?.items.map(serial => {
            const checked = selectedIds.includes(serial.id);
            const selectedInAnotherLine = unavailableIds.includes(serial.id);
            return (
              <label
                key={serial.id}
                className="flex min-h-10 items-center gap-2 rounded-lg border border-line bg-card px-3 text-xs"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={
                    !checked &&
                    (selectedInAnotherLine || selectedIds.length >= requiredCount)
                  }
                  onChange={() =>
                    onChange(
                      checked
                        ? selectedIds.filter(id => id !== serial.id)
                        : [...selectedIds, serial.id]
                    )
                  }
                />
                <span className="font-mono text-secondary-900">{serial.serialNumber}</span>
                {serial.status === 'returned' && (
                  <span className="pv-badge neutral ml-auto">{t('serials.returned')}</span>
                )}
                {selectedInAnotherLine && !checked && (
                  <span className="ml-auto text-secondary-500">
                    {t('serials.usedInAnotherLine')}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      )}
      {!complete && (
        <p className="mt-2 text-xs text-primary-800">{t('serials.selectionRequired')}</p>
      )}
    </div>
  );
}
