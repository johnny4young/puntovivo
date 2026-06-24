// Inventory page view tabs + their i18n key map (ENG-178 slice 33).

/**
 * The four top-level tabs of the inventory screen. Drives the segmented
 * control in InventoryHeader, the conditional panel render in InventoryPage
 * (balances vs the movements/stock/entries DataPanel), and the lazy
 * `sites.list` query (only fetched on the `balances` tab).
 */
export type InventoryView = 'movements' | 'stock' | 'entries' | 'balances';

/** Maps each view to its `inventory:` namespace tab-label i18n key. */
export const viewKeys: Record<InventoryView, string> = {
  movements: 'page.tabs.movements',
  stock: 'page.tabs.stockQuery',
  entries: 'page.tabs.initialInventory',
  balances: 'page.tabs.balances',
};
