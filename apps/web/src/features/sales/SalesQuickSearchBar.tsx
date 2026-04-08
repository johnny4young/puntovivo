import type { RefObject } from 'react';
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
  return (
    <form
      className="flex flex-col gap-2 rounded-xl border border-secondary-200 bg-white px-4 py-3 shadow-sm md:min-w-[320px]"
      onSubmit={event => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label
        htmlFor="sales-product-search-input"
        className="text-xs font-medium uppercase tracking-wide text-secondary-500"
      >
        Product / Barcode
      </label>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
          <input
            id="sales-product-search-input"
            ref={inputRef}
            className="input pl-10"
            placeholder="Scan barcode or type SKU / name"
            value={query}
            onChange={event => onQueryChange(event.target.value)}
          />
        </div>
        <button type="submit" className="btn-outline whitespace-nowrap">
          Search
        </button>
      </div>
      <p className="text-xs text-secondary-500">
        `Alt+P` focus search, `F5` open catalog, `F1` charge sale.
      </p>
    </form>
  );
}
