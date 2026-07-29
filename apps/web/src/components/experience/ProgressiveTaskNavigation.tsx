import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface ProgressiveTaskItem<ItemId extends string> {
  id: ItemId;
  label: string;
  testId?: string | undefined;
}

export interface ProgressiveTaskGroup<ItemId extends string> {
  id: string;
  label: string;
  items: readonly ProgressiveTaskItem<ItemId>[];
}

export interface ProgressiveTaskNavigationProps<ItemId extends string> {
  ariaLabel: string;
  activeItem: ItemId;
  primary: {
    id: ItemId;
    title: string;
    description: string;
    icon: LucideIcon;
    testId?: string | undefined;
  };
  advanced: {
    title: string;
    description: string;
    icon: LucideIcon;
    disclosureId: string;
    groups: readonly ProgressiveTaskGroup<ItemId>[];
    toggleTestId?: string | undefined;
    panelTestId?: string | undefined;
    columnsClassName?: string | undefined;
  };
  onItemChange: (item: ItemId) => void;
  className?: string | undefined;
}

/**
 * Progressive navigation with one novice path and grouped expert destinations.
 *
 * Deep-linked advanced items stay visible. Activating the disclosure again
 * returns to the primary path, preserving a predictable back/cancel action.
 */
export function ProgressiveTaskNavigation<ItemId extends string>({
  ariaLabel,
  activeItem,
  primary,
  advanced,
  onItemChange,
  className,
}: ProgressiveTaskNavigationProps<ItemId>): React.ReactElement {
  const [advancedExpanded, setAdvancedExpanded] = useState(false);
  const isAdvancedItem = activeItem !== primary.id;
  const advancedOpen = isAdvancedItem || advancedExpanded;
  const PrimaryIcon = primary.icon;
  const AdvancedIcon = advanced.icon;

  const openPrimary = (): void => {
    setAdvancedExpanded(false);
    onItemChange(primary.id);
  };

  const toggleAdvanced = (): void => {
    if (isAdvancedItem) {
      openPrimary();
      return;
    }
    setAdvancedExpanded(current => !current);
  };

  return (
    <nav
      className={cn(
        'rounded-[1.5rem] border border-line bg-card p-3 shadow-[0_20px_60px_-52px_rgba(15,23,42,0.75)]',
        className
      )}
      aria-label={ariaLabel}
    >
      <div className="grid gap-2 lg:grid-cols-2">
        <button
          type="button"
          className={cn(
            'flex min-h-20 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
            activeItem === primary.id
              ? 'border-primary-300 bg-primary-50/80 text-primary-950'
              : 'border-transparent bg-surface-2/60 text-secondary-700 hover:border-line hover:bg-surface-2'
          )}
          aria-current={activeItem === primary.id ? 'page' : undefined}
          onClick={openPrimary}
          data-testid={primary.testId}
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-950 text-white shadow-sm">
            <PrimaryIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{primary.title}</span>
            <span className="mt-0.5 block text-xs leading-5 text-secondary-500">
              {primary.description}
            </span>
          </span>
        </button>

        <button
          type="button"
          className={cn(
            'flex min-h-20 items-center gap-3 rounded-2xl border px-4 py-3 text-left transition-colors',
            isAdvancedItem
              ? 'border-secondary-300 bg-secondary-100/80 text-secondary-950'
              : 'border-transparent bg-surface-2/60 text-secondary-700 hover:border-line hover:bg-surface-2'
          )}
          aria-expanded={advancedOpen}
          aria-controls={advanced.disclosureId}
          onClick={toggleAdvanced}
          data-testid={advanced.toggleTestId}
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-secondary-200 bg-white text-secondary-700 shadow-sm">
            <AdvancedIcon className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">{advanced.title}</span>
            <span className="mt-0.5 block text-xs leading-5 text-secondary-500">
              {advanced.description}
            </span>
          </span>
          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-secondary-500 transition-transform',
              advancedOpen && 'rotate-180'
            )}
            aria-hidden="true"
          />
        </button>
      </div>

      {advancedOpen && (
        <div
          id={advanced.disclosureId}
          className={cn(
            'mt-3 grid gap-4 rounded-2xl border border-line bg-surface-2/50 p-4',
            advanced.columnsClassName
          )}
          data-testid={advanced.panelTestId}
        >
          {advanced.groups.map(group => {
            const groupLabelId = `${advanced.disclosureId}-group-${group.id}`;
            return (
              <div
                key={group.id}
                role="group"
                aria-labelledby={groupLabelId}
                className="min-w-0"
              >
                <p
                  id={groupLabelId}
                  className="text-[0.66rem] font-bold uppercase tracking-[0.16em] text-secondary-500"
                >
                  {group.label}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {group.items.map(item => {
                    const isActive = activeItem === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={cn(
                          'min-h-11 rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'border-primary-800 bg-primary-950 text-white'
                            : 'border-secondary-200 bg-white text-secondary-700 hover:border-primary-200 hover:text-primary-900'
                        )}
                        aria-current={isActive ? 'page' : undefined}
                        onClick={() => onItemChange(item.id)}
                        data-testid={item.testId}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}
