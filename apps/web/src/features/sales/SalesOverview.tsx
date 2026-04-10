import type { RefObject } from 'react';
import { Receipt, Search, Store, TrendingUp } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { SalesQuickSearchBar } from '@/features/sales/SalesQuickSearchBar';

interface SalesOverviewProps {
  currentSiteName: string | null;
  isSummaryLoading: boolean;
  todaySalesTotal: number;
  transactionCount: number;
  averageOrder: number;
  draftTotal: number;
  canCharge: boolean;
  productSearchQuery: string;
  onProductSearchQueryChange: (value: string) => void;
  onOpenSearch: () => void;
  onCharge: () => void;
  productInputRef: RefObject<HTMLInputElement | null>;
}

export function SalesOverview({
  currentSiteName,
  isSummaryLoading,
  todaySalesTotal,
  transactionCount,
  averageOrder,
  draftTotal,
  canCharge,
  productSearchQuery,
  onProductSearchQueryChange,
  onOpenSearch,
  onCharge,
  productInputRef,
}: SalesOverviewProps) {
  return (
    <section className="hero-surface p-5 sm:p-6 xl:p-7">
      <div className="relative z-10 grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(21rem,0.95fr)]">
        <div className="space-y-5">
          <div className="space-y-3">
            <p className="page-kicker">Sales desk</p>
            <h1 className="font-display text-5xl leading-[0.92] text-balance text-secondary-950">
              Checkout built for fast scanning and calm oversight.
            </h1>
            <p className="max-w-2xl text-sm leading-7 text-secondary-600 sm:text-base">
              Add products quickly, adjust units and discounts, then charge the active site with a
              compact POS workspace built around daily speed.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <div className="metric-tile">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                Today&apos;s sales
              </p>
              <p className="mt-3 text-3xl font-semibold text-secondary-950">
                {isSummaryLoading ? '—' : formatCurrency(todaySalesTotal)}
              </p>
            </div>
            <div className="metric-tile">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                Transactions
              </p>
              <p className="mt-3 text-3xl font-semibold text-secondary-950">
                {isSummaryLoading ? '—' : transactionCount}
              </p>
            </div>
            <div className="metric-tile">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                Average order
              </p>
              <p className="mt-3 text-3xl font-semibold text-secondary-950">
                {isSummaryLoading ? '—' : formatCurrency(averageOrder)}
              </p>
            </div>
            <div className="metric-tile">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                Draft total
              </p>
              <p className="mt-3 text-3xl font-semibold text-primary-700">{formatCurrency(draftTotal)}</p>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <SalesQuickSearchBar
            query={productSearchQuery}
            onQueryChange={onProductSearchQueryChange}
            onSubmit={onOpenSearch}
            inputRef={productInputRef}
          />

          <div className="card-inset grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[18px] bg-primary-50 text-primary-700">
                <Store className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0">
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.18em] text-secondary-500">
                  Active site
                </p>
                <p className="mt-2 truncate text-lg font-semibold text-secondary-950">
                  {currentSiteName ?? 'No site selected'}
                </p>
                <p className="mt-1 text-sm text-secondary-500">
                  The selected site controls sequential numbering and stock validation.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:justify-end">
              <button className="btn-outline" onClick={onOpenSearch}>
                <Search className="h-4 w-4" />
                Add product
              </button>
              <button className="btn-primary" onClick={onCharge} disabled={!canCharge}>
                <Receipt className="h-4 w-4" />
                Charge sale
              </button>
            </div>
          </div>

          {!currentSiteName && (
            <div className="rounded-[22px] border border-warning-500/20 bg-warning-50 px-4 py-4 text-sm text-warning-700">
              Select an active site before charging so the correct sequential and stock scope are used.
            </div>
          )}

          <div className="card-inset flex items-center gap-3 px-4 py-3 text-sm text-secondary-600">
            <TrendingUp className="h-4.5 w-4.5 text-primary-700" />
            Keyboard-first workflow: `F5` catalog, `F1` charge, `Delete` remove current line.
          </div>
        </div>
      </div>
    </section>
  );
}
