/**
 * ENG-105 (slice A) — Global Command Palette.
 *
 * A modal launched by `Mod+K` from anywhere in the renderer. Lists
 * navigation destinations and command actions filtered by the
 * active user's role. The implementer's bias is keyboard-first:
 * every interaction works without a mouse.
 *
 * Reuses the shared `Modal` component (focus trap + ESC +
 * return-focus-to-opener); the palette never duplicates that
 * scaffolding.
 *
 * @module components/feedback/CommandPalette
 */

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { LoaderCircle, PackagePlus, Search } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import { canAccessRole, salesRoles } from '@/features/auth/roleAccess';
import { useModulesSnapshot } from '@/features/modules';
import {
  addOmniboxSelectionToCart,
  resolveBarcodeCartSelection,
  resolveProductCartSelection,
  type ResolvedCartSelection,
} from '@/features/sales/salesOmnibox';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import {
  filterActionsByQuery,
  visibleActionsForRole,
  type CommandAction,
  type CommandActionContext,
} from '@/lib/commandPaletteActions';
import { loadPaletteUsage, rankRecentActions, recordPaletteActionUsage } from '@/lib/paletteUsage';
import { formatKeysForDisplay, getShortcutById } from '@/lib/shortcuts';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { cn, formatCurrency } from '@/lib/utils';
import type { ProductSearchItem } from '@/types';

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  restoreFocusTo?: (() => HTMLElement | null) | undefined;
}

type PaletteOption =
  | { kind: 'product'; id: string; product: ProductSearchItem }
  | { kind: 'action'; id: string; action: CommandAction };

export function CommandPalette({ isOpen, onClose, restoreFocusTo }: CommandPaletteProps) {
  const { t } = useTranslation('palette');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={undefined}
      ariaLabel={t('title')}
      size="md"
      closeOnBackdrop
      closeOnEsc
      contentClassName="p-0 overflow-hidden"
      showCloseButton={false}
      restoreFocusTo={restoreFocusTo}
    >
      {isOpen ? <CommandPaletteBody onClose={onClose} /> : null}
    </Modal>
  );
}

/**
 * Inner body lives in its own component so React mounts a fresh
 * instance every time the palette opens. That sidesteps the
 * setState-in-useEffect anti-pattern (no need to reset query /
 * selectedIndex on transitions — they default on mount).
 */
function CommandPaletteBody({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['palette', 'shortcuts']);
  const { user, logout } = useAuth();
  const { modules, isPlaceholder } = useModulesSnapshot();
  const navigate = useNavigate();
  const toast = useToast();
  const utils = trpc.useUtils();
  const [query, setQuery] = useState('');
  const [rawSelectedIndex, setRawSelectedIndex] = useState(0);
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim();
  const debouncedProductQuery = useDebouncedValue(normalizedQuery, 180);
  const canSell = canAccessRole(user?.role, salesRoles);
  const productSearchQuery = trpc.products.search.useQuery(
    {
      q: debouncedProductQuery,
      limit: 8,
      isActive: true,
    },
    {
      enabled: canSell && debouncedProductQuery.length > 0,
    }
  );
  const productResults = useMemo(
    () => (productSearchQuery.data?.items ?? []) as ProductSearchItem[],
    [productSearchQuery.data?.items]
  );

  // Resolve label/description through translation. Memoised so the
  // filter closure does not recompute the catalogue every keystroke.
  const resolveLabel = useMemo(
    () =>
      (action: CommandAction): string =>
        t(`palette:${action.labelKey}`, { defaultValue: action.id }),
    [t]
  );
  const resolveDescription = useMemo(
    () =>
      (action: CommandAction): string =>
        action.descriptionKey ? t(`palette:${action.descriptionKey}`, { defaultValue: '' }) : '',
    [t]
  );

  const visibleActions = useMemo(
    () => visibleActionsForRole(user?.role, modules, !isPlaceholder),
    [user?.role, modules, isPlaceholder]
  );

  // ENG-105g — device-local usage map, read once per palette open
  // (the body remounts on every open, so each open sees the latest
  // ranking without any effect/state plumbing).
  const tenantId = user?.tenantId ?? null;
  const usage = useMemo(() => loadPaletteUsage(tenantId), [tenantId]);

  const filteredActions = useMemo(
    () => filterActionsByQuery(visibleActions, query, resolveLabel, resolveDescription),
    [visibleActions, query, resolveLabel, resolveDescription]
  );

  // ENG-105g — "Recent" section: only when the query is empty (an
  // active search keeps the predictable catalogue-filter behaviour),
  // ranked AFTER the role/module gate (visibleActions), top
  // count-then-recency. With no usage recorded this is empty and the
  // palette renders exactly the pre-ENG-105g list.
  const recentActions = useMemo(
    () => (query.trim() === '' ? rankRecentActions(visibleActions, usage) : []),
    [query, visibleActions, usage]
  );

  // The flat option list the keyboard/ARIA machinery operates on:
  // recent section first, then the catalogue WITHOUT the duplicated
  // recent ids. Section headers are presentational only — indexes,
  // wrap-around, and aria-activedescendant all run over this array.
  const orderedActionOptions = useMemo<PaletteOption[]>(() => {
    if (recentActions.length === 0) {
      return filteredActions.map(action => ({
        kind: 'action',
        id: action.id,
        action,
      }));
    }
    const recentIds = new Set(recentActions.map(action => action.id));
    return [
      ...recentActions.map(action => ({
        kind: 'action' as const,
        id: action.id,
        action,
      })),
      ...filteredActions
        .filter(action => !recentIds.has(action.id))
        .map(action => ({
          kind: 'action' as const,
          id: action.id,
          action,
        })),
    ];
  }, [recentActions, filteredActions]);

  // ENG-205 — product matches lead while a query is active, turning the
  // existing navigation palette into a sales omnibox without hiding command
  // matches. Empty-query recent ranking remains byte-for-byte action-only.
  const orderedOptions = useMemo<PaletteOption[]>(() => {
    const productOptions =
      canSell && normalizedQuery.length > 0
        ? productResults.map(product => ({
            kind: 'product' as const,
            id: `sell.${product.id}`,
            product,
          }))
        : [];
    return [...productOptions, ...orderedActionOptions];
  }, [canSell, normalizedQuery, orderedActionOptions, productResults]);

  // Derive a clamped selection at render time — when the filter
  // shrinks, the index automatically follows without a setState in
  // an effect (avoids cascading renders).
  const selectedIndex = Math.min(
    Math.max(0, rawSelectedIndex),
    Math.max(0, orderedOptions.length - 1)
  );
  const setSelectedIndex = setRawSelectedIndex;

  // Auto-focus the search input on mount. The Modal moves focus
  // to its container; we route it explicitly to the input on the
  // next animation frame.
  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, []);

  // Keep the selected row scrolled into view as the user navigates
  // through a long list. Reads the DOM after render; no setState.
  useEffect(() => {
    if (orderedOptions.length === 0) return;
    const items = listRef.current?.querySelectorAll('[data-palette-item]');
    if (!items) return;
    const target = items[selectedIndex];
    // jsdom does not implement scrollIntoView; guard so component
    // tests do not blow up. The real browser always provides it.
    if (target instanceof HTMLElement && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex, orderedOptions]);

  const performAction = (action: CommandAction) => {
    const ctx: CommandActionContext = { navigate, logout };
    // ENG-105g — remember the activation (device-local, best-effort)
    // so the next open ranks this action into the Recent section.
    recordPaletteActionUsage(action.id, tenantId);
    onClose();
    void Promise.resolve(action.perform(ctx)).catch(err => {
      console.error('command palette action threw', { actionId: action.id, err });
    });
  };

  const performProduct = async (
    product: ProductSearchItem | null,
    showNotFound = true,
    preferExact = false
  ): Promise<boolean> => {
    if (!user || !canSell || normalizedQuery.length === 0 || isAddingProduct) {
      return false;
    }
    setIsAddingProduct(true);
    try {
      let resolved: ResolvedCartSelection | null = null;
      try {
        const exact = await utils.products.lookupByBarcode.fetch({
          barcode: normalizedQuery,
          gs1Scheme: 'generic',
        });
        const exactProduct = exact?.product as unknown as ProductSearchItem | undefined;
        if (
          exact &&
          exactProduct &&
          (preferExact || !product || exactProduct.id === product.id)
        ) {
          resolved = resolveBarcodeCartSelection({
            product: exactProduct,
            resolvedUnitId: exact.resolvedUnitId,
            suggestedPrice: exact.suggestedPrice,
            suggestedQuantity: exact.suggestedQuantity,
          });
        }
      } catch (error) {
        // A visible text result is still actionable if the exact-barcode
        // optimization fails. Scanner-only activation has no such fallback,
        // so surface its transport error below.
        if (!product) throw error;
      }
      resolved ??= product ? resolveProductCartSelection(product) : null;
      if (!resolved) {
        if (showNotFound) {
          toast.warning({ title: t('palette:products.notFound') });
        }
        return false;
      }

      const ownerKey = `${user.tenantId}:${user.id}`;
      addOmniboxSelectionToCart({ ownerKey, ...resolved });
      // Navigate first so Modal's focus-restoration callback observes /sales
      // and lands on the checkout product input instead of the prior route.
      navigate('/sales');
      onClose();
      toast.success({
        title: t('palette:products.added', {
          name: resolved.selection.product.name,
        }),
      });
      return true;
    } catch (error) {
      const fallback = t('palette:products.addFailed');
      toast.error({
        title: fallback,
        description: translateServerError(error, t, fallback),
      });
      return false;
    } finally {
      setIsAddingProduct(false);
    }
  };

  const performOption = (option: PaletteOption) => {
    if (option.kind === 'product') {
      void performProduct(option.product);
      return;
    }
    performAction(option.action);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    // ENG-105d — ArrowDown/ArrowUp wrap around the listbox edges so
    // the cashier can spin from "Cobrar" back to "Inicio" without
    // detouring through Home/End. Empty-list guards stay no-op.
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (orderedOptions.length === 0) return;
      setSelectedIndex(selectedIndex + 1 >= orderedOptions.length ? 0 : selectedIndex + 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (orderedOptions.length === 0) return;
      setSelectedIndex(selectedIndex - 1 < 0 ? orderedOptions.length - 1 : selectedIndex - 1);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setSelectedIndex(0);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setSelectedIndex(Math.max(0, orderedOptions.length - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (isAddingProduct) return;
      const option = orderedOptions[selectedIndex];
      const looksLikeScan = normalizedQuery.length >= 6 && !/\s/.test(normalizedQuery);
      if (option?.kind === 'product') {
        void performProduct(option.product, true, looksLikeScan);
      } else if (looksLikeScan && canSell) {
        void performProduct(null, option === undefined).then(added => {
          if (!added && option?.kind === 'action') performAction(option.action);
        });
      } else if (option) {
        performOption(option);
      } else if (canSell && normalizedQuery.length > 0) {
        void performProduct(null);
      }
    }
  };

  return (
    <div
      className="flex flex-col"
      aria-label={t('palette:title')}
      data-testid="command-palette"
      onKeyDown={handleKeyDown}
      role="combobox"
      aria-expanded="true"
      aria-haspopup="listbox"
      aria-owns="command-palette-listbox"
    >
      <div className="flex items-center gap-3 border-b border-line/70 px-4 py-3">
        {productSearchQuery.isFetching || isAddingProduct ? (
          <LoaderCircle className="h-4 w-4 animate-spin text-primary-600" aria-hidden="true" />
        ) : (
          <Search className="h-4 w-4 text-secondary-500" aria-hidden="true" />
        )}
        <input
          ref={searchInputRef}
          type="text"
          value={query}
          onChange={event => {
            setQuery(event.target.value);
            setSelectedIndex(0);
          }}
          placeholder={t('palette:searchPlaceholder')}
          aria-label={t('palette:searchPlaceholder')}
          aria-controls="command-palette-listbox"
          aria-autocomplete="list"
          aria-busy={productSearchQuery.isFetching || isAddingProduct}
          aria-activedescendant={
            orderedOptions[selectedIndex]
              ? `command-palette-item-${orderedOptions[selectedIndex]!.id}`
              : undefined
          }
          data-testid="command-palette-search"
          className="w-full bg-transparent text-[14px] text-secondary-900 outline-none placeholder:text-secondary-500"
        />
      </div>
      {orderedOptions.length === 0 && productSearchQuery.isFetching ? (
        <div
          className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-secondary-500"
          data-testid="command-palette-loading"
        >
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
          {t('palette:products.searching')}
        </div>
      ) : orderedOptions.length === 0 ? (
        <div
          className="px-4 py-6 text-center text-sm text-secondary-500"
          data-testid="command-palette-empty"
        >
          <p className="font-medium text-secondary-700">{t('palette:noResults')}</p>
          <p className="mt-1 text-xs text-secondary-500">{t('palette:noResultsHint')}</p>
        </div>
      ) : (
        <ul
          ref={listRef}
          id="command-palette-listbox"
          role="listbox"
          aria-label={t('palette:title')}
          className="max-h-[20rem] overflow-y-auto py-1"
        >
          {orderedOptions.map((option, index) => {
            const isSelected = index === selectedIndex;
            const action = option.kind === 'action' ? option.action : null;
            const shortcut = action?.shortcutId ? getShortcutById(action.shortcutId) : undefined;
            const shortcutHint = shortcut ? formatKeysForDisplay(shortcut.keys) : null;
            // ENG-105g — presentational section headers. They are
            // NOT options: no data-palette-item (the scroll/index
            // machinery skips them) and aria-hidden (the listbox
            // stays a flat option list for assistive tech).
            const productOptionCount =
              canSell && normalizedQuery.length > 0 ? productResults.length : 0;
            const sectionHeader =
              productOptionCount > 0 && index === 0 ? (
                <li
                  aria-hidden="true"
                  role="presentation"
                  data-testid="command-palette-products-header"
                  className="px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-secondary-500"
                >
                  {t('palette:groups.products')}
                </li>
              ) : productOptionCount > 0 && index === productOptionCount ? (
                <li
                  aria-hidden="true"
                  role="presentation"
                  data-testid="command-palette-actions-header"
                  className="border-t border-line/70 px-4 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-secondary-500"
                >
                  {t('palette:groups.actions')}
                </li>
              ) : recentActions.length > 0 && index === 0 ? (
                <li
                  aria-hidden="true"
                  role="presentation"
                  data-testid="command-palette-recent-header"
                  className="px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-secondary-500"
                >
                  {t('palette:groups.recent')}
                </li>
              ) : recentActions.length > 0 && index === recentActions.length ? (
                <li
                  aria-hidden="true"
                  role="presentation"
                  data-testid="command-palette-catalogue-divider"
                  className="mx-4 mb-1 mt-2 border-t border-line/70"
                />
              ) : null;
            return (
              <Fragment key={option.id}>
                {sectionHeader}
                <li
                  id={`command-palette-item-${option.id}`}
                  data-palette-item
                  data-testid={`command-palette-item-${option.id}`}
                  role="option"
                  aria-selected={isSelected}
                  aria-disabled={isAddingProduct || undefined}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-4 py-2.5 text-[13px] transition',
                    isSelected
                      ? 'bg-primary-50/80 text-primary-900'
                      : 'text-secondary-700 hover:bg-secondary-50/60',
                    isAddingProduct && 'pointer-events-none opacity-65'
                  )}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onClick={() => performOption(option)}
                >
                  {option.kind === 'product' && (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                      <PackagePlus className="h-4 w-4" aria-hidden="true" />
                    </span>
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium text-secondary-950">
                      {option.kind === 'product'
                        ? option.product.name
                        : resolveLabel(option.action)}
                    </span>
                    {option.kind === 'product' ? (
                      <span className="truncate text-[11.5px] text-secondary-500">
                        {t('palette:products.meta', {
                          sku: option.product.sku,
                          stock: option.product.stock,
                        })}
                      </span>
                    ) : option.action.descriptionKey ? (
                      <span className="truncate text-[11.5px] text-secondary-500">
                        {resolveDescription(option.action)}
                      </span>
                    ) : null}
                  </div>
                  {option.kind === 'product' && (
                    <span className="shrink-0 text-[12px] font-semibold text-secondary-800">
                      {formatCurrency(option.product.baseUnitPrice ?? option.product.price)}
                    </span>
                  )}
                  {shortcutHint && action && (
                    <span
                      className="rounded-md border border-line/70 bg-surface-2/80 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.05em] text-secondary-600"
                      data-testid={`command-palette-shortcut-${action.id}`}
                    >
                      {shortcutHint}
                    </span>
                  )}
                </li>
              </Fragment>
            );
          })}
        </ul>
      )}
    </div>
  );
}
