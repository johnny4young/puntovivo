// Inventory page view tabs + their i18n key map ( slice 33).

/**
 * The seven top-level tabs of the inventory screen. Drives the segmented
 * control in InventoryHeader, the conditional panel render in InventoryPage
 * (balances / controls / expiry / transformations vs the
 * movements/stock/entries DataPanel), and the lazily-enabled per-tab queries
 * and panels.
 */
export type InventoryView =
  'movements' | 'stock' | 'entries' | 'balances' | 'controls' | 'expiry' | 'transformations';

/** Maps each view to its `inventory:` namespace tab-label i18n key. */
export const viewKeys: Record<InventoryView, string> = {
  movements: 'page.tabs.movements',
  stock: 'page.tabs.stockQuery',
  entries: 'page.tabs.initialInventory',
  balances: 'page.tabs.balances',
  controls: 'page.tabs.controls',
  expiry: 'page.tabs.expiry',
  transformations: 'page.tabs.transformations',
};
