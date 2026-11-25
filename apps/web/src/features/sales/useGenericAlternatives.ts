import { useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import type { ProductSearchItem } from '@/types';

export interface GenericAlternative {
  productId: string;
  name: string;
  sku: string;
  price: number;
  savings: number;
}

const NONE: { inResults: ReadonlyMap<string, number>; elsewhere: GenericAlternative[] } = {
  inResults: new Map(),
  elsewhere: [],
};

/**
 * Cheaper equivalents of the picked medicine at the site. Those already in the
 * results are badged on their row; the rest are offered beside the pick.
 */
export function useGenericAlternatives({
  product,
  siteId,
  priceTier,
  items,
}: {
  product: ProductSearchItem | null;
  siteId: string | null;
  priceTier: 1 | 2 | 3;
  items: readonly ProductSearchItem[];
}) {
  const enabled = Boolean(product?.pharmacy && siteId);
  const query = trpc.pharmacy.genericAlternatives.useQuery(
    { productId: product?.id ?? '', siteId: siteId ?? undefined, priceTier, limit: 3 },
    { enabled, staleTime: 30_000 }
  );
  const alternatives = enabled ? query.data?.items : undefined;

  return useMemo(() => {
    if (!alternatives || alternatives.length === 0) return NONE;
    const listed = new Set(items.map(item => item.id));
    return {
      inResults: new Map(
        alternatives
          .filter(alternative => listed.has(alternative.productId))
          .map(alternative => [alternative.productId, alternative.savings])
      ),
      elsewhere: alternatives.filter(alternative => !listed.has(alternative.productId)),
    };
  }, [alternatives, items]);
}
