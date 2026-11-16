import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { ScanBarcode } from 'lucide-react';
import { ariaKeyshortcutsFor, shortcutDisplayFor } from '@/lib/shortcuts';

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
      className="lg:shrink-0"
      onSubmit={event => {
        event.preventDefault();
        if (!disabled) onSubmit();
      }}
    >
      <label
        htmlFor="sales-product-search-input"
        className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-fg3 lg:sr-only"
      >
        {t('quickSearch.label')}
      </label>
      <div className="sales-command-input">
        <ScanBarcode className="h-6 w-6 shrink-0 text-fg3" aria-hidden="true" />
        <input
          id="sales-product-search-input"
          ref={inputRef}
          placeholder={t('quickSearch.placeholder')}
          value={query}
          disabled={disabled}
          aria-keyshortcuts={disabled ? undefined : ariaKeyshortcutsFor('sales.focusProduct')}
          onChange={event => onQueryChange(event.target.value)}
        />
        {!disabled && (
          <kbd
            className="pv-kbd hidden lg:inline-flex"
            title={t('quickSearch.shortcut.focusSearch')}
          >
            {shortcutDisplayFor('sales.focusProduct')}
          </kbd>
        )}
        <button
          type="submit"
          className="btn-outline min-h-11 shrink-0 whitespace-nowrap"
          aria-keyshortcuts={disabled ? undefined : ariaKeyshortcutsFor('sales.productSearch')}
          disabled={disabled}
        >
          <span>{t('quickSearch.search')}</span>
          {!disabled && (
            <kbd className="pv-kbd" aria-hidden="true">
              {shortcutDisplayFor('sales.productSearch')}
            </kbd>
          )}
        </button>
      </div>
      <p
        className={`sales-scan-hint mt-2 flex flex-wrap gap-x-3 gap-y-2 text-xs text-fg3 ${disabled ? '' : 'lg:hidden'}`}
      >
        {disabled
          ? t('quickSearch.lockedHint')
          : (
              [
                ['sales.focusProduct', t('quickSearch.shortcut.focusSearch')],
                ['sales.productSearch', t('quickSearch.shortcut.openCatalog')],
                ['sales.charge', t('checkout.shortcut.charge')],
              ] as const
            ).map(([id, label]) => (
              <span key={id} className="inline-flex items-center gap-1">
                <kbd className="pv-kbd">{shortcutDisplayFor(id)}</kbd>
                <span>{label}</span>
              </span>
            ))}
      </p>
    </form>
  );
}
