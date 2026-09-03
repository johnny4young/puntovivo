// Inventory page view tabs + their i18n key map ( slice 33).

/**
 * The seven top-level tabs of the inventory screen. Drives the segmented
 * control in InventoryHeader, the conditional panel render in InventoryPage
 * (balances / controls / expiry / transformations vs the
 * movements/stock/entries DataPanel), and the lazily-enabled per-tab queries
 * and panels.
 */
export type InventoryView =
  | 'movements'
  | 'stock'
  | 'entries'
  | 'balances'
  | 'controls'
  | 'expiry'
  | 'transformations'
  | 'pharmacy';

/** Maps each view to its `inventory:` namespace tab-label i18n key. */
export const viewKeys: Record<InventoryView, string> = {
  movements: 'page.tabs.movements',
  stock: 'page.tabs.stockQuery',
  entries: 'page.tabs.initialInventory',
  balances: 'page.tabs.balances',
  controls: 'page.tabs.controls',
  expiry: 'page.tabs.expiry',
  transformations: 'page.tabs.transformations',
  pharmacy: 'page.tabs.pharmacy',
};

/**
 * Views a manager owns exclusively. Every count and replenishment procedure
 * behind `controls` is a managerOrAdmin one, so rendering the tab for a
 * cashier offers a screen that can only answer with authorization errors.
 */
const MANAGER_ONLY_VIEWS: ReadonlySet<InventoryView> = new Set(['controls']);

/** Views that only exist for a tenant operating that vertical. */
const VERTICAL_VIEWS: ReadonlySet<InventoryView> = new Set(['pharmacy']);

/** What an actor is allowed to see, in one place. */
export interface InventoryViewAccess {
  canManage: boolean;
  /** Pharmacy custody is configured or already carries operational data. */
  showPharmacy: boolean;
}

/**
 * The tabs a given actor may actually open, in display order.
 *
 * Every visibility rule lives here rather than as a filter stacked on the
 * header's map: the page derives its active view from the same function, so a
 * tab that is not rendered can also never stay selected.
 */
export function visibleInventoryViews(access: InventoryViewAccess): InventoryView[] {
  const all = Object.keys(viewKeys) as InventoryView[];
  return all.filter(view => {
    if (!access.canManage && MANAGER_ONLY_VIEWS.has(view)) return false;
    if (VERTICAL_VIEWS.has(view) && !access.showPharmacy) return false;
    return true;
  });
}

/**
 * Fall back to a view the actor may open. A role can change under an open
 * page (a shift handover on a shared workstation), which would otherwise
 * leave the manager-only panel mounted and failing for the new actor.
 */
export function resolveAllowedInventoryView(
  view: InventoryView,
  access: InventoryViewAccess
): InventoryView {
  return visibleInventoryViews(access).includes(view) ? view : 'movements';
}
