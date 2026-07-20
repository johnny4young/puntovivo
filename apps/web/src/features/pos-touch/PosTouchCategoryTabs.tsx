/**
 * Touch POS V1 category tabs.
 *
 * Horizontal scroll row of category pills with per-category item
 * counts. The "Todas" / "All" tab is always first and shows the
 * total catalog count. Each tab is ≥ 44 × 44 px to clear the iOS
 * Human Interface Guidelines minimum.
 *
 * Touch-first design notes:
 * - Horizontal `overflow-x-auto` so categories overflow
 * gracefully on narrow viewports instead of wrapping into
 * multiple rows.
 * - `snap-x snap-mandatory` for the scroll-snap feel on tablets.
 * - Active pill uses the primary-tinted radial-gradient surface
 * shared with DeliveryPage / CustomerLedgerModal so the touch
 * POS reads as one cohesive product.
 */
import { useTranslation } from 'react-i18next';

export interface PosTouchCategoryOption {
  id: string;
  name: string;
  count: number;
}

interface PosTouchCategoryTabsProps {
  categories: PosTouchCategoryOption[];
  activeCategoryId: string | null;
  onSelectCategory: (categoryId: string | null) => void;
  totalCount: number;
}

export function PosTouchCategoryTabs({
  categories,
  activeCategoryId,
  onSelectCategory,
  totalCount,
}: PosTouchCategoryTabsProps) {
  const { t } = useTranslation('posTouch');

  const tabs: Array<{ id: string | null; name: string; count: number }> = [
    { id: null, name: t('categories.all'), count: totalCount },
    ...categories.map(c => ({ id: c.id, name: c.name, count: c.count })),
  ];

  return (
    <nav
      aria-label={t('categories.label')}
      data-testid="pos-touch-category-tabs"
      className="flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1"
    >
      {tabs.map(tab => {
        const isActive = tab.id === activeCategoryId;
        const testId = `pos-touch-category-${tab.id ?? 'all'}`;
        return (
          <button
            key={tab.id ?? 'all'}
            type="button"
            data-testid={testId}
            data-active={isActive ? 'true' : 'false'}
            onClick={() => onSelectCategory(tab.id)}
            className={[
              'inline-flex min-h-[44px] shrink-0 snap-start items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors',
              isActive
                ? 'border-primary-500 bg-primary-50 text-primary-900 ring-2 ring-primary-200'
                : 'border-line/70 bg-surface-1 text-secondary-700 hover:bg-surface-2',
            ].join(' ')}
          >
            <span className="truncate">{tab.name}</span>
            <span
              className={[
                'rounded-full px-2 py-0.5 text-xs tabular-nums',
                isActive
                  ? 'bg-primary-100 text-primary-900'
                  : 'bg-secondary-100 text-secondary-600',
              ].join(' ')}
              data-testid={`${testId}-count`}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
