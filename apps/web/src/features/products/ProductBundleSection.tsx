import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Search, Trash2 } from 'lucide-react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { trpc } from '@/lib/trpc';

interface ProductBundleSectionProps {
  productId: string;
}

interface DraftComponent {
  componentProductId: string;
  componentName: string;
  componentSku: string;
  quantity: number;
}

export function ProductBundleSection({ productId }: ProductBundleSectionProps) {
  const { t } = useTranslation('shelfLabels');
  const utils = trpc.useUtils();
  const [searchText, setSearchText] = useState('');
  const debouncedSearch = useDebouncedValue(searchText.trim(), 200);
  const [localComponents, setLocalComponents] = useState<DraftComponent[] | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const bundleQuery = trpc.products.getBundleComponents.useQuery({ productId });
  const searchQuery = trpc.products.search.useQuery(
    { q: debouncedSearch || '_', limit: 8, isActive: true, tracksStock: true },
    { enabled: debouncedSearch.length > 0 }
  );

  const saveMutation = trpc.products.setBundleComponents.useMutation({
    onSuccess: async saved => {
      setLocalComponents(
        saved.map(row => ({
          componentProductId: row.componentProductId,
          componentName: row.componentName,
          componentSku: row.componentSku,
          quantity: row.quantity,
        }))
      );
      await utils.products.getBundleComponents.invalidate({ productId });
      setFeedback({ kind: 'ok', text: t('bundles.saved') });
    },
    onError: () => {
      setFeedback({ kind: 'err', text: t('bundles.saveError') });
    },
  });

  const components: DraftComponent[] =
    localComponents ??
    (bundleQuery.data ?? []).map(row => ({
      componentProductId: row.componentProductId,
      componentName: row.componentName,
      componentSku: row.componentSku,
      quantity: row.quantity,
    }));

  const searchResults = (searchQuery.data?.items ?? []).filter(
    item =>
      item.id !== productId &&
      !item.tracksLots &&
      !item.tracksSerials &&
      !components.some(entry => entry.componentProductId === item.id)
  );

  const addComponent = (item: { id: string; name: string; sku: string }) => {
    setLocalComponents([
      ...components,
      {
        componentProductId: item.id,
        componentName: item.name,
        componentSku: item.sku,
        quantity: 1,
      },
    ]);
    setSearchText('');
  };

  return (
    <div
      className="rounded-2xl border border-line/80 bg-surface-2/50 p-4 space-y-3"
      data-testid="product-bundle-section"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-secondary-900">{t('bundles.title')}</h3>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={saveMutation.isPending || bundleQuery.isLoading}
          data-testid="product-bundle-save"
          onClick={() =>
            saveMutation.mutate({
              productId,
              components: components.map(c => ({
                componentProductId: c.componentProductId,
                quantity: c.quantity,
              })),
            })
          }
        >
          {saveMutation.isPending ? t('bundles.submitting') : t('bundles.save')}
        </button>
      </div>

      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-fg3"
          aria-hidden="true"
        />
        <input
          type="text"
          className="input pl-9"
          placeholder={t('bundles.searchPlaceholder')}
          data-testid="product-bundle-search"
          value={searchText}
          onChange={event => setSearchText(event.target.value)}
        />
        {searchResults.length > 0 && (
          <div className="absolute z-10 mt-1 max-h-40 w-full overflow-auto rounded-xl border border-line bg-surface p-1 shadow-lg">
            {searchResults.map(item => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-left text-sm hover:bg-surface-2"
                onClick={() => addComponent(item)}
              >
                <span>
                  {item.name} · {item.sku}
                </span>
                <Plus className="h-4 w-4 text-primary-600" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>

      {components.length === 0 ? (
        <p className="text-xs text-fg3">{t('bundles.empty')}</p>
      ) : (
        <div className="space-y-2">
          {components.map(entry => (
            <div
              key={entry.componentProductId}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{entry.componentName}</p>
                <p className="text-xs text-fg3">{entry.componentSku}</p>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0.001}
                  step="any"
                  aria-label={t('bundles.quantity')}
                  className="input w-24 py-1 text-right"
                  value={entry.quantity}
                  onChange={event => {
                    const nextQty = Number(event.target.value);
                    setLocalComponents(
                      components.map(item =>
                        item.componentProductId === entry.componentProductId
                          ? { ...item, quantity: nextQty > 0 ? nextQty : 1 }
                          : item
                      )
                    );
                  }}
                />
                <button
                  type="button"
                  className="btn-ghost btn-icon text-danger-600"
                  aria-label={t('bundles.remove')}
                  onClick={() =>
                    setLocalComponents(
                      components.filter(
                        item => item.componentProductId !== entry.componentProductId
                      )
                    )
                  }
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {feedback && (
        <p
          role="status"
          className={
            feedback.kind === 'ok' ? 'text-xs text-success-700' : 'text-xs text-danger-600'
          }
        >
          {feedback.text}
        </p>
      )}
    </div>
  );
}
