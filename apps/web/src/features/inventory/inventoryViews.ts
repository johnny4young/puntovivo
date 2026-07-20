// Inventory page view tabs + their i18n key map ( slice 33).

/**
 * The five top-level tabs of the inventory screen. Drives the segmented
 * control in InventoryHeader, the conditional panel render in InventoryPage
 * (balances / the  expiry radar vs the movements/stock/entries
 * DataPanel), and the lazily-enabled per-tab queries (`sites.list` on
 * `balances`, `inventoryLots.expiring` on `expiry`).
 */
export type InventoryView = 'movements' | 'stock' | 'entries' | 'balances' | 'expiry';

/** Maps each view to its `inventory:` namespace tab-label i18n key. */
export const viewKeys: Record<InventoryView, string> = {
  movements: 'page.tabs.movements',
  stock: 'page.tabs.stockQuery',
  entries: 'page.tabs.initialInventory',
  balances: 'page.tabs.balances',
  expiry: 'page.tabs.expiry',
};
