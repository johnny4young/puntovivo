import { Fragment, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, PackagePlus } from 'lucide-react';
import type { CommandAction } from '@/lib/commandPaletteActions';
import { formatKeysForDisplay, getShortcutById } from '@/lib/shortcuts';
import { cn, formatCurrency } from '@/lib/utils';
import type { ProductSearchItem } from '@/types';

export type PaletteOption =
  | { kind: 'product'; id: string; product: ProductSearchItem }
  | { kind: 'action'; id: string; action: CommandAction };

interface CommandPaletteResultsProps {
  options: PaletteOption[];
  selectedIndex: number;
  isAddingProduct: boolean;
  isFetching: boolean;
  productOptionCount: number;
  recentActionCount: number;
  listRef: RefObject<HTMLUListElement | null>;
  resolveLabel: (action: CommandAction) => string;
  resolveDescription: (action: CommandAction) => string;
  onSelectIndex: (index: number) => void;
  onPerformOption: (option: PaletteOption) => void;
}

export function CommandPaletteResults({
  options,
  selectedIndex,
  isAddingProduct,
  isFetching,
  productOptionCount,
  recentActionCount,
  listRef,
  resolveLabel,
  resolveDescription,
  onSelectIndex,
  onPerformOption,
}: CommandPaletteResultsProps) {
  const { t } = useTranslation('palette');

  if (options.length === 0 && isFetching) {
    return (
      <div
        className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-secondary-500"
        data-testid="command-palette-loading"
      >
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t('products.searching')}
      </div>
    );
  }

  if (options.length === 0) {
    return (
      <div
        className="px-4 py-6 text-center text-sm text-secondary-500"
        data-testid="command-palette-empty"
      >
        <p className="font-medium text-secondary-700">{t('noResults')}</p>
        <p className="mt-1 text-xs text-secondary-500">{t('noResultsHint')}</p>
      </div>
    );
  }

  return (
    <ul
      ref={listRef}
      id="command-palette-listbox"
      role="listbox"
      aria-label={t('title')}
      className="max-h-[20rem] overflow-y-auto py-1"
    >
      {options.map((option, index) => {
        const isSelected = index === selectedIndex;
        const action = option.kind === 'action' ? option.action : null;
        const shortcut = action?.shortcutId ? getShortcutById(action.shortcutId) : undefined;
        const shortcutHint = shortcut ? formatKeysForDisplay(shortcut.keys) : null;
        // ENG-105g — presentational section headers. They are
        // NOT options: no data-palette-item (the scroll/index
        // machinery skips them) and aria-hidden (the listbox
        // stays a flat option list for assistive tech).
        const sectionHeader =
          productOptionCount > 0 && index === 0 ? (
            <li
              aria-hidden="true"
              role="presentation"
              data-testid="command-palette-products-header"
              className="px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-secondary-500"
            >
              {t('groups.products')}
            </li>
          ) : productOptionCount > 0 && index === productOptionCount ? (
            <li
              aria-hidden="true"
              role="presentation"
              data-testid="command-palette-actions-header"
              className="border-t border-line/70 px-4 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-secondary-500"
            >
              {t('groups.actions')}
            </li>
          ) : recentActionCount > 0 && index === 0 ? (
            <li
              aria-hidden="true"
              role="presentation"
              data-testid="command-palette-recent-header"
              className="px-4 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-secondary-500"
            >
              {t('groups.recent')}
            </li>
          ) : recentActionCount > 0 && index === recentActionCount ? (
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
              onMouseEnter={() => onSelectIndex(index)}
              onClick={() => onPerformOption(option)}
            >
              {option.kind === 'product' && (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-50 text-primary-700">
                  <PackagePlus className="h-4 w-4" aria-hidden="true" />
                </span>
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium text-secondary-950">
                  {option.kind === 'product' ? option.product.name : resolveLabel(option.action)}
                </span>
                {option.kind === 'product' ? (
                  <span className="truncate text-[11.5px] text-secondary-500">
                    {t('products.meta', {
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
  );
}
