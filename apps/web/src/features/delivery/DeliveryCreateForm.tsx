/** Operator-created quote or explicit sale-backed delivery. No implicit checkout or inventory write. */
import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';

/** Explicit site and optional sale selected in the sale-details screen; the server revalidates ownership. */
interface DeliveryCreateFormProps {
  siteId: string;
  initialSaleId?: string | undefined;
  onCreated: (id: string) => void;
  onCancel: () => void;
}
const inputClass = 'mt-1 w-full rounded-md border border-line bg-surface-1 p-2 text-secondary-900';

export function DeliveryCreateForm({
  siteId,
  initialSaleId,
  onCreated,
  onCancel,
}: DeliveryCreateFormProps) {
  const { t } = useTranslation(['delivery', 'errors', 'fulfillmentErrors']);
  const formId = useId();
  const [mode, setMode] = useState<'manual' | 'sale'>(initialSaleId ? 'sale' : 'manual');
  const [search, setSearch] = useState(initialSaleId ?? '');
  const searchValue = useDebouncedValue(search.trim(), 250);
  const [saleId, setSaleId] = useState(initialSaleId ?? '');
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const create = useCriticalMutation('deliveryOrders.create');
  const fromSale = useCriticalMutation('deliveryOrders.createFromSale');
  const pending = create.isPending || fromSale.isPending;
  const options = trpc.deliveryOrders.saleOptions.useQuery(
    { siteId, search: searchValue },
    { enabled: mode === 'sale', staleTime: 0 }
  );
  const selectedSale = options.data?.find(row => row.id === saleId);
  const pendingSearch = search.trim() !== searchValue;
  const saleReady = !!selectedSale && !options.isFetching && !options.error && !pendingSearch;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy.current || (mode === 'sale' && !saleReady)) return;
    busy.current = true;
    setError(null);
    const fields = new FormData(event.currentTarget);
    const recipient = {
      siteId,
      customerName: String(fields.get('customerName') ?? '').trim(),
      customerPhone: String(fields.get('customerPhone') ?? '').trim(),
      address: String(fields.get('address') ?? '').trim(),
      addressNotes: String(fields.get('addressNotes') ?? '').trim(),
    };
    try {
      const result =
        mode === 'sale'
          ? await fromSale.mutateAsync({ ...recipient, saleId })
          : await create.mutateAsync({
              ...recipient,
              totalAmount: Number(fields.get('totalAmount') ?? 0),
            });
      onCreated(result.id);
    } catch (failure) {
      setError(translateServerError(failure, t, t('create.error')));
      if (mode === 'sale') void options.refetch();
    } finally {
      busy.current = false;
    }
  }
  return (
    <form onSubmit={submit} aria-label={t('create.title')} className="space-y-4">
      {error ? (
        <p role="alert" className="text-danger-700">
          {error}
        </p>
      ) : null}
      <fieldset disabled={pending} className="space-y-3">
        <label className="block" htmlFor={`${formId}-mode`}>
          {t('create.mode')}
          <select
            id={`${formId}-mode`}
            value={mode}
            className={inputClass}
            onChange={event => {
              setMode(event.target.value as 'manual' | 'sale');
              setError(null);
            }}
          >
            <option value="manual">{t('create.manual')}</option>
            <option value="sale">{t('create.sale')}</option>
          </select>
        </label>
        <p className="text-sm text-secondary-600">{t(`detail.source.${mode}`)}</p>
        {mode === 'sale' ? (
          <div className="space-y-2">
            <label className="block" htmlFor={`${formId}-search`}>
              {t('create.searchSale')}
              <input
                id={`${formId}-search`}
                value={search}
                maxLength={128}
                className={inputClass}
                onChange={event => {
                  setSearch(event.target.value);
                  setSaleId('');
                }}
              />
            </label>
            <label className="block" htmlFor={`${formId}-sale`}>
              {t('create.chooseSale')}
              <select
                id={`${formId}-sale`}
                value={saleReady ? saleId : ''}
                required
                className={inputClass}
                disabled={options.isFetching || pendingSearch || !!options.error}
                onChange={event => setSaleId(event.target.value)}
              >
                <option value="">{t('create.chooseSale')}</option>
                {options.data?.map(row => (
                  <option key={row.id} value={row.id}>
                    {row.saleNumber} · {formatCurrency(row.total, row.currencyCode)}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-secondary-600">{t('create.saleEligibility')}</p>
            {options.error ? (
              <p role="alert">
                {t('create.saleError')}{' '}
                <button type="button" onClick={() => options.refetch()}>
                  {t('page.errorRetry')}
                </button>
              </p>
            ) : null}
          </div>
        ) : (
          <label className="block" htmlFor={`${formId}-total`}>
            {t('create.quotedAmount')}
            <input
              id={`${formId}-total`}
              name="totalAmount"
              type="number"
              min="0"
              max="1000000000"
              step="0.01"
              defaultValue="0"
              required
              className={inputClass}
            />
          </label>
        )}
        <label className="block" htmlFor={`${formId}-name`}>
          {t('create.recipient')}
          <input
            id={`${formId}-name`}
            name="customerName"
            required
            maxLength={160}
            autoComplete="name"
            className={inputClass}
          />
        </label>
        <label className="block" htmlFor={`${formId}-phone`}>
          {t('detail.phoneLabel')}
          <input
            id={`${formId}-phone`}
            name="customerPhone"
            type="tel"
            maxLength={40}
            autoComplete="tel"
            className={inputClass}
          />
        </label>
        <label className="block" htmlFor={`${formId}-address`}>
          {t('detail.addressLabel')}
          <input
            id={`${formId}-address`}
            name="address"
            required
            maxLength={500}
            autoComplete="street-address"
            className={inputClass}
          />
        </label>
        <label className="block" htmlFor={`${formId}-notes`}>
          {t('detail.addressNotesLabel')}
          <textarea
            id={`${formId}-notes`}
            name="addressNotes"
            maxLength={500}
            className={inputClass}
          />
        </label>
      </fieldset>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded border border-line px-3 py-2"
        >
          {t('create.dismiss')}
        </button>
        <button
          type="submit"
          disabled={pending || (mode === 'sale' && !saleReady)}
          className="rounded bg-primary-700 px-3 py-2 text-white disabled:opacity-50"
        >
          {pending ? t('create.saving') : t('create.submit')}
        </button>
      </div>
    </form>
  );
}
