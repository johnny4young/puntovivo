import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { Badge, Button } from '@/components/ui';
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
    {
      siteId: siteId || '__missing__',
      productId,
      sellableOnly: true,
    },
    {
      enabled: Boolean(siteId),
    }
  );
  const availableIds = useMemo(
    () => new Set(query.data?.items.map(serial => serial.id) ?? []),
    [query.data]
  );
  const validSelectedIds = useMemo(
    () => selectedIds.filter(id => availableIds.has(id)),
    [availableIds, selectedIds]
  );
  const complete =
    !query.isLoading &&
    !query.isError &&
    validSelectedIds.length === requiredCount &&
    validSelectedIds.length === selectedIds.length;

  // A refetch can remove a unit that another terminal sold or reserved.
  // Fail closed by dropping identities that are no longer sellable instead of
  // leaving checkout enabled with a selection the server will reject.
  useEffect(() => {
    if (
      siteId &&
      !query.isLoading &&
      !query.isError &&
      query.data &&
      validSelectedIds.length !== selectedIds.length
    ) {
      onChange(validSelectedIds);
    }
  }, [onChange, query.data, query.isError, query.isLoading, selectedIds, siteId, validSelectedIds]);
  return (
    <div className="mt-3 rounded-xl border border-primary-100 bg-primary-50/60 p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold text-primary-900">
          {t('serials.title', {
            name: productName,
          })}
        </p>
        <Badge variant={complete ? 'success' : 'warning'}>
          {t('serials.progress', {
            selected: validSelectedIds.length,
            required: requiredCount,
          })}
        </Badge>
      </div>
      {!siteId ? (
        <p className="mt-2 text-xs text-danger-700">{t('serials.siteRequired')}</p>
      ) : query.isLoading ? (
        <p className="mt-2 text-xs text-secondary-600" role="status">
          {t('serials.loading')}
        </p>
      ) : query.isError ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2">
          <p className="text-xs text-danger-700" role="alert">
            {t('serials.loadError')}
          </p>
          <Button
            type="button"
            className="text-xs"
            onClick={() => void query.refetch()}
            variant="outline"
            size="compact"
          >
            {t('serials.retry')}
          </Button>
        </div>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <p className="mt-2 text-xs text-danger-700">{t('serials.noneAvailable')}</p>
      ) : (
        <div className="mt-2 grid max-h-36 gap-2 overflow-y-auto sm:grid-cols-2">
          {query.data?.items.map(serial => {
            const checked = validSelectedIds.includes(serial.id);
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
                    !checked && (selectedInAnotherLine || validSelectedIds.length >= requiredCount)
                  }
                  onChange={() =>
                    onChange(
                      checked
                        ? validSelectedIds.filter(id => id !== serial.id)
                        : [...validSelectedIds, serial.id]
                    )
                  }
                />
                <span className="font-mono text-secondary-900">{serial.serialNumber}</span>
                {serial.status === 'returned' && (
                  <Badge className="ml-auto" variant="neutral">
                    {t('serials.returned')}
                  </Badge>
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
