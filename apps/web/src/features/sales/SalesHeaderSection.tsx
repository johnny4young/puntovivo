import { type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { History, PauseCircle } from 'lucide-react';
import { SalesQuickSearchBar } from '@/features/sales/SalesQuickSearchBar';
import { SoundToggleButton } from '@/features/sales/SoundToggleButton';
import { type CartWorkspace } from '@/features/sales/useCartWorkspaceStore';

/**
 * Props for {@link SalesHeaderSection}.
 *
 * The POS top chrome: the product search bar plus the History / Ventas
 * suspendidas drawer triggers, and the resumed-cart banner. Purely
 * presentational — every value + handler is owned by SalesPage.
 */
interface SalesHeaderSectionProps {
  productSearchQuery: string;
  onQueryChange: (value: string) => void;
  onSubmitSearch: () => void;
  productInputRef: RefObject<HTMLInputElement | null>;
  onOpenHistory: () => void;
  onOpenSuspended: () => void;
  suspendedDraftsCount: number;
  isResumedCart: boolean;
  activeWorkspace: CartWorkspace | null;
}

export function SalesHeaderSection({
  productSearchQuery,
  onQueryChange,
  onSubmitSearch,
  productInputRef,
  onOpenHistory,
  onOpenSuspended,
  suspendedDraftsCount,
  isResumedCart,
  activeWorkspace,
}: SalesHeaderSectionProps) {
  const { t } = useTranslation('sales');

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch xl:shrink-0">
        <div className="min-w-0 flex-1">
          <SalesQuickSearchBar
            query={productSearchQuery}
            onQueryChange={onQueryChange}
            onSubmit={onSubmitSearch}
            inputRef={productInputRef}
          />
        </div>
        <div className="flex gap-2 sm:flex-col sm:justify-end">
          <button
            type="button"
            className="btn-outline flex flex-1 items-center justify-center gap-2 whitespace-nowrap sm:flex-none"
            onClick={onOpenHistory}
            data-testid="sales-open-history"
          >
            <History className="h-4 w-4" aria-hidden="true" />
            {t('view.history')}
          </button>
          <button
            type="button"
            className="btn-outline flex flex-1 items-center justify-center gap-2 whitespace-nowrap sm:flex-none"
            onClick={onOpenSuspended}
            data-testid="sales-open-suspended"
          >
            <PauseCircle className="h-4 w-4" aria-hidden="true" />
            {t('park.panelTitle')}
            {suspendedDraftsCount > 0 && (
              <span
                className="inline-flex min-w-5 items-center justify-center rounded-full bg-primary-100 px-1.5 text-xs font-semibold text-primary-700"
                data-testid="sales-suspended-count"
              >
                {suspendedDraftsCount}
              </span>
            )}
          </button>
          <SoundToggleButton />
        </div>
      </div>

      {isResumedCart && activeWorkspace?.serverSaleNumber && (
        <div
          className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-900 xl:shrink-0"
          role="status"
          data-testid="resumed-cart-banner"
        >
          <p className="font-semibold">
            {activeWorkspace.label
              ? t('park.resumedBannerWithLabel', {
                  saleNumber: activeWorkspace.serverSaleNumber,
                  label: activeWorkspace.label,
                })
              : t('park.resumedBanner', {
                  saleNumber: activeWorkspace.serverSaleNumber,
                })}
          </p>
          <p className="mt-1 text-xs text-primary-800/80">{t('park.resumedBannerHint')}</p>
        </div>
      )}
    </>
  );
}
