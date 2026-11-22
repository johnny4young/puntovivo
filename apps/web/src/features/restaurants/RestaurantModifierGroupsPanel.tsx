import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Archive, ArrowDown, ArrowUp, Pencil, Plus, X } from 'lucide-react';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { Modal } from '@/components/form-controls/Modal';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { useSingleFlightSubmit } from '@/lib/useSingleFlightSubmit';
import { formatCurrency } from '@/lib/utils';

/** Editor projection: rule, ordered options (archived ones included) and assigned dishes. */
export type RestaurantModifierGroup =
  inferRouterOutputs<AppRouter>['restaurantModifiers']['groups'][number];
type SaveGroupInput = inferRouterInputs<AppRouter>['restaurantModifiers']['saveGroup'];
type GroupKind = SaveGroupInput['kind'];
type GroupOption = Pick<
  RestaurantModifierGroup['options'][number],
  'catalogId' | 'name' | 'unitPriceDelta' | 'isActive'
>;
interface GroupDraft {
  id?: string;
  expectedVersion: number;
  name: string;
  kind: GroupKind;
  selection: SaveGroupInput['selection'];
  required: boolean;
  minSelections: number;
  maxSelections: number;
  isActive: boolean;
  options: GroupOption[];
  products: { id: string; name: string }[];
}

const KINDS: GroupKind[] = ['choice', 'without', 'extra'];
/** Mirrors the server's per-group option bound (one plate holds at most 20 modifiers). */
const MAX_GROUP_OPTIONS = 20;
/** A new group starts with the rule its kind usually has: one required preparation, free extras. */
const KIND_DEFAULTS: Record<GroupKind, Pick<GroupDraft, 'selection' | 'required'>> = {
  choice: { selection: 'single', required: true },
  without: { selection: 'multiple', required: false },
  extra: { selection: 'multiple', required: false },
};
const blank = (): GroupDraft => ({
  expectedVersion: 0,
  name: '',
  kind: 'choice',
  ...KIND_DEFAULTS.choice,
  minSelections: 1,
  maxSelections: 1,
  isActive: true,
  options: [],
  products: [],
});
function edit(group: RestaurantModifierGroup): GroupDraft {
  return {
    id: group.id,
    expectedVersion: group.version,
    name: group.name,
    kind: group.kind,
    selection: group.selection,
    required: group.minSelections > 0,
    minSelections: Math.max(1, group.minSelections),
    maxSelections: group.maxSelections,
    isActive: group.isActive,
    options: group.options,
    products: group.products,
  };
}
/** The stored maximum may exceed the options after a removal; what counts is this. */
function effectiveMax(draft: GroupDraft): number {
  return draft.selection === 'single'
    ? 1
    : Math.min(draft.maxSelections, Math.max(1, draft.options.length));
}
function toInput(siteId: string, draft: GroupDraft): SaveGroupInput {
  const single = draft.selection === 'single';
  const maxSelections = effectiveMax(draft);
  return {
    siteId,
    ...(draft.id ? { id: draft.id } : {}),
    expectedVersion: draft.expectedVersion,
    name: draft.name,
    kind: draft.kind,
    selection: draft.selection,
    minSelections: draft.required ? (single ? 1 : Math.min(draft.minSelections, maxSelections)) : 0,
    maxSelections,
    isActive: draft.isActive,
    catalogIds: draft.options.map(option => option.catalogId),
    productIds: draft.products.map(product => product.id),
  };
}

/** Rule as the plate sheet will phrase it. */
function groupRule(
  t: TFunction,
  group: Pick<RestaurantModifierGroup, 'selection' | 'minSelections' | 'maxSelections'>
): string {
  const { minSelections: min, maxSelections: max } = group;
  if (group.selection === 'single')
    return t(min ? 'groups.rule.chooseOne' : 'groups.rule.atMostOne');
  if (min === 0) return t('groups.rule.upTo', { count: max });
  if (min === max) return t('groups.rule.exactly', { count: max });
  return t('groups.rule.range', { min, max });
}

/** Site groups: what each dish asks for, in the order the plate sheet shows it. */
export function RestaurantModifierGroupsPanel({ siteId }: { siteId: string }) {
  const { t } = useTranslation(['restaurants', 'common', 'errors']);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [draft, setDraft] = useState<GroupDraft | null>(null);
  const [saved, setSaved] = useState(false);
  const groups = trpc.restaurantModifiers.groups.useQuery(
    { siteId, includeArchived },
    { trpc: { abortOnUnmount: true } }
  );
  return (
    <section
      id="modifier-catalog-panel-groups"
      role="tabpanel"
      aria-labelledby="modifier-catalog-tab-groups"
      className="space-y-4"
      data-testid="modifier-groups-panel"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={e => setIncludeArchived(e.target.checked)}
          />
          {t('groups.includeArchived')}
        </label>
        <button
          type="button"
          className="btn-primary min-h-11"
          onClick={() => {
            setSaved(false);
            setDraft(blank());
          }}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('groups.create')}
        </button>
      </div>
      {saved && (
        <p role="status" className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
          {t('groups.saved')}
        </p>
      )}
      {groups.isFetching && <p role="status">{t('common:status.loading')}</p>}
      {groups.error ? (
        <div role="alert">
          <p>{translateServerError(groups.error, t, t('errors:server.unknown'))}</p>
          <button
            type="button"
            className="btn-outline min-h-11"
            onClick={() => void groups.refetch()}
          >
            {t('common:actions.retry')}
          </button>
        </div>
      ) : (
        <>
          {groups.data?.length === 0 && (
            <p className="rounded-xl border border-dashed border-line p-8 text-center text-fg3">
              {t('groups.empty')}
            </p>
          )}
          <ul className="grid gap-3 lg:grid-cols-2">
            {groups.data?.map(group => (
              <li key={group.id} className="card space-y-3 p-4" data-testid="modifier-group-card">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 break-words pt-3 text-xs font-semibold uppercase tracking-wider text-fg2">
                    {group.name} · {groupRule(t, group)}
                  </h2>
                  <button
                    type="button"
                    className="btn-outline min-h-11 shrink-0"
                    disabled={groups.isFetching}
                    aria-label={t('groups.editNamed', { name: group.name })}
                    onClick={() => {
                      setSaved(false);
                      setDraft(edit(group));
                    }}
                  >
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                    {t('groups.edit')}
                  </button>
                </div>
                <ul className="flex flex-wrap gap-2" aria-label={t('groups.options')}>
                  {group.options.map(option => (
                    <li
                      key={option.catalogId}
                      className={`modifier-option ${option.isActive ? '' : 'line-through'}`}
                    >
                      <OptionLabel name={option.name} unitPriceDelta={option.unitPriceDelta} />
                    </li>
                  ))}
                </ul>
                <p className="text-sm text-fg2">
                  <span className="font-semibold text-fg1">{t(`groups.kinds.${group.kind}`)}</span>
                  {' · '}
                  {group.products.length
                    ? group.products.map(product => product.name).join(', ')
                    : t('groups.noDishes')}
                </p>
                {!group.isActive && (
                  <p className="flex items-center gap-1 text-xs text-fg3">
                    <Archive className="h-3 w-3" aria-hidden="true" />
                    {t('catalog.archived')}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {draft && (
        <GroupForm
          key={draft.id ?? 'new'}
          siteId={siteId}
          initial={draft}
          onClose={() => {
            setDraft(null);
            void groups.refetch();
          }}
          onSaved={() => {
            setSaved(true);
            setDraft(null);
          }}
        />
      )}
    </section>
  );
}

function OptionLabel({ name, unitPriceDelta }: { name: string; unitPriceDelta: number }) {
  return (
    <>
      {name}
      {unitPriceDelta > 0 && ' '}
      {unitPriceDelta > 0 && (
        <small className="tabular-nums">+ {formatCurrency(unitPriceDelta)}</small>
      )}
    </>
  );
}

function SegmentedChoice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm">{label}</legend>
      <div className="segmented-control">
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            className={`segmented-tab ${value === option.value ? 'segmented-tab-active' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function CountInput({
  label,
  value,
  max,
  onChange,
}: {
  label: ReactNode;
  value: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="flex w-28 flex-col gap-1 text-sm">
      {label}
      <input
        type="number"
        required
        min={1}
        max={max}
        step={1}
        className="input min-h-11"
        value={value}
        onChange={e => onChange(Math.max(1, Math.trunc(e.target.valueAsNumber || 1)))}
      />
    </label>
  );
}

function GroupForm({
  siteId,
  initial,
  onClose,
  onSaved,
}: {
  siteId: string;
  initial: GroupDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation(['restaurants', 'common', 'errors']);
  const [draft, setDraft] = useState(initial),
    [error, setError] = useState<string | null>(null),
    [optionSearch, setOptionSearch] = useState(''),
    [dishSearch, setDishSearch] = useState('');
  const save = useCriticalMutation('restaurantModifiers.saveGroup');
  const utils = trpc.useUtils();
  const optionQuery = useDebouncedValue(optionSearch, 250),
    dishQuery = useDebouncedValue(dishSearch.trim(), 250);
  // Same input shape as the options tab, so its first page is a cache hit.
  const catalog = trpc.restaurantModifiers.list.useQuery(
    { siteId, search: optionQuery, includeArchived: false, offset: 0 },
    { trpc: { abortOnUnmount: true } }
  );
  const dishes = trpc.products.search.useQuery(
    { q: dishQuery || '_', limit: 10, isActive: true },
    { enabled: dishQuery.length > 0, trpc: { abortOnUnmount: true } }
  );
  const single = draft.selection === 'single';
  const optionCount = draft.options.length;
  const max = effectiveMax(draft);
  const chosen = new Set(draft.options.map(option => option.catalogId));
  const assigned = new Set(draft.products.map(product => product.id));
  const patch = (next: Partial<GroupDraft>) => setDraft(current => ({ ...current, ...next }));
  function move(index: number, offset: -1 | 1) {
    const options = [...draft.options];
    const [row] = options.splice(index, 1);
    options.splice(index + offset, 0, row!);
    patch({ options });
  }
  const submit = useSingleFlightSubmit(!save.isPending, async () => {
    setError(null);
    try {
      await save.mutateAsync(toInput(siteId, draft));
      await utils.restaurantModifiers.groups.invalidate();
      onSaved();
    } catch (failure) {
      setError(translateServerError(failure, t, t('errors:server.unknown')));
    }
  });

  return (
    <Modal
      isOpen
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      title={t(initial.id ? 'groups.edit' : 'groups.create')}
      size="lg"
    >
      <form
        className="space-y-5"
        data-testid="modifier-group-form"
        onSubmit={e => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset disabled={save.isPending} className="space-y-5">
          <label className="flex flex-col gap-1 text-sm">
            {t('groups.name')}
            <input
              autoFocus
              required
              maxLength={80}
              className="input min-h-11"
              value={draft.name}
              onChange={e => patch({ name: e.target.value })}
            />
          </label>
          <SegmentedChoice
            label={t('groups.kind')}
            value={draft.kind}
            options={KINDS.map(kind => ({ value: kind, label: t(`groups.kinds.${kind}`) }))}
            onChange={kind => patch({ kind, ...(draft.id ? {} : KIND_DEFAULTS[kind]) })}
          />
          <div className="flex flex-wrap items-end gap-4">
            <SegmentedChoice
              label={t('groups.selection')}
              value={draft.selection}
              options={(['single', 'multiple'] as const).map(value => ({
                value,
                label: t(`groups.selections.${value}`),
              }))}
              onChange={selection =>
                patch({
                  selection,
                  maxSelections: selection === 'single' ? 1 : Math.max(1, optionCount),
                })
              }
            />
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.required}
                onChange={e => patch({ required: e.target.checked })}
              />
              {t('groups.required')}
            </label>
            {!single && draft.required && (
              <CountInput
                label={t('groups.min')}
                value={Math.min(draft.minSelections, max)}
                max={max}
                onChange={minSelections => patch({ minSelections })}
              />
            )}
            {!single && (
              <CountInput
                label={t('groups.max')}
                value={max}
                max={Math.max(1, optionCount)}
                onChange={maxSelections => patch({ maxSelections })}
              />
            )}
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t('groups.options')}</legend>
            <ol className="space-y-2">
              {draft.options.map((option, index) => (
                <li
                  key={option.catalogId}
                  className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3"
                  data-testid="modifier-group-option"
                >
                  <span
                    className={`min-w-0 flex-1 truncate ${option.isActive ? '' : 'line-through'}`}
                  >
                    <OptionLabel name={option.name} unitPriceDelta={option.unitPriceDelta} />
                  </span>
                  <button
                    type="button"
                    className="btn-ghost btn-icon min-h-11 min-w-11"
                    disabled={index === 0}
                    aria-label={t('groups.moveUp', { name: option.name })}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-icon min-h-11 min-w-11"
                    disabled={index === optionCount - 1}
                    aria-label={t('groups.moveDown', { name: option.name })}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-icon min-h-11 min-w-11"
                    aria-label={t('groups.remove', { name: option.name })}
                    onClick={() =>
                      patch({
                        options: draft.options.filter(row => row.catalogId !== option.catalogId),
                      })
                    }
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ol>
            <label className="flex flex-col gap-1 text-sm">
              {t('groups.addOption')}
              <input
                type="search"
                maxLength={80}
                className="input min-h-11"
                value={optionSearch}
                onChange={e => setOptionSearch(e.target.value)}
              />
            </label>
            <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto">
              {catalog.data?.items
                .filter(row => !chosen.has(row.id))
                .map(row => (
                  <button
                    key={row.id}
                    type="button"
                    className="modifier-option"
                    disabled={optionCount >= MAX_GROUP_OPTIONS}
                    data-testid="modifier-group-option-result"
                    onClick={() =>
                      patch({
                        // The maximum follows the option count until the manager lowers it.
                        maxSelections:
                          draft.maxSelections >= optionCount
                            ? optionCount + 1
                            : draft.maxSelections,
                        options: [
                          ...draft.options,
                          {
                            catalogId: row.id,
                            name: row.name,
                            unitPriceDelta: row.unitPriceDelta,
                            isActive: row.isActive,
                          },
                        ],
                      })
                    }
                  >
                    <Plus className="h-4 w-4" aria-hidden="true" />
                    <OptionLabel name={row.name} unitPriceDelta={row.unitPriceDelta} />
                  </button>
                ))}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t('groups.dishes')}</legend>
            <ul className="flex flex-wrap gap-2">
              {draft.products.map(product => (
                <li key={product.id} data-testid="modifier-group-dish">
                  <button
                    type="button"
                    className="modifier-option"
                    aria-label={t('groups.remove', { name: product.name })}
                    onClick={() =>
                      patch({ products: draft.products.filter(row => row.id !== product.id) })
                    }
                  >
                    {product.name}
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <label className="flex flex-col gap-1 text-sm">
              {t('groups.addDish')}
              <input
                type="search"
                maxLength={120}
                className="input min-h-11"
                value={dishSearch}
                onChange={e => setDishSearch(e.target.value)}
              />
            </label>
            {dishQuery.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {dishes.data?.items
                  .filter(product => !assigned.has(product.id))
                  .map(product => (
                    <button
                      key={product.id}
                      type="button"
                      className="modifier-option"
                      data-testid="modifier-group-dish-result"
                      onClick={() =>
                        patch({
                          products: [...draft.products, { id: product.id, name: product.name }],
                        })
                      }
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      {product.name}
                    </button>
                  ))}
              </div>
            )}
          </fieldset>

          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.isActive}
              onChange={e => patch({ isActive: e.target.checked })}
            />
            {t('groups.active')}
          </label>
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
            <button
              type="submit"
              className="btn-primary min-h-11"
              disabled={!draft.name.trim() || optionCount === 0}
            >
              {t(save.isPending ? 'common:status.loading' : 'common:actions.save')}
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  );
}
