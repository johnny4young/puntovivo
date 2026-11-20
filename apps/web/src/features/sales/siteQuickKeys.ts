import { useCallback, useMemo } from 'react';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@puntovivo/server';
import type { SiteQuickKeyColour, SiteQuickKeyKind } from '@puntovivo/shared/quick-keys';
import { selectionFromHydratedProduct } from '@/features/sales/productSelection';
import { trpc } from '@/lib/trpc';
import type { Product, ProductSearchSelection } from '@/types';

export type SiteQuickKey = inferRouterOutputs<AppRouter>['quickKeys']['list'][number];

/** One key of the strip, or a suggested product while the site has none. */
export interface QuickTile {
  key: string;
  kind: SiteQuickKeyKind;
  productId: string;
  unitId: string | null;
  unitAbbreviation: string | null;
  sku: string;
  name: string;
  price: number;
  categoryId: string | null;
  colour: SiteQuickKeyColour | null;
}

export function keyTile(key: SiteQuickKey): QuickTile {
  return {
    key: key.id,
    kind: key.kind,
    productId: key.productId,
    unitId: key.unitId,
    unitAbbreviation: key.unitAbbreviation,
    sku: key.productSku,
    name: key.label ?? key.productName,
    price: key.catalogPrice,
    categoryId: key.categoryId,
    colour: key.colour,
  };
}

export function productTile(product: {
  id: string;
  sku: string;
  name: string;
  price: number;
  categoryId?: string | null;
}): QuickTile {
  return {
    key: product.id,
    kind: 'product',
    productId: product.id,
    unitId: null,
    unitAbbreviation: null,
    sku: product.sku,
    name: product.name,
    price: product.price,
    categoryId: product.categoryId ?? null,
    colour: null,
  };
}

/** The site's keys in order; `tiles` leaves out keys whose product can no longer be sold. */
export function useSiteQuickKeys(siteId: string) {
  const query = trpc.quickKeys.list.useQuery(
    { siteId },
    { enabled: siteId.length > 0, staleTime: 60_000 }
  );
  const keys = useMemo(() => query.data ?? [], [query.data]);
  const tiles = useMemo(() => keys.filter(key => key.sellable).map(keyTile), [keys]);
  return { query, keys, tiles };
}

/** Tiles carry list data only; the cart needs the current product and its units. */
export function useQuickTileSelection(siteId: string) {
  const utils = trpc.useUtils();
  return useCallback(
    async (tile: QuickTile): Promise<ProductSearchSelection | null> => {
      const hydrated = await utils.products.getById.fetch(
        { id: tile.productId, siteId },
        { staleTime: 0 }
      );
      return selectionFromHydratedProduct(hydrated as unknown as Product, tile.unitId);
    },
    [siteId, utils]
  );
}
