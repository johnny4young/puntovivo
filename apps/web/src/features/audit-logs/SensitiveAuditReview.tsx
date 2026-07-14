import {
  Bot,
  Boxes,
  CircleDollarSign,
  DatabaseZap,
  RefreshCw,
  ShieldAlert,
  UserRoundCog,
  type LucideIcon,
} from 'lucide-react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/utils';

type SensitiveAuditSummary = inferRouterOutputs<AppRouter>['auditLogs']['sensitiveSummary'];
export type SensitiveAuditCategorySummary = SensitiveAuditSummary['categories'][number];
export type AuditReviewCategory = SensitiveAuditCategorySummary['category'];

interface SensitiveAuditReviewProps {
  total: number;
  categories: SensitiveAuditCategorySummary[];
  selectedCategory: AuditReviewCategory | null;
  isLoading: boolean;
  error: unknown;
  onSelectCategory: (category: AuditReviewCategory | null) => void;
  onRetry: () => void;
}

const CATEGORY_ICONS = {
  privacy: DatabaseZap,
  access: UserRoundCog,
  money: CircleDollarSign,
  inventory: Boxes,
  ai: Bot,
} as const satisfies Record<AuditReviewCategory, LucideIcon>;

const AUDIT_REVIEW_CATEGORY_IDS = Object.keys(CATEGORY_ICONS) as AuditReviewCategory[];

/** ENG-129f — risk-oriented overview and filter for immutable audit rows. */
export function SensitiveAuditReview({
  total,
  categories,
  selectedCategory,
  isLoading,
  error,
  onSelectCategory,
  onRetry,
}: SensitiveAuditReviewProps) {
  const { t } = useTranslation('auditLogs');
  const hasError = error != null;

  return (
    <section className="card p-6" aria-labelledby="sensitive-audit-review-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="pv-gt pv-gt-danger h-10 w-10 shrink-0">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h2
              id="sensitive-audit-review-title"
              className="text-lg font-semibold text-secondary-950"
            >
              {t('review.title')}
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-secondary-600">{t('review.description')}</p>
          </div>
        </div>
        {!isLoading && !hasError && (
          <span className="rounded-full bg-danger-50 px-3 py-1 text-sm font-semibold text-danger-800">
            {t('review.total', { count: total })}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5" role="status">
          <span className="sr-only">{t('review.loading')}</span>
          {AUDIT_REVIEW_CATEGORY_IDS.map(category => (
            <div
              key={category}
              className="h-28 animate-pulse rounded-2xl border border-line bg-surface-2"
            />
          ))}
        </div>
      )}

      {!isLoading && hasError && (
        <div
          className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-300/70 bg-danger-50 px-4 py-3"
          role="alert"
        >
          <p className="text-sm text-danger-800">{t('review.error')}</p>
          <button type="button" className="pv-btn outline" onClick={onRetry}>
            <RefreshCw aria-hidden="true" />
            {t('review.retry')}
          </button>
        </div>
      )}

      {!isLoading && !hasError && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {categories.map(item => {
            const Icon = CATEGORY_ICONS[item.category];
            const selected = item.category === selectedCategory;
            return (
              <button
                key={item.category}
                type="button"
                aria-pressed={selected}
                className={
                  selected
                    ? 'rounded-2xl border border-primary-500 bg-primary-50 p-4 text-left ring-2 ring-primary-200'
                    : 'rounded-2xl border border-line bg-surface p-4 text-left transition hover:border-primary-300 hover:bg-primary-50/40'
                }
                onClick={() => onSelectCategory(selected ? null : item.category)}
                data-testid={`audit-review-${item.category}`}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="pv-gt pv-gt-primary h-9 w-9 shrink-0">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <strong className="text-2xl font-semibold tabular-nums text-secondary-950">
                    {item.count}
                  </strong>
                </span>
                <span className="mt-3 block text-sm font-semibold text-secondary-900">
                  {t(`review.categories.${item.category}.title`)}
                </span>
                <span className="mt-1 block text-xs leading-5 text-secondary-600">
                  {t(`review.categories.${item.category}.description`)}
                </span>
                <span className="mt-2 block text-xs text-secondary-500">
                  {item.latestAt
                    ? t('review.latest', { date: formatDateTime(item.latestAt) })
                    : t('review.none')}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selectedCategory && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary-50 px-4 py-3 text-sm text-primary-900">
          <span>
            {t('review.activeFilter', {
              category: t(`review.categories.${selectedCategory}.title`),
            })}
          </span>
          <button
            type="button"
            className="font-semibold text-primary-800 underline-offset-4 hover:underline"
            onClick={() => onSelectCategory(null)}
          >
            {t('review.clearFilter')}
          </button>
        </div>
      )}
    </section>
  );
}
