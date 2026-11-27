/**
 * Compact BOM ingredient editor for a saved restaurant modifier option.
 * Edits stay a draft; the modifier save sends them with its version check.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';

export type ModifierBomDraft = Array<{ componentProductId: string; quantity: number }>;

interface ModifierBomSectionProps {
  siteId: string;
  catalogId: string;
  onDraftChange: (draft: ModifierBomDraft) => void;
}

export function ModifierBomSection({ siteId, catalogId, onDraftChange }: ModifierBomSectionProps) {
  const { t } = useTranslation(['restaurants', 'common']);
  const bomQuery = trpc.restaurantModifiers.getBomComponents.useQuery(
    { siteId, catalogId },
    { enabled: Boolean(siteId && catalogId) }
  );
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 200);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [draft, setDraft] = useState<Array<{
    componentProductId: string;
    componentName: string;
    quantity: number;
  }> | null>(null);

  const productsQuery = trpc.products.list.useQuery(
    { siteId, search: debouncedSearch || undefined, page: 1, perPage: 20 },
    { enabled: Boolean(siteId) }
  );

  const rows =
    draft ??
    (bomQuery.data ?? []).map(item => ({
      componentProductId: item.componentProductId,
      componentName: item.componentName,
      quantity: item.quantity,
    }));

  function updateDraft(next: NonNullable<typeof draft>) {
    setDraft(next);
    onDraftChange(
      next.map(item => ({ componentProductId: item.componentProductId, quantity: item.quantity }))
    );
  }

  const candidates = (productsQuery.data?.items ?? []).filter(
    product =>
      product.tracksStock !== false &&
      !product.tracksLots &&
      !product.tracksSerials &&
      product.catalogType !== 'variant_parent' &&
      !rows.some(r => r.componentProductId === product.id)
  );

  function handleAdd() {
    const qty = Number(quantity);
    if (!selectedProductId || !(qty > 0) || !Number.isFinite(qty)) return;
    const picked = (productsQuery.data?.items ?? []).find(p => p.id === selectedProductId);
    if (!picked) return;
    updateDraft([
      ...rows,
      { componentProductId: picked.id, componentName: picked.name, quantity: qty },
    ]);
    setSelectedProductId('');
    setQuantity('1');
  }

  function handleRemove(componentProductId: string) {
    updateDraft(rows.filter(r => r.componentProductId !== componentProductId));
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-line bg-surface-2 p-3"
      data-testid="modifier-bom-section"
    >
      <h3 className="text-sm font-semibold text-fg1">{t('restaurants:catalog.bomTitle')}</h3>

      {rows.length === 0 ? (
        <p className="text-xs text-fg3" data-testid="modifier-bom-empty">
          {t('restaurants:catalog.bomEmpty')}
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface px-2.5">
          {rows.map(item => (
            <li
              key={item.componentProductId}
              className="flex items-center justify-between gap-2 py-2 text-sm"
              data-testid="modifier-bom-row"
            >
              <span className="min-w-0 flex-1 truncate font-medium text-fg1">
                {item.componentName}
              </span>
              <span className="shrink-0 tabular-nums text-fg2">× {item.quantity}</span>
              <button
                type="button"
                className="btn-ghost btn-icon h-8 w-8 text-fg3 hover:text-danger-600"
                aria-label={t('restaurants:catalog.bomRemove', { name: item.componentName })}
                onClick={() => handleRemove(item.componentProductId)}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
        <div className="space-y-1.5">
          <input
            type="search"
            className="input min-h-10 text-sm"
            placeholder={t('restaurants:catalog.bomAddProduct')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            data-testid="modifier-bom-search"
          />
          <select
            className="input min-h-10 text-sm"
            value={selectedProductId}
            onChange={e => setSelectedProductId(e.target.value)}
            aria-label={t('restaurants:catalog.bomAddProduct')}
            data-testid="modifier-bom-select"
          >
            <option value="">—</option>
            {candidates.map(product => (
              <option key={product.id} value={product.id}>
                {product.name} ({product.sku})
              </option>
            ))}
          </select>
        </div>
        <input
          type="number"
          min={0.001}
          step="any"
          className="input h-10 w-24 self-end text-right text-sm tabular-nums"
          aria-label={t('restaurants:catalog.bomQuantity')}
          value={quantity}
          onChange={e => setQuantity(e.target.value)}
          data-testid="modifier-bom-qty"
        />
        <button
          type="button"
          className="btn-outline h-10 self-end"
          disabled={!selectedProductId || !(Number(quantity) > 0)}
          onClick={handleAdd}
          data-testid="modifier-bom-add"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('restaurants:catalog.bomAdd')}
        </button>
      </div>
    </section>
  );
}
