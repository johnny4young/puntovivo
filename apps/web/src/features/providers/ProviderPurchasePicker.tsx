import { useState } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { useTranslation } from 'react-i18next';
import { TablePagination } from '@/components/tables/TablePagination';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';

export type PayablePurchase =
  inferRouterOutputs<AppRouter>['providerPayables']['availablePurchases']['items'][number];

export function ProviderPurchasePicker({
  providerId,
  value,
  disabled,
  onChange,
}: {
  providerId: string;
  value: string;
  disabled: boolean;
  onChange: (purchase: PayablePurchase | null) => void;
}) {
  const { t } = useTranslation('providerPayables');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<PayablePurchase | null>(null);
  const debouncedSearch = useDebouncedValue(search.trim(), 200);
  const query = trpc.providerPayables.availablePurchases.useQuery({
    providerId,
    search: debouncedSearch,
    page,
    perPage: 25,
  });
  const data = query.data;
  const items = data?.items ?? [];
  // Keep the explicit selection visible when searching or moving to another
  // page. Never replace the invoice identity merely because results changed.
  const retained = selected?.id === value ? selected : null;
  const options =
    retained && !items.some(item => item.id === retained.id) ? [retained, ...items] : items;

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface-1 p-3 md:col-span-2 lg:col-span-4">
      <label className="block text-sm text-secondary-700">
        {t('purchasePicker.search')}
        <input
          className="input mt-1"
          type="search"
          maxLength={80}
          value={search}
          disabled={disabled}
          onChange={event => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </label>
      <p className="text-xs text-secondary-500">{t('purchasePicker.description')}</p>
      {query.error ? (
        <div role="alert" className="space-y-2 text-sm text-danger-700">
          <p>{t('purchasePicker.error')}</p>
          <button
            type="button"
            className="btn-outline"
            onClick={() => void query.refetch()}
            disabled={disabled || query.isFetching}
          >
            {t('retry')}
          </button>
        </div>
      ) : null}
      {query.isFetching && (
        <p role="status" className="text-sm text-secondary-500">
          {t('purchasePicker.loading')}
        </p>
      )}
      <fieldset
        disabled={disabled || query.isFetching || !!query.error}
        className="min-w-0 space-y-3"
      >
        <label className="block text-sm text-secondary-700">
          {t('form.purchase')}
          <select
            className="input mt-1"
            value={value}
            onChange={event => {
              const purchase = options.find(item => item.id === event.target.value) ?? null;
              setSelected(purchase);
              onChange(purchase);
            }}
          >
            <option value="">{t('form.noPurchase')}</option>
            {options.map(purchase => (
              <option key={purchase.id} value={purchase.id}>
                {purchase.purchaseNumber} · {purchase.siteName} · {formatCurrency(purchase.total)}
              </option>
            ))}
          </select>
        </label>
        {data && !query.error && !query.isFetching && (
          <>
            <p className="text-xs text-secondary-500" role="status">
              {data.total === 0
                ? t('purchasePicker.empty')
                : t('purchasePicker.total', { count: data.total })}
            </p>
            <TablePagination
              page={data.page - 1}
              pageCount={data.pageCount}
              total={data.total}
              rangeStart={data.total === 0 ? 0 : (data.page - 1) * data.perPage + 1}
              rangeEnd={Math.min(data.page * data.perPage, data.total)}
              onPageChange={next => setPage(next + 1)}
            />
          </>
        )}
      </fieldset>
    </div>
  );
}
