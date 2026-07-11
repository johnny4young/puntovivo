/**
 * ENG-200 — deferred payment drawer boundary.
 *
 * The checkout drawer is substantial but is not needed for the first paint of
 * `/sales`. Keep it in a dedicated chunk, then warm that chunk during the
 * browser's first idle window so pressing F1 still feels immediate.
 */

import { lazy } from 'react';
import { loadSalePaymentModal } from './salePaymentModal.loader';

export const LazySalePaymentModal = lazy(async () => {
  const module = await loadSalePaymentModal();
  return { default: module.SalePaymentModal };
});
