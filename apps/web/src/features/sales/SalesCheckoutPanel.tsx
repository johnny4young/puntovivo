import { Plus, Receipt, ScanLine } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/lib/utils';
import type { SaleCartSummary } from '@/features/sales/saleCart';
import type { Site } from '@/types';

interface SalesCheckoutPanelProps {
  currentSite: Site | null;
  draftSummary: SaleCartSummary;
  canCharge: boolean;
  onOpenSearch: () => void;
  onCharge: () => void;
}

export function SalesCheckoutPanel({
  currentSite,
  draftSummary,
  canCharge,
  onOpenSearch,
  onCharge,
}: SalesCheckoutPanelProps) {
  const { t } = useTranslation('sales');
  return (
    <aside className="card p-5 sm:p-6 xl:sticky xl:top-24">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="page-kicker text-[0.62rem] tracking-[0.24em]">{t('checkout.kicker')}</p>
          <h2 className="mt-3 font-display text-3xl text-secondary-950">{t('checkout.chargeSummary')}</h2>
          <p className="mt-2 text-sm text-secondary-600">
            {t('checkout.chargeSummaryDescription')}
          </p>
        </div>
        <button className="btn-outline btn-icon h-11 w-11" onClick={onOpenSearch} aria-label={t('checkout.searchProducts')}>
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-6 rounded-[26px] border border-line/70 bg-secondary-950 px-5 py-5 text-white">
        <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-white/55">{t('checkout.totalDue')}</p>
        <p className="mt-3 text-4xl font-semibold tracking-tight">{formatCurrency(draftSummary.total)}</p>
        <div className="mt-6 grid gap-3 text-sm text-white/72">
          <div className="flex items-center justify-between">
            <span>{t('checkout.itemCount')}</span>
            <span className="font-semibold text-white">{draftSummary.itemCount}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('checkout.subtotal')}</span>
            <span className="font-semibold text-white">{formatCurrency(draftSummary.subtotal)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>{t('checkout.vat')}</span>
            <span className="font-semibold text-white">{formatCurrency(draftSummary.taxAmount)}</span>
          </div>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <div className="card-inset px-4 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-primary-50 text-primary-700">
              <ScanLine className="h-4.5 w-4.5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-secondary-950">{t('checkout.searchProducts')}</p>
              <p className="mt-1 text-sm text-secondary-500">
                {t('checkout.searchHint')}
              </p>
            </div>
          </div>
        </div>

        <div className="card-inset px-4 py-4 text-sm text-secondary-600">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
            {t('checkout.chargeSite')}
          </p>
          <p className="mt-2 text-base font-semibold text-secondary-950">
            {currentSite?.name ?? t('checkout.noSite')}
          </p>
        </div>

        <div className="card-inset px-4 py-4 text-sm text-secondary-600">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
            {t('checkout.shortcuts')}
          </p>
          <p className="mt-2">{t('checkout.shortcutsHint')}</p>
        </div>

        <button className="btn-primary hidden w-full justify-center xl:inline-flex" onClick={onCharge} disabled={!canCharge}>
          <Receipt className="h-4 w-4" />
          {t('checkout.chargeSale')}
        </button>
      </div>
    </aside>
  );
}
