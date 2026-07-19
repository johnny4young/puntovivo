/** ENG-178 — Search and catalog filters for ProductSearchDialog. */
import { Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Category, Provider } from '@/types';

interface ProductSearchFiltersProps {
  query: string;
  categoryId: string;
  providerId: string;
  categories: readonly Category[];
  providers: readonly Provider[];
  searchInputId: string;
  categoryFilterId: string;
  providerFilterId: string;
  onQueryChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onProviderChange: (value: string) => void;
}

export function ProductSearchFilters({
  query,
  categoryId,
  providerId,
  categories,
  providers,
  searchInputId,
  categoryFilterId,
  providerFilterId,
  onQueryChange,
  onCategoryChange,
  onProviderChange,
}: ProductSearchFiltersProps) {
  const { t } = useTranslation('common');

  return (
    <section className="card-inset p-4 sm:p-5">
      <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <label className="block">
          <span className="label" id={searchInputId}>
            {t('productSearch.search')}
          </span>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
            <input
              aria-labelledby={searchInputId}
              className="input pl-10"
              placeholder={t('productSearch.searchPlaceholder')}
              value={query}
              onChange={event => onQueryChange(event.target.value)}
            />
          </div>
        </label>

        <label className="block" htmlFor={categoryFilterId}>
          <span className="label">{t('productSearch.category')}</span>
          <select
            id={categoryFilterId}
            className="input mt-1"
            value={categoryId}
            onChange={event => onCategoryChange(event.target.value)}
          >
            <option value="">{t('productSearch.allCategories')}</option>
            {categories.map(category => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block" htmlFor={providerFilterId}>
          <span className="label">{t('productSearch.provider')}</span>
          <select
            id={providerFilterId}
            className="input mt-1"
            value={providerId}
            onChange={event => onProviderChange(event.target.value)}
          >
            <option value="">{t('productSearch.allProviders')}</option>
            {providers.map(provider => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
