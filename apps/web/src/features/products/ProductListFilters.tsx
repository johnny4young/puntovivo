import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { LOW_MARGIN_PERCENT, type ProductFilters } from './productFilters';

function chipClass(active: boolean) {
  return cn(
    'inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium',
    active
      ? 'border-primary-500 bg-primary-50 text-primary-900'
      : 'border-line-strong bg-surface text-ink hover:bg-surface-2'
  );
}

export function ProductListFilters({
  filters,
  categories,
  canSeeMargin,
  onChange,
}: {
  filters: ProductFilters;
  categories: ReadonlyArray<{ id: string; name: string }>;
  canSeeMargin: boolean;
  onChange: (next: ProductFilters) => void;
}) {
  const { t } = useTranslation('products');

  return (
    <div
      role="group"
      aria-label={t('filters.label')}
      className="flex flex-wrap items-center gap-2"
      data-testid="products-filters"
    >
      <select
        className="input min-h-11 w-auto"
        aria-label={t('filters.category')}
        value={filters.categoryId}
        onChange={event => onChange({ ...filters, categoryId: event.target.value })}
        data-testid="products-filter-category"
      >
        <option value="">{t('filters.allCategories')}</option>
        {categories.map(category => (
          <option key={category.id} value={category.id}>
            {category.name}
          </option>
        ))}
      </select>
      <select
        className="input min-h-11 w-auto"
        aria-label={t('filters.status')}
        value={filters.status}
        onChange={event =>
          onChange({ ...filters, status: event.target.value as ProductFilters['status'] })
        }
        data-testid="products-filter-status"
      >
        <option value="all">{t('filters.allStatuses')}</option>
        <option value="active">{t('filters.active')}</option>
        <option value="inactive">{t('filters.inactive')}</option>
      </select>
      <button
        type="button"
        aria-pressed={filters.lowStock}
        className={chipClass(filters.lowStock)}
        onClick={() => onChange({ ...filters, lowStock: !filters.lowStock })}
        data-testid="products-filter-low-stock"
      >
        {t('filters.lowStock')}
      </button>
      {canSeeMargin && (
        <button
          type="button"
          aria-pressed={filters.lowMargin}
          className={chipClass(filters.lowMargin)}
          onClick={() => onChange({ ...filters, lowMargin: !filters.lowMargin })}
          data-testid="products-filter-low-margin"
        >
          {t('filters.lowMargin', { percent: LOW_MARGIN_PERCENT })}
        </button>
      )}
    </div>
  );
}
