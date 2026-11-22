import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LockKeyhole, Plus } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';
import type { RestaurantCatalogEntry } from './RestaurantModifierCatalogPage';
import { RESTAURANT_MODIFIER_PRICE_MAX } from './restaurantDraft';

/** Mount only one bounded page on demand; no per-cart-line hidden catalog DOM. */
export function RestaurantModifierPicker({
  siteId,
  canManage,
  selectedNames,
  onSelect,
  onCustom,
  onClose,
}: {
  siteId: string;
  canManage: boolean;
  selectedNames: string[];
  onSelect: (row: RestaurantCatalogEntry) => void;
  /** Managers may add a one-off priced add-on that is not in the catalog. */
  onCustom?: ((name: string, unitPriceDelta: number) => void) | undefined;
  onClose: () => void;
}) {
  const { t } = useTranslation(['restaurants', 'common', 'errors']);
  const [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0);
  const [customName, setCustomName] = useState(''),
    [customPrice, setCustomPrice] = useState('');
  const debouncedSearch = useDebouncedValue(search, 250);
  const trimmedCustom = customName.trim();
  const customPriceValue = Number(customPrice);
  const customDuplicate = selectedNames.includes(trimmedCustom.toLowerCase());
  const customValid =
    trimmedCustom.length > 0 &&
    !customDuplicate &&
    customPrice.trim() !== '' &&
    Number.isFinite(customPriceValue) &&
    customPriceValue >= 0 &&
    customPriceValue <= RESTAURANT_MODIFIER_PRICE_MAX;
  const list = trpc.restaurantModifiers.list.useQuery(
    { siteId, search: debouncedSearch, offset },
    { staleTime: 0, trpc: { abortOnUnmount: true } }
  );
  return (
    <Modal isOpen onClose={onClose} title={t('catalog.choose')} size="md">
      <div className="space-y-4">
        <p className="text-sm text-fg3">{t('catalog.chooseHelp')}</p>
        <label className="flex flex-col gap-1 text-sm">
          {t('catalog.search')}
          <input
            type="search"
            autoFocus
            maxLength={80}
            className="input min-h-11"
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        {list.isFetching && <p role="status">{t('common:status.loading')}</p>}
        {list.error ? (
          <div role="alert">
            <p>{translateServerError(list.error, t, t('errors:server.unknown'))}</p>
            <button
              type="button"
              className="btn-outline min-h-11"
              onClick={() => void list.refetch()}
            >
              {t('common:actions.retry')}
            </button>
          </div>
        ) : (
          <>
            {list.data?.items.length === 0 && <p>{t('catalog.empty')}</p>}
            <ul className="max-h-[45dvh] space-y-2 overflow-y-auto">
              {list.data?.items.map(row => {
                const restricted = row.requiresManager && !canManage,
                  selected = selectedNames.includes(row.name.toLowerCase());
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      className="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-line p-3 text-left hover:bg-surface-2 disabled:opacity-60"
                      disabled={restricted || selected || list.isFetching}
                      onClick={() => onSelect(row)}
                    >
                      <span className="min-w-0">
                        <span className="block break-words font-semibold">{row.name}</span>
                        <span className="block text-xs text-fg3">
                          {t(
                            restricted
                              ? 'catalog.managerOnly'
                              : selected
                                ? 'catalog.selected'
                                : 'catalog.quantityLimit',
                            { count: row.maxQuantity }
                          )}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 font-semibold tabular-nums">
                        {formatCurrency(row.unitPriceDelta)}
                        {restricted ? (
                          <LockKeyhole className="h-4 w-4" aria-hidden="true" />
                        ) : (
                          <Plus className="h-4 w-4" aria-hidden="true" />
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <nav className="flex justify-between gap-3" aria-label={t('catalog.pagination')}>
              <button
                type="button"
                className="btn-outline min-h-11"
                disabled={offset === 0 || list.isFetching}
                onClick={() => setOffset(Math.max(0, offset - 25))}
              >
                {t('catalog.previous')}
              </button>
              <button
                type="button"
                className="btn-outline min-h-11"
                disabled={list.data?.nextOffset == null || list.isFetching}
                onClick={() => setOffset(list.data!.nextOffset!)}
              >
                {t('catalog.next')}
              </button>
            </nav>
          </>
        )}
        {onCustom && (
          <form
            className="space-y-2 border-t border-line pt-4"
            aria-label={t('catalog.custom')}
            onSubmit={event => {
              event.preventDefault();
              if (customValid) onCustom(trimmedCustom, customPriceValue);
            }}
          >
            <p className="text-sm font-semibold text-fg2">{t('catalog.custom')}</p>
            <div className="grid grid-cols-[1fr_8rem] gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-fg2">
                {t('catalog.name')}
                <input
                  className="input min-h-11"
                  maxLength={80}
                  value={customName}
                  aria-invalid={customDuplicate || undefined}
                  onChange={e => setCustomName(e.target.value)}
                  data-testid="modifier-picker-custom-name"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-fg2">
                {t('catalog.price')}
                <input
                  className="input min-h-11"
                  type="number"
                  min={0}
                  max={RESTAURANT_MODIFIER_PRICE_MAX}
                  step="0.01"
                  inputMode="decimal"
                  value={customPrice}
                  onChange={e => setCustomPrice(e.target.value)}
                  data-testid="modifier-picker-custom-price"
                />
              </label>
            </div>
            {customDuplicate && (
              <p role="alert" className="text-xs text-danger-700">
                {t('catalog.selected')}
              </p>
            )}
            <button
              type="submit"
              className="btn-outline min-h-11 w-full"
              disabled={!customValid}
              data-testid="modifier-picker-custom-add"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t('catalog.customAdd')}
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
