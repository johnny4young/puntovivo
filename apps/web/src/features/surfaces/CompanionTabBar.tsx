import { CircleGauge, History, LayoutGrid, Printer, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { cn } from '@/lib/utils';
import { companionViews, type CompanionView } from './companionViews';

const ICONS: Record<CompanionView, LucideIcon> = {
  today: CircleGauge,
  day: History,
  registers: Printer,
  more: LayoutGrid,
};

export function CompanionTabBar({ owner, active }: { owner: boolean; active: CompanionView }) {
  const { t } = useTranslation('companion');
  const [searchParams] = useSearchParams();
  const hrefFor = (view: CompanionView) => {
    const next = new URLSearchParams();
    if (view !== 'today') next.set('view', view);
    // Keep an open decision when the owner peeks at another tab.
    const decide = searchParams.get('decide');
    if (decide) next.set('decide', decide);
    const query = next.toString();
    return query ? `/c/?${query}` : '/c/';
  };
  return (
    <nav
      aria-label={t('tabs.label')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]"
      data-testid="companion-tabs"
    >
      <ul className="mx-auto flex max-w-md">
        {companionViews(owner).map(view => {
          const Icon = ICONS[view];
          const current = view === active;
          return (
            <li key={view} className="flex-1">
              <Link
                to={hrefFor(view)}
                aria-current={current ? 'page' : undefined}
                className={cn(
                  'flex min-h-16 flex-col items-center justify-center gap-1 text-[12px] font-semibold focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary-100',
                  current ? 'text-fg1' : 'text-fg3'
                )}
                data-testid={`companion-tab-${view}`}
              >
                <Icon className="h-5 w-5" strokeWidth={current ? 2.25 : 1.75} aria-hidden="true" />
                {t(`tabs.${view}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
