import { useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, Search, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  MAX_SITE_QUICK_KEYS,
  SITE_QUICK_KEY_COLOURS,
  type SiteQuickKeyColour,
  type SiteQuickKeyKind,
} from '@puntovivo/shared/quick-keys';
import { useToast } from '@/components/feedback/ToastProvider';
import { Modal } from '@/components/form-controls/Modal';
import { useRegisterZone } from '@/features/modules/useRegisterZone';
import { useSiteQuickKeys, type SiteQuickKey } from '@/features/sales/siteQuickKeys';
import { useDebouncedValue } from '@/hooks';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';

interface SiteQuickKeysEditorProps {
  siteId: string;
  onClose: () => void;
}

const SEARCH_PAGE_SIZE = 8;

/** Managers choose, colour, name and order the keys every register of the site shows. */
export function SiteQuickKeysEditor({ siteId, onClose }: SiteQuickKeysEditorProps) {
  const { t } = useTranslation('salesQuickAccess');
  const sellsByValue = useRegisterZone('weight-value');
  const toast = useToast();
  const utils = trpc.useUtils();
  const { keys } = useSiteQuickKeys(siteId);
  const [searchText, setSearchText] = useState('');
  const search = useDebouncedValue(searchText.trim(), 250);

  const editOptions = {
    onSuccess: (list: SiteQuickKey[]) => utils.quickKeys.list.setData({ siteId }, list),
    onError: onErrorToast(toast, t, { titleKey: 'saveFailed' }),
  };
  const setMutation = trpc.quickKeys.set.useMutation(editOptions);
  const removeMutation = trpc.quickKeys.remove.useMutation(editOptions);
  const reorderMutation = trpc.quickKeys.reorder.useMutation(editOptions);
  // A label saves on blur, so only order changes lock the rows; a pending save must not eat the next tap.
  const reordering = removeMutation.isPending || reorderMutation.isPending;

  const productsQuery = trpc.products.list.useQuery(
    { page: 1, perPage: SEARCH_PAGE_SIZE, isActive: true, siteId, search: search || undefined },
    { staleTime: 60_000, placeholderData: keepPreviousData }
  );
  const results = productsQuery.data?.items ?? [];
  const isFull = keys.length >= MAX_SITE_QUICK_KEYS;

  const update = (
    key: SiteQuickKey,
    change: { label?: string; colour?: SiteQuickKeyColour | null }
  ) =>
    setMutation.mutate({
      siteId,
      id: key.id,
      kind: key.kind,
      productId: key.productId,
      unitId: key.unitId,
      ...change,
    });

  const move = (index: number, offset: -1 | 1) => {
    // Registers hide retired keys, so step over them to make every move visible on the strip.
    let target = index + offset;
    while (keys[target]?.sellable === false) target += offset;
    if (!keys[target]) target = index + offset;
    const ids = keys.map(key => key.id);
    const [moved] = ids.splice(index, 1);
    if (!moved) return;
    ids.splice(target, 0, moved);
    reorderMutation.mutate({ siteId, ids });
  };

  const hasKey = (productId: string, kind: SiteQuickKeyKind) =>
    keys.some(key => key.productId === productId && key.kind === kind && key.unitId === null);

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t('editor.title')}
      size="lg"
      footer={
        <button type="button" className="btn-primary min-h-11" onClick={onClose}>
          {t('editor.done')}
        </button>
      }
    >
      <div className="flex flex-col gap-5" data-testid="sales-quick-keys-editor">
        <section aria-labelledby="sales-quick-keys-editor-current">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="sales-quick-keys-editor-current" className="sales-cap">
              {t('editor.current')}
            </h3>
            <span className="text-sm tabular-nums text-fg2" data-testid="sales-quick-keys-count">
              {t('editor.count', { count: keys.length, max: MAX_SITE_QUICK_KEYS })}
            </span>
          </div>
          {keys.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-line p-4 text-sm text-fg2">
              {t('noFavorites')}
            </p>
          ) : (
            <ol className="mt-2 flex flex-col gap-2">
              {keys.map((key, index) => (
                <EditorKeyRow
                  key={key.id}
                  quickKey={key}
                  isFirst={index === 0}
                  isLast={index === keys.length - 1}
                  disabled={reordering}
                  onLabel={label => update(key, { label })}
                  onColour={colour => update(key, { colour })}
                  onMove={offset => move(index, offset)}
                  onRemove={() => removeMutation.mutate({ siteId, id: key.id })}
                />
              ))}
            </ol>
          )}
        </section>

        <section aria-labelledby="sales-quick-keys-editor-add">
          <h3 id="sales-quick-keys-editor-add" className="sales-cap">
            {t('editor.add')}
          </h3>
          <label className="relative mt-2 block">
            <span className="sr-only">{t('editor.search')}</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg3"
              aria-hidden="true"
            />
            <input
              type="search"
              className="input min-h-11 w-full pl-9"
              placeholder={t('editor.searchPlaceholder')}
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
              data-testid="sales-quick-keys-search"
            />
          </label>
          {isFull && (
            <p className="mt-2 text-sm text-fg2" role="status">
              {t('limitReached')}
            </p>
          )}
          <ul className="mt-2 flex flex-col divide-y divide-line">
            {results.map(product => (
              <li
                key={product.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2"
                data-testid={`sales-quick-keys-result-${product.sku}`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-fg1">
                    {product.name}
                  </span>
                  <span className="block text-xs text-fg2">
                    {product.sku} · {formatCurrency(product.price)}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-outline min-h-11"
                  disabled={isFull || setMutation.isPending || hasKey(product.id, 'product')}
                  onClick={() => setMutation.mutate({ siteId, productId: product.id })}
                  aria-label={t('editor.addAsKey', { name: product.name })}
                >
                  {t('editor.addKey')}
                </button>
                {sellsByValue && (
                  <button
                    type="button"
                    className="btn-ghost min-h-11"
                    disabled={isFull || setMutation.isPending || hasKey(product.id, 'open_value')}
                    onClick={() =>
                      setMutation.mutate({ siteId, productId: product.id, kind: 'open_value' })
                    }
                    aria-label={t('editor.addAsValue', { name: product.name })}
                  >
                    {t('editor.addValue')}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {productsQuery.isSuccess && results.length === 0 && (
            <p className="mt-2 text-sm text-fg2">{t('editor.noResults')}</p>
          )}
        </section>
      </div>
    </Modal>
  );
}

interface EditorKeyRowProps {
  quickKey: SiteQuickKey;
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onLabel: (label: string) => void;
  onColour: (colour: SiteQuickKeyColour | null) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}

function EditorKeyRow({
  quickKey,
  isFirst,
  isLast,
  disabled,
  onLabel,
  onColour,
  onMove,
  onRemove,
}: EditorKeyRowProps) {
  const { t } = useTranslation('salesQuickAccess');
  const [label, setLabel] = useState(quickKey.label ?? '');
  const name = quickKey.label ?? quickKey.productName;
  // The server only edits keys it could sell; a retired product's key can only go.
  const editable = quickKey.sellable && !disabled;
  const saveLabel = () => {
    if (label.trim() !== (quickKey.label ?? '')) onLabel(label.trim());
  };

  return (
    <li
      className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-card p-3"
      data-testid={`sales-quick-keys-row-${quickKey.productSku}-${quickKey.kind}`}
    >
      <div className="flex min-w-[12rem] flex-1 flex-col gap-1">
        <input
          className="input min-h-11"
          value={label}
          placeholder={quickKey.productName}
          maxLength={40}
          disabled={!editable}
          onChange={event => setLabel(event.target.value)}
          onBlur={saveLabel}
          onKeyDown={event => {
            // Blur saves, so Enter only leaves the field and the label is sent once.
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          aria-label={t('editor.labelFor', { name: quickKey.productName })}
        />
        <span className="flex flex-wrap items-center gap-2 text-xs text-fg2">
          <span>{quickKey.productSku}</span>
          <span className="font-semibold text-fg1">
            {quickKey.kind === 'open_value'
              ? t('openValue')
              : formatCurrency(quickKey.catalogPrice)}
          </span>
          {!quickKey.sellable && (
            <span className="sales-tag bg-warning-50 text-warning-700">
              {t('editor.notSellable')}
            </span>
          )}
        </span>
      </div>

      <fieldset className="flex flex-wrap gap-1.5" disabled={!editable}>
        <legend className="sr-only">{t('editor.colourFor', { name })}</legend>
        {[null, ...SITE_QUICK_KEY_COLOURS].map(colour => (
          <label key={colour ?? 'none'} className="sales-quick-swatch-option">
            <input
              type="radio"
              className="sr-only"
              name={`quick-key-colour-${quickKey.id}`}
              checked={quickKey.colour === colour}
              onChange={() => onColour(colour)}
            />
            <span
              className="sales-quick-key-swatch"
              data-colour={colour ?? undefined}
              data-none={colour === null || undefined}
              aria-hidden="true"
            />
            <span className="sr-only">{t(`editor.colours.${colour ?? 'none'}`)}</span>
          </label>
        ))}
      </fieldset>

      <div className="flex gap-1">
        <button
          type="button"
          className="btn-ghost min-h-11 min-w-11 px-2"
          disabled={disabled || isFirst}
          onClick={() => onMove(-1)}
          aria-label={t('editor.moveUp', { name })}
        >
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn-ghost min-h-11 min-w-11 px-2"
          disabled={disabled || isLast}
          onClick={() => onMove(1)}
          aria-label={t('editor.moveDown', { name })}
        >
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="btn-ghost min-h-11 min-w-11 px-2 text-danger-700"
          disabled={disabled}
          onClick={onRemove}
          aria-label={t('editor.remove', { name })}
          data-testid={`sales-quick-keys-remove-${quickKey.productSku}-${quickKey.kind}`}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
