import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

interface SalesQuickSearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function SalesQuickSearchBar({
  query,
  onQueryChange,
  onSubmit,
  inputRef,
}: SalesQuickSearchBarProps) {
  const { t } = useTranslation('sales');

  return (
    <form
      className="card-inset flex flex-col gap-2 px-4 py-4"
      onSubmit={event => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label
        htmlFor="sales-product-search-input"
        className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-secondary-500"
      >
        {t('quickSearch.label')}
      </label>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
          <input
            id="sales-product-search-input"
            ref={inputRef}
            className="input pl-10"
            placeholder={t('quickSearch.placeholder')}
            value={query}
            onChange={event => onQueryChange(event.target.value)}
          />
        </div>
        <button type="submit" className="btn-outline whitespace-nowrap">
          {t('quickSearch.search')}
        </button>
      </div>
      <p className="text-xs text-secondary-500">
        {t('quickSearch.hint')}
      </p>
    </form>
  );
}
