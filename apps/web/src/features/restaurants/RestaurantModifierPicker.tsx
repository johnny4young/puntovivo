import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LockKeyhole, Plus } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';
import type { RestaurantCatalogEntry } from './RestaurantModifierCatalogPage';

/** Mount only one bounded page on demand; no per-cart-line hidden catalog DOM. */
export function RestaurantModifierPicker({
  siteId,
  canManage,
  selectedNames,
  onSelect,
  onClose,
}: {
  siteId: string;
  canManage: boolean;
  selectedNames: string[];
  onSelect: (row: RestaurantCatalogEntry) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation(['restaurants', 'common', 'errors']);
  const [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0);
  const debouncedSearch = useDebouncedValue(search, 250);
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
      </div>
    </Modal>
  );
}
