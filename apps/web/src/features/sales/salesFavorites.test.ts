import { beforeEach, describe, expect, it } from 'vitest';
import { clearSalesFavoriteIds, readSalesFavoriteIds } from './salesFavorites';

const key = (scope: string) => `puntovivo:sales-favorites:v1:${scope}`;

describe('legacy sales favorites', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('reads favourites per tenant and site scope, dropping malformed ids', () => {
    const many = Array.from({ length: 20 }, (_, index) => `p-${index}`);
    window.localStorage.setItem(key('tenant-a:site-a'), JSON.stringify({ productIds: many }));
    window.localStorage.setItem(key('tenant-a:site-b'), JSON.stringify({ productIds: ['b', 7] }));

    expect(readSalesFavoriteIds('tenant-a:site-a')).toEqual(many);
    expect(readSalesFavoriteIds('tenant-a:site-b')).toEqual(['b']);
  });

  it('forgets a scope once cleared', () => {
    window.localStorage.setItem(key('tenant:site'), JSON.stringify({ productIds: ['a'] }));
    clearSalesFavoriteIds('tenant:site');
    expect(readSalesFavoriteIds('tenant:site')).toBeNull();
  });

  it('treats malformed storage as unconfigured', () => {
    window.localStorage.setItem(key('tenant:site'), '{broken');
    expect(readSalesFavoriteIds('tenant:site')).toBeNull();
  });
});
