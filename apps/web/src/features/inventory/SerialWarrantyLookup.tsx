import { useState } from 'react';
import { Search, ShieldCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { Button } from '@/components/ui';
export function SerialWarrantyLookup() {
  const { t } = useTranslation(['inventory', 'errors']);
  const [draft, setDraft] = useState('');
  const [serialNumber, setSerialNumber] = useState('');
  const lookup = trpc.productSerials.lookup.useQuery(
    {
      serialNumber: serialNumber || '__idle__',
    },
    {
      enabled: serialNumber.length > 0,
    }
  );
  const items = lookup.data?.items ?? [];
  return (
    <section className="card p-5" aria-labelledby="serial-warranty-title">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-kicker">{t('serialLookup.kicker')}</p>
          <h2
            id="serial-warranty-title"
            className="mt-2 flex items-center gap-2 text-lg font-semibold text-secondary-950"
          >
            <ShieldCheck className="h-5 w-5 text-primary-600" aria-hidden="true" />
            {t('serialLookup.title')}
          </h2>
          <p className="mt-1 text-sm text-secondary-600">{t('serialLookup.description')}</p>
        </div>
        <form
          className="flex w-full max-w-xl gap-2"
          onSubmit={event => {
            event.preventDefault();
            setSerialNumber(draft.trim());
          }}
        >
          <label htmlFor="serial-warranty-search" className="sr-only">
            {t('serialLookup.inputLabel')}
          </label>
          <input
            id="serial-warranty-search"
            className="pv-input flex-1 font-mono"
            value={draft}
            onChange={event => setDraft(event.target.value)}
            placeholder={t('serialLookup.placeholder')}
          />
          <Button className="min-h-11" type="submit" disabled={!draft.trim()} variant="primary">
            <Search className="h-4 w-4" aria-hidden="true" />
            {t('serialLookup.search')}
          </Button>
        </form>
      </div>

      {serialNumber && lookup.isLoading && (
        <p className="mt-4 text-sm text-secondary-500" role="status">
          {t('serialLookup.loading')}
        </p>
      )}
      {serialNumber && lookup.error && (
        <p
          className="mt-4 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700"
          role="alert"
        >
          {translateServerError(lookup.error, t, t('errors:server.unknown'))}
        </p>
      )}
      {serialNumber && !lookup.isLoading && !lookup.error && items.length === 0 && (
        <p className="mt-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-secondary-600">
          {t('serialLookup.notFound', {
            serial: serialNumber,
          })}
        </p>
      )}
      {items.map(item => {
        // Draft, cancelled and voided rows remain in the immutable provenance
        // bridge for auditability, but they never established warranty ownership.
        const latestSale = item.history
          .filter(historyEntry => historyEntry.saleStatus === 'completed')
          .at(-1);
        const saleNumber = item.saleNumber ?? latestSale?.saleNumber;
        const customerName = item.customerName ?? latestSale?.customerName;
        return (
          <dl
            key={item.id}
            className="mt-4 grid gap-3 rounded-xl border border-primary-100 bg-primary-50/60 p-4 sm:grid-cols-2 lg:grid-cols-4"
          >
            <div>
              <dt className="text-xs text-secondary-500">{t('serialLookup.product')}</dt>
              <dd className="font-medium text-secondary-950">{item.productName}</dd>
              <dd className="font-mono text-xs text-secondary-600">{item.productSku}</dd>
            </div>
            <div>
              <dt className="text-xs text-secondary-500">{t('serialLookup.status')}</dt>
              <dd className="font-medium text-secondary-950">
                {t(`serialLookup.statuses.${item.status}`)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-secondary-500">{t('serialLookup.sale')}</dt>
              <dd className="font-medium text-secondary-950">
                {saleNumber ?? t('serialLookup.noSale')}
              </dd>
              {customerName && <dd className="text-xs text-secondary-600">{customerName}</dd>}
            </div>
            <div>
              <dt className="text-xs text-secondary-500">{t('serialLookup.warranty')}</dt>
              <dd className="font-medium text-secondary-950">
                {item.warrantyExpiresAt ?? t('serialLookup.noWarranty')}
              </dd>
            </div>
          </dl>
        );
      })}
    </section>
  );
}
