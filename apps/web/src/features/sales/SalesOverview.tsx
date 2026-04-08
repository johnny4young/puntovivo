import type { RefObject } from 'react';
import { Receipt, Search } from 'lucide-react';
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
    <>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-secondary-900">Sales</h1>
          <p className="mt-1 text-sm text-secondary-500">
            Run POS transactions and review recent completed sales
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SalesQuickSearchBar
            query={productSearchQuery}
            onQueryChange={onProductSearchQueryChange}
            onSubmit={onOpenSearch}
            inputRef={productInputRef}
          />
          <div className="rounded-lg border border-secondary-200 px-3 py-2 text-sm">
            <p className="text-secondary-500">Active site</p>
            <p className="font-medium text-secondary-900">{currentSiteName ?? 'No site selected'}</p>
          </div>
          <button className="btn-outline flex items-center gap-2" onClick={onOpenSearch}>
            <Search className="h-4 w-4" />
            Add Product
          </button>
          <button
            className="btn-primary flex items-center gap-2"
            onClick={onCharge}
            disabled={!canCharge}
          >
            <Receipt className="h-4 w-4" />
            Charge Sale
          </button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Today's Sales</p>
          <p className="mt-1 text-2xl font-bold text-secondary-900">
            {isSummaryLoading ? '—' : formatCurrency(todaySalesTotal)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Transactions</p>
          <p className="mt-1 text-2xl font-bold text-secondary-900">
            {isSummaryLoading ? '—' : transactionCount}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Average Order</p>
          <p className="mt-1 text-2xl font-bold text-secondary-900">
            {isSummaryLoading ? '—' : formatCurrency(averageOrder)}
          </p>
        </div>
        <div className="card p-4">
          <p className="text-sm text-secondary-500">Draft Total</p>
          <p className="mt-1 text-2xl font-bold text-primary-700">{formatCurrency(draftTotal)}</p>
        </div>
      </div>

      {!currentSiteName && (
        <div className="rounded-xl border border-warning-300 bg-warning-50 px-4 py-4 text-sm text-warning-700">
          Select an active site before charging a sale so the correct sequential is used.
        </div>
      )}
    </>
  );
}
