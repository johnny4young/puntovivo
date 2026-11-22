import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData } from '@tanstack/react-query';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';
import { categoryHue } from '@/lib/categoryHue';

const PAGE_SIZE = 24;
/** Category chips over a page of dish tiles; a tap hands the dish to the plate sheet. */
export function RestaurantDishCatalog({
  siteId,
  activeDishId,
  disabled,
  onPick,
}: {
  siteId: string;
  activeDishId: string | null;
  disabled: boolean;
  onPick: (dishId: string) => void;
}) {
  const { t } = useTranslation('restaurants');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const products = trpc.products.list.useQuery(
    { page, perPage: PAGE_SIZE, categoryId: categoryId ?? undefined, isActive: true, siteId },
    { staleTime: 30_000, placeholderData: keepPreviousData }
  );
  const counts = trpc.products.categoryCounts.useQuery(undefined, { staleTime: 60_000 });
  const tree = trpc.categories.tree.useQuery(undefined, { staleTime: 60_000 });
  const countById = new Map(
    (counts.data?.categories ?? []).map(entry => [entry.categoryId, entry.count])
  );
  const categories = (tree.data?.items ?? []).filter(node => (countById.get(node.id) ?? 0) > 0);
  const pages = products.data?.totalPages ?? 1;

  const select = (id: string | null) => {
    setCategoryId(id);
    setPage(1);
  };

  return (
    <section aria-label={t('catalogGrid.label')} className="space-y-3" data-testid="dish-catalog">
      <nav aria-label={t('catalogGrid.categories')} className="flex gap-2 overflow-x-auto pb-1">
        {[{ id: null, name: t('catalogGrid.all') }, ...categories].map(category => (
          <button
            key={category.id ?? 'all'}
            type="button"
            className="modifier-option shrink-0 rounded-full"
            aria-pressed={categoryId === category.id}
            onClick={() => select(category.id)}
            data-testid={`dish-category-${category.id ?? 'all'}`}
          >
            {category.name}
          </button>
        ))}
      </nav>

      {products.isLoading ? (
        <p role="status" className="text-sm text-fg3">
          {t('catalogGrid.loading')}
        </p>
      ) : products.error ? (
        <p role="alert" className="text-sm text-danger-700">
          {t('catalogGrid.error')}
        </p>
      ) : products.data?.items.length === 0 ? (
        <p className="text-sm text-fg3">{t('catalogGrid.empty')}</p>
      ) : (
        <div className="grid auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-3">
          {products.data?.items.map(dish => (
            <button
              key={dish.id}
              type="button"
              disabled={disabled}
              aria-pressed={dish.id === activeDishId}
              onClick={() => onPick(dish.id)}
              className="dish-tile"
              style={{ '--tile-hue': categoryHue(dish.categoryId) } as CSSProperties}
              data-testid={`dish-tile-${dish.id}`}
            >
              <span className="flex items-start justify-between gap-2">
                <span className="line-clamp-2 text-[0.9375rem] font-semibold leading-tight">
                  {dish.name}
                </span>
                <span aria-hidden="true" className="dish-tile-dot" />
              </span>
              <span className="font-display text-lg font-bold tabular-nums">
                {formatCurrency(dish.price)}
              </span>
            </button>
          ))}
        </div>
      )}

      {pages > 1 && (
        <nav
          aria-label={t('catalogGrid.pages')}
          className="flex items-center justify-between gap-2"
        >
          <button
            type="button"
            className="btn-outline min-h-11"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            {t('catalog.previous')}
          </button>
          <span className="text-xs tabular-nums text-fg3" aria-live="polite">
            {t('catalogGrid.page', { page, pages })}
          </span>
          <button
            type="button"
            className="btn-outline min-h-11"
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
          >
            {t('catalog.next')}
          </button>
        </nav>
      )}
    </section>
  );
}
