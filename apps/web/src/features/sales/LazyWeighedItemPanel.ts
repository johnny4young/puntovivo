import { lazy } from 'react';

/** Shared by Vender and the touch POS; loads with the first by-weight product. */
export const WeighedItemPanel = lazy(async () => {
  const module = await import('./WeighedItemPanel');
  return { default: module.WeighedItemPanel };
});
