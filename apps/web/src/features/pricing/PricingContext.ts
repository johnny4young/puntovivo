/**
 * Tenant pricing mode for the renderer: does the catalog price
 * already include the tax?
 *
 * The server engines and the cart previews share the same
 * `splitLineTax`, but the preview still needs to know WHICH mode the
 * tenant runs. Same shape as the modules store: one `<PricingSync />`
 * bridges `companies.getPricingSettings` into a Zustand snapshot, and
 * every cart computation reads `usePriceIncludesTax()`. While the query
 * is in flight the store holds the default (tax-inclusive), which is
 * also the server's default — correct for every tenant that never
 * flipped the mode. KNOWN EDGE: an exclusive-mode tenant's cart can
 * preview inclusive totals during the brief window before the query
 * resolves (or up to staleTime after an admin flips the mode on another
 * device); the server remains the authority on what is charged.
 *
 * @module features/pricing/PricingContext
 */

import { useEffect } from 'react';
import { create } from 'zustand';

import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';

interface PricingState {
  priceIncludesTax: boolean;
  setSnapshot: (priceIncludesTax: boolean | undefined) => void;
  reset: () => void;
}

export const usePricingStore = create<PricingState>(set => ({
  priceIncludesTax: true,
  setSnapshot: priceIncludesTax => {
    set({ priceIncludesTax: priceIncludesTax ?? true });
  },
  reset: () => {
    set({ priceIncludesTax: true });
  },
}));

export function usePricingSync(): void {
  const { isAuthenticated } = useAuth();
  const query = trpc.companies.getPricingSettings.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!isAuthenticated) {
      usePricingStore.getState().reset();
      return;
    }
    usePricingStore.getState().setSnapshot(query.data?.priceIncludesTax);
  }, [isAuthenticated, query.data]);
}

/** Null-rendering mount point, placed next to ModulesSync in App.tsx. */
export function PricingSync(): null {
  usePricingSync();
  return null;
}

export function usePriceIncludesTax(): boolean {
  return usePricingStore(state => state.priceIncludesTax);
}
