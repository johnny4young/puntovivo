/**
 * The keyboard shortcuts this site publishes.
 *
 * Every entry carries the product's own shortcut `id`, and
 * `publicClaims.test.mjs` reads `apps/web/src/lib/shortcuts.ts` to prove
 * the published combo matches what the app actually binds. Before that
 * check existed the sheet listed 31 shortcuts, of which 25 did not exist
 * — a promise the product could never keep.
 *
 * Adding a shortcut here without shipping it in the app fails the suite.
 */

/** Display glyph → the product's canonical modifier token. */
const CANONICAL_BY_GLYPH = {
  '⌘': 'Mod',
  '⌥': 'Alt',
  '⇧': 'Shift',
  Shift: 'Shift',
};

/**
 * Convert the sheet's display keys into the product's canonical combo
 * (`['⌘', 'Shift', 'P'] → 'Mod+Shift+P'`).
 */
export function canonicalCombo(keys) {
  return keys.map(key => CANONICAL_BY_GLYPH[key] ?? key).join('+');
}

export const SITE_SHORTCUTS = [
  // Register — the sales screen, where a cashier lives all day.
  { id: 'sales.charge', areaKey: 'Caja', actionId: 'cobrarVenta', keys: ['F1'] },
  { id: 'sales.fastCash', areaKey: 'Caja', actionId: 'cobroRapido', keys: ['F2'] },
  { id: 'sales.productSearch', areaKey: 'Caja', actionId: 'abrirCatalogo', keys: ['F5'] },
  { id: 'sales.focusProduct', areaKey: 'Caja', actionId: 'buscarProducto', keys: ['⌥', 'P'] },
  { id: 'sales.focusQuantity', areaKey: 'Caja', actionId: 'enfocarCantidad', keys: ['⌥', 'C'] },
  { id: 'sales.focusDiscount', areaKey: 'Caja', actionId: 'enfocarDescuento', keys: ['⌥', 'D'] },
  { id: 'sales.focusUnit', areaKey: 'Caja', actionId: 'enfocarUnidad', keys: ['⌥', 'U'] },
  { id: 'sales.removeItem', areaKey: 'Caja', actionId: 'quitarLinea', keys: ['Delete'] },
  { id: 'sales.undo', areaKey: 'Caja', actionId: 'deshacer', keys: ['⌘', 'Z'] },
  { id: 'sales.suspend', areaKey: 'Caja', actionId: 'suspenderVenta', keys: ['⌘', 'P'] },
  { id: 'sales.toggleSuspended', areaKey: 'Caja', actionId: 'verSuspendidas', keys: ['⌘', 'R'] },
  {
    id: 'sales.reprint',
    areaKey: 'Caja',
    actionId: 'reimprimirRecibo',
    keys: ['⌘', 'Shift', 'P'],
  },

  { id: 'sales.newSale', areaKey: 'Caja', actionId: 'nuevaVenta', keys: ['⌥', 'N'] },

  // Cash close — the register lifecycle around the sale.
  { id: 'sales.openCashSession', areaKey: 'Cierre', actionId: 'abrirCaja', keys: ['⌥', 'A'] },
  {
    id: 'sales.cashMovement',
    areaKey: 'Cierre',
    actionId: 'registrarMovimiento',
    keys: ['⌥', 'M'],
  },
  {
    id: 'sales.closeCashSession',
    areaKey: 'Cierre',
    actionId: 'cerrarCajaCiego',
    keys: ['⌥', 'Shift', 'C'],
  },

  // Navigation — global, from anywhere in the app.
  { id: 'palette.open', areaKey: 'Navegación', actionId: 'abrirPaleta', keys: ['⌘', 'K'] },
  { id: 'nav.dashboard', areaKey: 'Navegación', actionId: 'irDashboard', keys: ['⌥', '1'] },
  { id: 'nav.sales', areaKey: 'Navegación', actionId: 'irVentas', keys: ['⌥', '2'] },
  { id: 'nav.inventory', areaKey: 'Navegación', actionId: 'irInventario', keys: ['⌥', '3'] },
  { id: 'nav.purchases', areaKey: 'Navegación', actionId: 'irCompras', keys: ['⌥', '4'] },
  { id: 'app.shortcutsSheet', areaKey: 'Navegación', actionId: 'mostrarAtajos', keys: ['⌥', '/'] },
  { id: 'app.switchSite', areaKey: 'Navegación', actionId: 'cambiarSede', keys: ['⌥', 'Shift', 'S'] },

  // System — session and appearance.
  {
    id: 'app.themeToggle',
    areaKey: 'Sistema',
    actionId: 'modoClaroOscuro',
    keys: ['⌥', 'Shift', 'D'],
  },
  { id: 'app.logout', areaKey: 'Sistema', actionId: 'cerrarSesion', keys: ['⌥', 'Q'] },
];
