import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { History, MonitorUp, PauseCircle } from 'lucide-react';
import { PaceToggleButton } from '@/features/sales/PaceToggleButton';
import { SoundToggleButton } from '@/features/sales/SoundToggleButton';
import { type CartWorkspace } from '@/features/sales/useCartWorkspaceStore';
import { ariaKeyshortcutsFor } from '@/lib/shortcuts';

/** The register strip above the ticket, followed by the locked-cart banners. */
interface SalesHeaderSectionProps {
  /** Open register name; null while the register is closed. */
  registerName: string | null;
  cashierName: string | null;
  siteName: string | null;
  onOpenHistory: () => void;
  /** Omitted when the register does not park sales and none are waiting. */
  onOpenSuspended?: (() => void) | undefined;
  suspendedDraftsCount: number;
  customerDisplayEnabled: boolean;
  onOpenCustomerDisplay: () => void;
  isResumedCart: boolean;
  activeWorkspace: CartWorkspace | null;
  /** Open tickets, kept in the strip. */
  workspaceTabs?: ReactNode;
  /** Connection and device pills. */
  status?: ReactNode;
  /** Price tier of the active ticket; omitted on locked tickets. */
  priceTier?: 1 | 2 | 3 | undefined;
  onPriceTierChange?: ((tier: 1 | 2 | 3) => void) | undefined;
}

const UTILITY_BUTTON =
  'sales-strip-action btn-outline flex min-w-0 flex-none items-center justify-center gap-2 whitespace-nowrap';

export function SalesHeaderSection({
  registerName,
  cashierName,
  siteName,
  onOpenHistory,
  onOpenSuspended,
  suspendedDraftsCount,
  customerDisplayEnabled,
  onOpenCustomerDisplay,
  isResumedCart,
  activeWorkspace,
  workspaceTabs,
  status,
  priceTier,
  onPriceTierChange,
}: SalesHeaderSectionProps) {
  const { t } = useTranslation(['sales', 'salesOperation']);
  const who = [cashierName, siteName].filter(Boolean).join(' · ');

  return (
    <>
      <div
        className="sales-register-strip"
        role="group"
        aria-label={t('sell.strip.ariaLabel')}
        data-testid="sales-command-bar"
      >
        <span
          className={`sales-pill sales-register-state md:hidden ${registerName ? 'is-open' : ''}`}
          title={registerName ?? undefined}
          data-testid="sales-register-state"
        >
          {t(registerName ? 'salesOperation:registerOpen' : 'salesOperation:registerClosed')}
        </span>
        <p
          className="min-w-0 shrink-[4] truncate max-md:hidden"
          data-testid="sales-register-identity"
        >
          <span className="font-display text-lg font-bold text-fg1">
            {registerName ?? t('cashSession.inactive')}
          </span>
          {who && <span className="ml-2.5 hidden text-[13px] text-fg3 2xl:inline">{who}</span>}
        </p>
        <span className="hidden h-7 w-px shrink-0 bg-line-strong lg:block" aria-hidden="true" />
        {workspaceTabs}
        {priceTier !== undefined && onPriceTierChange && (
          <div
            className="flex shrink-0 items-center gap-0.5 rounded-xl border border-line bg-surface-3 p-0.5"
            role="group"
            aria-label={t('checkout.priceTier.groupLabel')}
            data-testid="sales-price-tier"
          >
            {([1, 2, 3] as const).map(tier => (
              <button
                key={tier}
                type="button"
                className="sales-tier-key"
                aria-pressed={tier === priceTier}
                data-testid={`sales-price-tier-${tier}`}
                title={t(`checkout.priceTier.tier${tier}Title`)}
                onClick={() => onPriceTierChange(tier)}
              >
                {t(`checkout.priceTier.tier${tier}`)}
              </button>
            ))}
          </div>
        )}
        <span className="hidden flex-1 lg:block" />
        {status}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className={UTILITY_BUTTON}
            onClick={onOpenHistory}
            data-testid="sales-open-history"
            title={t('view.history')}
          >
            <History className="h-4 w-4" aria-hidden="true" />
            <span className="min-w-0 truncate max-md:sr-only lg:sr-only">{t('view.history')}</span>
          </button>
          {onOpenSuspended && (
            <button
              type="button"
              className={UTILITY_BUTTON}
              onClick={onOpenSuspended}
              data-testid="sales-open-suspended"
              title={t('park.panelTitle')}
              aria-keyshortcuts={
                suspendedDraftsCount > 0 ? ariaKeyshortcutsFor('sales.toggleSuspended') : undefined
              }
            >
              <PauseCircle className="h-4 w-4" aria-hidden="true" />
              <span className="min-w-0 truncate max-md:sr-only lg:sr-only">
                {t('park.panelTitle')}
              </span>
              {suspendedDraftsCount > 0 && (
                <span
                  className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 font-numeric text-xs font-bold text-primary"
                  data-testid="sales-suspended-count"
                >
                  {suspendedDraftsCount}
                </span>
              )}
            </button>
          )}
          {customerDisplayEnabled ? (
            <button
              type="button"
              className={UTILITY_BUTTON}
              onClick={onOpenCustomerDisplay}
              data-testid="sales-open-customer-display"
              aria-label={t('view.customerDisplay')}
              title={t('view.customerDisplay')}
            >
              <MonitorUp className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <SoundToggleButton />
          <PaceToggleButton />
        </div>
      </div>

      {isResumedCart && activeWorkspace?.serverSaleNumber && (
        <div
          className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-900 lg:shrink-0"
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

      {activeWorkspace?.sourceQuotationNumber && (
        <div
          className="rounded-2xl border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-900 lg:shrink-0"
          role="status"
          data-testid="quotation-cart-banner"
        >
          <p className="font-semibold">
            {t('quotationCart.banner', {
              quotationNumber: activeWorkspace.sourceQuotationNumber,
            })}
          </p>
          <p className="mt-1 text-xs text-primary-800/80">{t('quotationCart.bannerHint')}</p>
        </div>
      )}

      {activeWorkspace?.sourceReturnId && (
        <div
          className="rounded-2xl border border-warning-500/30 bg-warning-50 px-4 py-3 text-sm text-warning-900 lg:shrink-0"
          role="status"
          data-testid="exchange-cart-banner"
        >
          <p className="font-semibold">
            {t('exchangeCart.banner', {
              saleNumber: activeWorkspace.sourceReturnSaleNumber,
            })}
          </p>
          <p className="mt-1 text-xs text-warning-800/80">{t('exchangeCart.bannerHint')}</p>
        </div>
      )}
    </>
  );
}
