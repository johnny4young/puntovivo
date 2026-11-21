import { lazy, Suspense, useState, type KeyboardEvent, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ScanBarcode, Search, UserPlus, UserRound, X } from 'lucide-react';
import { ariaKeyshortcutsFor, shortcutDisplayFor } from '@/lib/shortcuts';
import { cn, formatNumber } from '@/lib/utils';
import { filterByQuery } from '@/lib/textMatch';
import { parseCommandBarMode, parseQuantityPrefix } from './commandBarGrammar';
import type { RegisterBarAction } from './registerBarActions';
import type { CommandBarCustomer } from './useCommandBarCustomers';
import type { AttachedCustomer } from './useSalesCommandBar';
import { isCameraScanSupported } from './cameraScan';
import { usePhoneLayout } from './usePhoneLayout';

const CameraScanDialog = lazy(() =>
  import('./CameraScanDialog').then(module => ({ default: module.CameraScanDialog }))
);

const LISTBOX_ID = 'sales-command-listbox';

interface SalesQuickSearchBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  /** Opens the product search (the F5 dialog) with the plain-text query. */
  onSubmit: (query: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
  pendingQuantity?: number | null;
  onPendingQuantityChange?: (quantity: number | null) => void;
  actions?: readonly RegisterBarAction[];
  attachedCustomerId?: string | null;
  /** Absent when the ticket's customer is frozen; null returns it to walk-in. */
  onAttachCustomer?: ((customer: AttachedCustomer | null) => void) | undefined;
  onCreateCustomer?: ((name: string) => void) | undefined;
  /** Matches for the text after `@`, looked up by the page. */
  customers?: readonly CommandBarCustomer[];
  isLoadingCustomers?: boolean;
  /** Receives a code read by the phone camera, the same way a scanner read arrives. */
  onCameraCode?: ((code: string) => void) | undefined;
}

interface BarOption {
  id: string;
  label: string;
  detail?: string | null;
  hint?: string | null;
  icon?: 'customer' | 'attached' | 'create' | 'walkIn';
  run: () => void;
}

const OPTION_ICONS = {
  customer: UserRound,
  attached: Check,
  create: UserPlus,
  walkIn: X,
} as const;

export function SalesQuickSearchBar({
  query,
  onQueryChange,
  onSubmit,
  inputRef,
  disabled = false,
  pendingQuantity = null,
  onPendingQuantityChange,
  actions = [],
  attachedCustomerId = null,
  onAttachCustomer,
  onCreateCustomer,
  customers = [],
  isLoadingCustomers = false,
  onCameraCode,
}: SalesQuickSearchBarProps) {
  const { t } = useTranslation('sales');
  const isPhone = usePhoneLayout();
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraSupported] = useState(isCameraScanSupported);
  const showCamera = isPhone && !disabled && !!onCameraCode && cameraSupported;
  const [rawActiveIndex, setActiveIndex] = useState(0);
  const [walkInArmed, setWalkInArmed] = useState(false);
  const mode = parseCommandBarMode(query);
  const listOpen = mode.kind !== 'search' && !disabled;

  const finish = (run: () => void) => {
    onQueryChange('');
    run();
  };

  let options: BarOption[] = [];
  if (mode.kind === 'action' && !disabled) {
    options = filterByQuery(actions, mode.query, action => t(action.labelKey)).map(action => ({
      id: action.id,
      label: t(action.labelKey),
      hint: action.shortcutId ? shortcutDisplayFor(action.shortcutId) : null,
      run: () => finish(action.run),
    }));
  } else if (mode.kind === 'customer' && onAttachCustomer && !disabled && !isLoadingCustomers) {
    const attach = onAttachCustomer;
    // Walk-in goes last and Enter only runs it once it was picked with the arrows or the mouse.
    options = [
      ...customers.map(customer => ({
        id: `customer-${customer.id}`,
        label: customer.name,
        detail: customer.detail,
        icon: customer.id === attachedCustomerId ? ('attached' as const) : ('customer' as const),
        run: () => finish(() => attach({ id: customer.id, name: customer.name })),
      })),
      ...(onCreateCustomer && mode.query
        ? [
            {
              id: 'create',
              label: t('commandBar.customer.create', { name: mode.query }),
              icon: 'create' as const,
              run: () => finish(() => onCreateCustomer(mode.query)),
            },
          ]
        : []),
      ...(attachedCustomerId
        ? [
            {
              id: 'walk-in',
              label: t('commandBar.customer.walkIn'),
              icon: 'walkIn' as const,
              run: () => finish(() => attach(null)),
            },
          ]
        : []),
    ];
  }
  let emptyKey = 'commandBar.customer.none';
  if (mode.kind === 'action') emptyKey = 'commandBar.noActions';
  else if (!onAttachCustomer) emptyKey = 'commandBar.customer.locked';
  else if (!mode.query) emptyKey = 'commandBar.customer.typeToSearch';
  else if (isLoadingCustomers) emptyKey = 'common:actions.loading';
  const activeIndex = Math.min(rawActiveIndex, Math.max(0, options.length - 1));
  const activeOption = listOpen ? options[activeIndex] : undefined;

  const handleChange = (value: string) => {
    setActiveIndex(0);
    setWalkInArmed(false);
    const quantity = parseQuantityPrefix(value);
    if (quantity && onPendingQuantityChange) {
      onPendingQuantityChange(quantity.quantity);
      onQueryChange(quantity.rest);
      return;
    }
    onQueryChange(value);
  };

  const openSearch = () => {
    if (mode.kind !== 'search') onQueryChange('');
    onSubmit(mode.kind === 'search' ? mode.query : '');
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (listOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      if (options.length === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setWalkInArmed(true);
      setActiveIndex((activeIndex + step + options.length) % options.length);
      return;
    }
    if (event.key === 'Escape' && (listOpen || pendingQuantity !== null)) {
      event.preventDefault();
      if (listOpen) onQueryChange('');
      else onPendingQuantityChange?.(null);
      return;
    }
    if (event.key === 'Backspace' && query === '' && pendingQuantity !== null) {
      event.preventDefault();
      onPendingQuantityChange?.(null);
    }
  };

  return (
    <form
      className="relative lg:shrink-0"
      onSubmit={event => {
        event.preventDefault();
        if (disabled) return;
        if (listOpen) {
          if (activeOption?.id === 'walk-in' && !walkInArmed) return;
          activeOption?.run();
          return;
        }
        onSubmit(mode.query);
      }}
    >
      <label
        htmlFor="sales-product-search-input"
        className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.14em] text-fg3 max-md:sr-only lg:sr-only"
      >
        {t('quickSearch.label')}
      </label>
      <div className="sales-command-input">
        {isPhone ? (
          <button
            type="button"
            className="sales-command-search-icon"
            aria-label={t('quickSearch.search')}
            disabled={disabled}
            onClick={openSearch}
          >
            <Search className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : (
          <ScanBarcode className="h-7 w-7 shrink-0 text-fg3" aria-hidden="true" />
        )}
        {pendingQuantity !== null && !disabled && (
          <span className="sales-command-quantity" data-testid="sales-command-quantity">
            <span role="status">
              <span aria-hidden="true">
                {t('commandBar.quantity.chip', { quantity: formatNumber(pendingQuantity) })}
              </span>
              <span className="sr-only">
                {t('commandBar.quantity.pending', { quantity: formatNumber(pendingQuantity) })}
              </span>
            </span>
            <button
              type="button"
              className="sales-command-quantity-clear"
              aria-label={t('commandBar.quantity.clear')}
              onClick={() => {
                onPendingQuantityChange?.(null);
                inputRef.current?.focus();
              }}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </span>
        )}
        <input
          id="sales-product-search-input"
          ref={inputRef}
          placeholder={t(isPhone ? 'quickSearch.phonePlaceholder' : 'quickSearch.placeholder')}
          value={query}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded={listOpen}
          aria-controls={listOpen && options.length > 0 ? LISTBOX_ID : undefined}
          aria-autocomplete="list"
          aria-activedescendant={
            activeOption ? `sales-command-option-${activeOption.id}` : undefined
          }
          aria-describedby={disabled ? undefined : 'sales-command-grammar'}
          aria-keyshortcuts={disabled ? undefined : ariaKeyshortcutsFor('sales.focusProduct')}
          onChange={event => handleChange(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {!disabled && query === '' && (
          <span className="sales-command-hints" aria-hidden="true">
            <span className="sales-command-hint">
              <kbd className="pv-kbd">3*</kbd>
              {t('commandBar.hint.quantity')}
            </span>
            {onAttachCustomer && (
              <span className="sales-command-hint">
                <kbd className="pv-kbd">@</kbd>
                {t('commandBar.hint.customer')}
              </span>
            )}
            <span className="sales-command-hint">
              <kbd className="pv-kbd">/</kbd>
              {t('commandBar.hint.action')}
            </span>
          </span>
        )}
        {showCamera && (
          <button
            type="button"
            className="sales-command-camera"
            aria-label={t('scanner.camera.open')}
            onClick={() => setIsCameraOpen(true)}
            data-testid="sales-camera-scan-open"
          >
            <ScanBarcode className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        {!isPhone && (
          <button
            type="button"
            className="sales-command-search"
            aria-keyshortcuts={disabled ? undefined : ariaKeyshortcutsFor('sales.productSearch')}
            disabled={disabled}
            onClick={openSearch}
          >
            <span>{t('quickSearch.search')}</span>
            {!disabled && (
              <kbd className="pv-kbd" aria-hidden="true">
                {shortcutDisplayFor('sales.productSearch')}
              </kbd>
            )}
          </button>
        )}
      </div>
      {!disabled && (
        <p id="sales-command-grammar" className="sr-only">
          {t('commandBar.grammar')}
        </p>
      )}
      {listOpen && (
        <div className="sales-command-menu" data-testid="sales-command-menu">
          <p className="sales-cap px-3 pb-1 pt-2">
            {t(mode.kind === 'action' ? 'commandBar.actionsTitle' : 'commandBar.customer.title')}
          </p>
          {options.length > 0 ? (
            <ul id={LISTBOX_ID} role="listbox" aria-label={t('quickSearch.label')}>
              {options.map((option, index) => {
                const Icon = option.icon ? OPTION_ICONS[option.icon] : null;
                return (
                  <li
                    key={option.id}
                    id={`sales-command-option-${option.id}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    data-testid={`sales-command-option-${option.id}`}
                    className={cn('sales-command-option', index === activeIndex && 'is-active')}
                    // Keep focus in the bar so a scan right after still lands there.
                    onMouseDown={event => event.preventDefault()}
                    onMouseEnter={() => {
                      setWalkInArmed(true);
                      setActiveIndex(index);
                    }}
                    onClick={option.run}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0 text-fg3" aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate font-medium text-fg1">
                      {option.label}
                    </span>
                    {option.detail && (
                      <span className="truncate font-mono text-xs text-fg3">{option.detail}</span>
                    )}
                    {option.hint && (
                      <kbd className="pv-kbd" aria-hidden="true">
                        {option.hint}
                      </kbd>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 pb-3 pt-1 text-sm text-fg3" role="status">
              {t(emptyKey)}
            </p>
          )}
        </div>
      )}
      {/* Phones have no keyboard, so only the locked notice stays. */}
      {(disabled || !isPhone) && (
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
      )}
      {isCameraOpen && onCameraCode && (
        <Suspense fallback={null}>
          <CameraScanDialog
            onClose={() => {
              setIsCameraOpen(false);
              inputRef.current?.focus();
            }}
            onDetected={code => {
              setIsCameraOpen(false);
              onCameraCode(code);
            }}
          />
        </Suspense>
      )}
    </form>
  );
}
