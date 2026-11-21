import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, type LucideIcon } from 'lucide-react';
import { useProductPaletteResults } from '@/features/sales/useProductPaletteResults';
import { formatCurrency, formatNumber } from '@/lib/utils';

export interface TillIncidentProduct {
  id: string;
  name: string;
  /** Catalog price in the base unit; null when the line sells another unit. */
  price: number | null;
}

interface ProductSearchProps {
  /** Renders each match; picking is up to the caller. */
  renderResult: (product: SearchResult) => ReactNode;
  testId: string;
}

type SearchResult = ReturnType<typeof useProductPaletteResults>[number];

/** Name, code or barcode lookup over the active site's catalog. */
export function TillProductSearch({ renderResult, testId }: ProductSearchProps) {
  const { t } = useTranslation('tillIncidents');
  const [query, setQuery] = useState('');
  const results = useProductPaletteResults(query, true);
  const showEmpty = query.trim().length >= 2 && results.length === 0;
  return (
    <div className="space-y-2">
      <label className="relative block">
        <span className="sr-only">{t('product.search')}</span>
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg3"
          aria-hidden="true"
        />
        <input
          type="search"
          className="input min-h-12 w-full pl-9"
          placeholder={t('product.search')}
          value={query}
          onChange={event => setQuery(event.target.value)}
          // Opening this step from a tile or key means typing is next.
          autoFocus
          data-testid={`${testId}-input`}
        />
      </label>
      {results.length > 0 && (
        <ul className="till-incident-results" data-testid={`${testId}-results`}>
          {results.map(product => (
            <li key={product.id}>{renderResult(product)}</li>
          ))}
        </ul>
      )}
      {showEmpty && <p className="text-sm text-fg2">{t('product.noResults')}</p>}
    </div>
  );
}

/** Price and stock of a match, read-only: a price check adds nothing to the sale. */
export function TillPriceCheckResult({ product }: { product: SearchResult }) {
  const { t } = useTranslation('tillIncidents');
  const stock = product.siteStock ?? product.stock;
  return (
    <div className="till-incident-result" data-testid="till-incident-price-result">
      <span className="min-w-0">
        <span className="block truncate font-semibold text-fg1">{product.name}</span>
        <span className="block truncate font-mono text-xs text-fg2">
          {product.sku}
          {product.tracksStock !== false && stock !== null && stock !== undefined && (
            <> · {t('priceCheck.stock', { count: formatNumber(stock) })}</>
          )}
        </span>
      </span>
      <b className="font-numeric text-lg text-fg1">{formatCurrency(product.price)}</b>
    </div>
  );
}

interface ProductFieldProps {
  product: TillIncidentProduct | null;
  onChange: (product: TillIncidentProduct) => void;
  /** Extra facts under the name, such as stock or the till price. */
  detail?: ReactNode;
  icon?: LucideIcon | undefined;
  testId: string;
}

/** The product an incident is about: the last one on the sale, or one the cashier finds. */
export function TillIncidentProductField({
  product,
  onChange,
  detail,
  icon: Icon,
  testId,
}: ProductFieldProps) {
  const { t } = useTranslation('tillIncidents');
  const [searching, setSearching] = useState(product === null);

  if (searching || !product) {
    return (
      <TillProductSearch
        testId={`${testId}-search`}
        renderResult={match => (
          <button
            type="button"
            className="till-incident-result till-incident-result-pick"
            onClick={() => {
              onChange({ id: match.id, name: match.name, price: match.price });
              setSearching(false);
            }}
          >
            <span className="min-w-0 truncate font-semibold text-fg1">{match.name}</span>
            <span className="font-numeric text-fg2">{formatCurrency(match.price)}</span>
          </button>
        )}
      />
    );
  }

  return (
    <div className="till-incident-product" data-testid={testId}>
      {Icon && (
        <span className="glyph-tile glyph-tile-primary h-12 w-12" aria-hidden="true">
          <Icon className="h-6 w-6" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-lg font-semibold text-fg1">{product.name}</p>
        {detail && <p className="text-sm text-fg2">{detail}</p>}
      </div>
      <button
        type="button"
        className="sales-mini-link shrink-0"
        onClick={() => setSearching(true)}
        data-testid={`${testId}-change`}
      >
        {t('product.change')}
      </button>
    </div>
  );
}
