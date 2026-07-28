import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_SALES_FAVORITES,
  readSalesFavoriteIds,
  toggleSalesFavoriteId,
  writeSalesFavoriteIds,
} from './salesFavorites';

describe('sales favorites', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('keeps favorites isolated by tenant and site scope', () => {
    writeSalesFavoriteIds('tenant-a:site-a', ['product-a']);
    writeSalesFavoriteIds('tenant-a:site-b', ['product-b']);

    expect(readSalesFavoriteIds('tenant-a:site-a')).toEqual(['product-a']);
    expect(readSalesFavoriteIds('tenant-a:site-b')).toEqual(['product-b']);
  });

  it('deduplicates and caps persisted favorites', () => {
    const requested = ['same', 'same', ...Array.from({ length: 20 }, (_, index) => `p-${index}`)];
    writeSalesFavoriteIds('tenant:site', requested);

    const stored = readSalesFavoriteIds('tenant:site');
    expect(stored).toHaveLength(MAX_SALES_FAVORITES);
    expect(stored?.[0]).toBe('same');
  });

  it('toggles without exceeding the device limit', () => {
    expect(toggleSalesFavoriteId(['a'], 'a')).toEqual([]);
    expect(toggleSalesFavoriteId(['a'], 'b')).toEqual(['a', 'b']);

    const full = Array.from({ length: MAX_SALES_FAVORITES }, (_, index) => `p-${index}`);
    expect(toggleSalesFavoriteId(full, 'overflow')).toEqual(full);
  });

  it('treats malformed storage as unconfigured', () => {
    window.localStorage.setItem('puntovivo:sales-favorites:v1:tenant:site', '{broken');
    expect(readSalesFavoriteIds('tenant:site')).toBeNull();
  });
});
