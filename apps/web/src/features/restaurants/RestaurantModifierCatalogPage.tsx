import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Pencil, Archive } from 'lucide-react';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { Modal } from '@/components/form-controls/Modal';
import { useTenant } from '@/features/tenant/TenantProvider';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { translateServerError } from '@/lib/translateServerError';
import { formatCurrency } from '@/lib/utils';

/** Public projection has no employee ids or audit metadata. */
export type RestaurantCatalogEntry =
  inferRouterOutputs<AppRouter>['restaurantModifiers']['list']['items'][number];
/** Exact version captured when editing; refresh never silently overwrites manager input. */
type CatalogDraft = Omit<inferRouterInputs<AppRouter>['restaurantModifiers']['save'], 'siteId'>;
const blank = (): CatalogDraft => ({
  expectedVersion: 0,
  name: '',
  unitPriceDelta: 0,
  maxQuantity: 1,
  requiresManager: false,
  isActive: true,
});
function edit(row: RestaurantCatalogEntry): CatalogDraft {
  return {
    id: row.id,
    expectedVersion: row.version,
    name: row.name,
    unitPriceDelta: row.unitPriceDelta,
    maxQuantity: row.maxQuantity,
    requiresManager: row.requiresManager,
    isActive: row.isActive,
  };
}

/** Reset editing and pagination when the active site changes. */
export function RestaurantModifierCatalogPage() {
  const { currentSite } = useTenant();
  return (
    <CatalogSite
      key={currentSite?.id ?? ''}
      siteId={currentSite?.id ?? ''}
      siteName={currentSite?.name ?? ''}
    />
  );
}
function CatalogSite({ siteId, siteName }: { siteId: string; siteName: string }) {
  const { t } = useTranslation(['restaurants', 'common', 'errors']);
  const [search, setSearch] = useState(''),
    [includeArchived, setIncludeArchived] = useState(false),
    [offset, setOffset] = useState(0);
  const debouncedSearch = useDebouncedValue(search, 250);
  const [draft, setDraft] = useState<CatalogDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const list = trpc.restaurantModifiers.list.useQuery(
    { siteId, search: debouncedSearch, includeArchived, offset },
    { enabled: !!siteId, trpc: { abortOnUnmount: true } }
  );
  if (!siteId) return <p role="status">{t('catalog.noSite')}</p>;
  return (
    <section className="space-y-6" data-testid="modifier-catalog-page">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">{t('catalog.title')}</h1>
          <p className="mt-1 text-sm text-fg2">{siteName}</p>
          <p className="mt-2 max-w-2xl text-sm text-fg3">{t('catalog.description')}</p>
        </div>
        <button
          type="button"
          className="btn-primary min-h-11"
          onClick={() => {
            setSaved(false);
            setDraft(blank());
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('catalog.create')}
        </button>
      </header>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
          {t('catalog.search')}
          <input
            type="search"
            className="input min-h-11"
            maxLength={80}
            value={search}
            onChange={e => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={e => {
              setIncludeArchived(e.target.checked);
              setOffset(0);
            }}
          />
          {t('catalog.includeArchived')}
        </label>
      </div>
      {saved && (
        <p role="status" className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
          {t('catalog.saved')}
        </p>
      )}
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
          {list.data?.items.length === 0 && (
            <p className="rounded-xl border border-dashed border-line p-8 text-center text-fg3">
              {t('catalog.empty')}
            </p>
          )}
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.data?.items.map(row => (
              <li key={row.id} className="card flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <h2 className="break-words font-semibold">{row.name}</h2>
                  <p className="mt-1 font-semibold tabular-nums">
                    {formatCurrency(row.unitPriceDelta)}
                  </p>
                  <p className="mt-1 text-sm text-fg3">
                    {t('catalog.quantityLimit', { count: row.maxQuantity })}
                  </p>
                  {row.requiresManager && (
                    <p className="mt-2 text-xs font-medium text-fg2">{t('catalog.managerOnly')}</p>
                  )}
                  {!row.isActive && (
                    <p className="mt-2 flex items-center gap-1 text-xs text-fg3">
                      <Archive className="h-3 w-3" aria-hidden="true" />
                      {t('catalog.archived')}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  className="btn-outline min-h-11 shrink-0"
                  disabled={list.isFetching}
                  aria-label={t('catalog.editNamed', { name: row.name })}
                  onClick={() => {
                    setSaved(false);
                    setDraft(edit(row));
                  }}
                >
                  <Pencil className="h-4 w-4" aria-hidden="true" />
                  {t('catalog.edit')}
                </button>
              </li>
            ))}
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
      {draft && (
        <CatalogForm
          key={draft.id ?? 'new'}
          siteId={siteId}
          initial={draft}
          onClose={() => {
            setDraft(null);
            void list.refetch();
          }}
          onSaved={() => {
            setSaved(true);
            setDraft(null);
            void list.refetch();
          }}
        />
      )}
    </section>
  );
}
function CatalogForm({
  siteId,
  initial,
  onClose,
  onSaved,
}: {
  siteId: string;
  initial: CatalogDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['restaurants', 'common', 'errors']);
  const [draft, setDraft] = useState(initial),
    [error, setError] = useState<string | null>(null);
  const busy = useRef(false),
    save = useCriticalMutation('restaurantModifiers.save');
  const utils = trpc.useUtils();
  return (
    <Modal
      isOpen
      onClose={() => {
        if (!busy.current) onClose();
      }}
      title={t(initial.id ? 'catalog.edit' : 'catalog.create')}
      size="md"
    >
      <form
        className="space-y-4"
        onSubmit={async e => {
          e.preventDefault();
          if (busy.current) return;
          busy.current = true;
          setError(null);
          try {
            await save.mutateAsync({ siteId, ...draft });
            await utils.restaurantModifiers.invalidate();
            onSaved();
          } catch (failure) {
            setError(translateServerError(failure, t, t('errors:server.unknown')));
          } finally {
            busy.current = false;
          }
        }}
      >
        <p className="text-sm text-fg3">{t('catalog.historyHelp')}</p>
        <fieldset disabled={save.isPending} className="space-y-4">
          <label className="flex flex-col gap-1 text-sm">
            {t('catalog.name')}
            <input
              autoFocus
              required
              maxLength={80}
              className="input min-h-11"
              value={draft.name}
              onChange={e => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              {t('catalog.price')}
              <input
                required
                type="number"
                min={0}
                max={1_000_000_000}
                step="0.01"
                className="input min-h-11"
                value={Number.isFinite(draft.unitPriceDelta) ? draft.unitPriceDelta : ''}
                onChange={e => setDraft({ ...draft, unitPriceDelta: e.target.valueAsNumber })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              {t('catalog.maxQuantity')}
              <input
                required
                type="number"
                min={1}
                max={20}
                step={1}
                className="input min-h-11"
                value={Number.isFinite(draft.maxQuantity) ? draft.maxQuantity : ''}
                onChange={e => setDraft({ ...draft, maxQuantity: e.target.valueAsNumber })}
              />
            </label>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.requiresManager}
              onChange={e => setDraft({ ...draft, requiresManager: e.target.checked })}
            />
            {t('catalog.managerOnly')}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={e => setDraft({ ...draft, isActive: e.target.checked })}
            />
            {t('catalog.active')}
          </label>
          {!draft.isActive && (
            <p className="rounded-lg bg-surface-2 p-3 text-sm">{t('catalog.archiveHelp')}</p>
          )}
          {error && (
            <div role="alert" className="space-y-2 text-sm text-danger-700">
              <p>{error}</p>
              <button type="button" className="btn-outline min-h-11" onClick={onClose}>
                {t('catalog.returnToList')}
              </button>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-outline min-h-11" onClick={onClose}>
              {t('common:actions.cancel')}
            </button>
            <button type="submit" className="btn-primary min-h-11" disabled={!draft.name.trim()}>
              {t(save.isPending ? 'common:status.loading' : 'common:actions.save')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
