import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';
import { ariaKeyshortcutsFor } from '@/lib/shortcuts';

interface SalesQuickSearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}

export function SalesQuickSearchBar({
  query,
  onQueryChange,
  onSubmit,
  inputRef,
  disabled = false,
}: SalesQuickSearchBarProps) {
  const { t } = useTranslation('sales');

  return (
    <form
      className="sales-scan-runway flex flex-col gap-2 px-4 py-4"
      onSubmit={event => {
        event.preventDefault();
        if (!disabled) onSubmit();
      }}
    >
      <div className="sales-scan-label-row">
        <label
          htmlFor="sales-product-search-input"
          className="text-[0.68rem] font-semibold uppercase tracking-[0.2em] text-secondary-500"
        >
          {t('quickSearch.label')}
        </label>
        <span className="sales-scanner-ready">
          <span aria-hidden="true" />
          {t(disabled ? 'quickSearch.lockedState' : 'quickSearch.ready')}
        </span>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="sales-scan-input relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary-400" />
          <input
            id="sales-product-search-input"
            ref={inputRef}
            className="input pl-10"
            placeholder={t('quickSearch.placeholder')}
            value={query}
            disabled={disabled}
            aria-keyshortcuts={disabled ? undefined : ariaKeyshortcutsFor('sales.focusProduct')}
            onChange={event => onQueryChange(event.target.value)}
          />
        </div>
        <button
          type="submit"
          className="pv-control-key pv-control-key-primary sales-scan-submit whitespace-nowrap"
          aria-keyshortcuts={disabled ? undefined : ariaKeyshortcutsFor('sales.productSearch')}
          disabled={disabled}
        >
          <span>{t('quickSearch.search')}</span>
          {!disabled && (
            <span className="sales-scan-submit-key" aria-hidden="true">
              F5
            </span>
          )}
        </button>
      </div>
      <p className="sales-scan-hint text-xs text-secondary-500">
        {t(disabled ? 'quickSearch.lockedHint' : 'quickSearch.hint')}
      </p>
    </form>
  );
}
