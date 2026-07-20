/** shared dynamic loader for the deferred payment drawer. */

export const loadSalePaymentModal = () => import('./SalePaymentModal');

/** Best-effort preload used after the hot sales shell has painted. */
export async function preloadSalePaymentModal(): Promise<void> {
  await loadSalePaymentModal();
}
