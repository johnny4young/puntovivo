# Keyboard shortcuts

> Status: shipped and regression-tested. The canonical runtime catalogue is
> `apps/web/src/lib/shortcuts.ts`.

The catalogue owns shortcut ids, keys, scope, labels, route metadata and role
permissions. Global listeners, command-palette hints, visible navigation links
and exact-action controls derive from it; they must not maintain parallel key
or route maps.

## Runtime ownership

| Concern                                          | Owner                                                          |
| ------------------------------------------------ | -------------------------------------------------------------- |
| Canonical definitions and key matching           | `apps/web/src/lib/shortcuts.ts`                                |
| Global navigation, theme, site, sheet and logout | `apps/web/src/components/feedback/GlobalShortcutsProvider.tsx` |
| Lazy shortcut sheet and logout confirmation      | `apps/web/src/components/feedback/GlobalShortcutsSheet.tsx`    |
| Sales, cart and cash-register actions            | `apps/web/src/features/sales/useSalesKeyboardShortcuts.ts`     |
| Command-palette route hints                      | `apps/web/src/lib/commandPaletteActions.ts`                    |

`Mod` means `Command` on macOS and `Control` on Windows/Linux. The matcher
accepts `Meta` on non-macOS for external keyboards. Global Alt shortcuts use a
careful physical-code fallback for composed characters on macOS, but never
remap an ordinary printable key by keyboard position.

## Current catalogue

### Global

| Id                   | Keys          | Roles                   | Action                                                              |
| -------------------- | ------------- | ----------------------- | ------------------------------------------------------------------- |
| `palette.open`       | `Mod+K`       | authenticated           | Open the command palette.                                           |
| `nav.dashboard`      | `Alt+1`       | admin, manager, viewer  | Navigate to the dashboard.                                          |
| `nav.sales`          | `Alt+2`       | admin, manager, cashier | Navigate to sales.                                                  |
| `nav.inventory`      | `Alt+3`       | admin, manager          | Navigate to inventory.                                              |
| `nav.purchases`      | `Alt+4`       | admin, manager          | Navigate to purchases.                                              |
| `app.shortcutsSheet` | `Alt+/`       | authenticated           | Toggle the shortcut sheet. Spanish `Shift+7` layouts are supported. |
| `app.themeToggle`    | `Alt+Shift+D` | authenticated           | Toggle light/dark theme.                                            |
| `app.switchSite`     | `Alt+Shift+S` | authenticated           | Select the next active site when another site exists.               |
| `app.logout`         | `Alt+Q`       | authenticated           | Open confirmation before logout.                                    |

### Sales and register

| Id                       | Keys          | Action                                                               |
| ------------------------ | ------------- | -------------------------------------------------------------------- |
| `sales.charge`           | `F1`          | Open payment, or submit the payment form when it already owns focus. |
| `sales.fastCash`         | `F2`          | Open/reset exact-cash payment.                                       |
| `sales.productSearch`    | `F5`          | Open product search.                                                 |
| `sales.focusProduct`     | `Alt+P`       | Focus product/barcode search.                                        |
| `sales.focusQuantity`    | `Alt+C`       | Focus the selected line quantity.                                    |
| `sales.focusDiscount`    | `Alt+D`       | Focus the selected line discount.                                    |
| `sales.focusUnit`        | `Alt+U`       | Focus the unit selector inside product search.                       |
| `sales.suspend`          | `Mod+P`       | Suspend an eligible cart.                                            |
| `sales.toggleSuspended`  | `Mod+R`       | Toggle suspended carts when the action is meaningful.                |
| `sales.reprint`          | `Mod+Shift+P` | Reprint the selected history row.                                    |
| `sales.removeItem`       | `Delete`      | Remove the selected cart line.                                       |
| `sales.undo`             | `Mod+Z`       | Undo the latest reversible cart mutation.                            |
| `sales.newSale`          | `Alt+N`       | Start a new sale.                                                    |
| `sales.openCashSession`  | `Alt+A`       | Open the register when no cash session is active.                    |
| `sales.cashMovement`     | `Alt+M`       | Open cash movement when a session is active.                         |
| `sales.closeCashSession` | `Alt+Shift+C` | Start blind cash close when a session is active.                     |

All sales/register shortcuts are limited to admin, manager and cashier roles.
State guards intentionally leave unavailable actions inert instead of opening
an unrelated fallback.

## Collision and scope policy

- Global actions do not fire while an editable field or another modal owns the
  keyboard. `Alt+/` may close its own sheet from the sheet.
- Sales handlers stay on `/sales`; modal-only `Alt+U` stays inside product
  search. Native text undo wins inside editable fields.
- Browser bindings are prevented only after Puntovivo accepts the action. For
  example, `Mod+R` remains browser reload when there is no suspended-cart action.
- The catalogue test rejects a duplicate key whenever the two definitions can
  be active for the same role. Route bindings must be unique and global.
- Navigation permissions match route guards before the listener runs. Redirects
  are defense in depth, not the shortcut authorization mechanism.
- Do not add a shortcut for a multi-step or ambiguous operation. First expose a
  single, permission-checked UI action with explicit preconditions.

## Accessibility contract

`ariaKeyshortcutsFor(id)` and `ariaKeyshortcutsForRoute(route)` format canonical
WAI-ARIA values (`Meta+P` on macOS, `Control+P` elsewhere). Route links and
controls with the exact corresponding action carry the attribute. Informational
or recovery controls do not claim a shortcut they cannot execute.

Current ARIA wiring includes desktop/mobile navigation, the command-palette
launcher, product search and unit selection, payment and fast cash, cart
quantity/discount/remove/undo, suspended carts, new sale and cash-session
open/movement/close controls.

Automated accessibility and live browser assertions protect this mapping, but
they do not replace a moderated keyboard study or a real Windows NVDA pass;
those remain external release evidence.

## Adding a shortcut

1. Add one definition to `SHORTCUTS`, including `route` and `roles` when it is
   navigation.
2. Add matching EN/ES labels under the `shortcuts` namespace.
3. Wire the listener in the narrowest owner and reuse the shared editable/modal
   guards.
4. Add `aria-keyshortcuts` only to controls that execute that exact action.
5. Extend catalogue, permission, collision and component tests.
6. Update this document and perform a live smoke of the affected surface.

## Validation

```sh
pnpm --filter @puntovivo/web exec vitest run \
  src/lib/__tests__/shortcuts.test.ts \
  src/components/feedback/GlobalShortcutsProvider.test.tsx \
  src/components/layout/__tests__/Sidebar.test.tsx

pnpm run ci:web
pnpm run test:e2e:web
```

The automated scope does not claim moderated usability or NVDA hardware
coverage.
