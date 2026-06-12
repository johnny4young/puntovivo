# Keyboard shortcut catalogue

> Status: shipped engine (canonical map + global Command Palette
> + aria-keyshortcuts hookup on `/sales`).
> Roadmap anchor: `ENG-105` (slice A).

This doc is the operator and reviewer-facing source of truth for
every keyboard shortcut the renderer exposes. The runtime catalogue
lives in `apps/web/src/lib/shortcuts.ts` — that file is the
machine-readable side; this doc is the human-readable side. Adding
a shortcut to one without the other is a review-time flag.

## What is enforced today

| Surface | Where |
| --- | --- |
| Canonical map of every shortcut id, keys, scope, label | `apps/web/src/lib/shortcuts.ts` (`SHORTCUTS` array) |
| Global Command Palette — opened by `Mod+K` | `apps/web/src/components/feedback/CommandPalette.tsx` + `CommandPaletteProvider.tsx` |
| Imperative shortcuts on the cashier cockpit | `apps/web/src/features/sales/useSalesKeyboardShortcuts.ts` |
| `aria-keyshortcuts` attribute on the real buttons in `/sales` | `apps/web/src/features/sales/SalesCheckoutPanel.tsx` (Charge / Suspend / Toggle Suspended) |

The map is declarative — `SHORTCUTS` lists every shortcut even when
the actual `keydown` handling lives in another file. That separation
keeps three concerns aligned without coupling them:

1. The Command Palette can show the hint on every action.
2. Real buttons in the DOM can stamp `aria-keyshortcuts` from the
   same source (closes the ENG-134 a11y remaining slice).
3. Reviewers can audit the full set with one grep.

## Current shortcuts

| Id | Keys | Scope | Action |
| --- | --- | --- | --- |
| `palette.open` | `Mod+K` | global | Open the Command Palette. |
| `sales.charge` | `F1` | sales | Open the payment modal for the active cart. |
| `sales.productSearch` | `F5` | sales | Open the product search dialog. |
| `sales.focusProduct` | `Alt+P` | sales | Focus the product / barcode input. |
| `sales.focusQuantity` | `Alt+C` | sales | Focus the quantity field of the selected row. |
| `sales.focusDiscount` | `Alt+D` | sales | Focus the discount field of the selected row. |
| `sales.focusUnit` | `Alt+U` | modal | Focus the unit selector inside ProductSearchDialog. |
| `sales.suspend` | `Mod+P` | sales | Park the active cart. |
| `sales.toggleSuspended` | `Mod+R` | sales | Toggle the suspended-carts panel. |
| `sales.reprint` | `Mod+Shift+P` | sales | Reprint the selected history row. |
| `sales.removeItem` | `Delete` | sales | Drop the selected line from the cart. |
| `sales.undo` | `Mod+Z` | sales | Undo the last cart mutation (ENG-105d). Disabled inside editable fields so native text undo keeps working. |
| `sales.fastCash` | `F2` | sales | Fast-cash rapid checkout (ENG-105e). Opens the payment modal with cash pre-selected, amount = exact total, and the Confirm button focused. Still active while the modal is already open — re-applies the exact amount on top of whatever was typed, even from the amount field. Suppressed inside editable fields outside the payment modal and during product search. |

`Mod` is the platform meta-modifier — `⌘` on macOS, `Ctrl` (or
`Meta`) on Windows / Linux. The matcher in `shortcuts.ts` accepts
both `Ctrl` and `Meta` on non-macOS so an external mac keyboard
plugged into a Linux workstation still fires.

## Command Palette behaviour

- **Open / close**: `Mod+K` toggles. `Esc` closes. The palette
  short-circuits when another modal already owns the screen, so
  payment/search/confirm focus traps are not stacked. The only
  modal-on-modal transition supported in V1 is closing the palette
  itself with a second `Mod+K`.
- **Navigation inside the palette**: `ArrowDown` / `ArrowUp` move
  the highlight. `Home` / `End` jump to the first / last item.
  `Enter` fires the highlighted action and closes the palette.
  Mouse hover sets the highlight; click fires the action.
- **Wrap-around** (ENG-105d): `ArrowDown` from the last item wraps
  back to the first, and `ArrowUp` from the first wraps to the
  last. `Home` / `End` keep their absolute-jump semantics. An empty
  filter is a no-op (no selection to move).
- **Filtering**: case-insensitive substring match against the
  translated label OR description.
- **Role + module gating**: the catalogue is filtered against the
  active `user.role` and the tenant module map before render. A
  cashier never sees `/audit-logs`, `/company`, `/users`, `/sites`,
  `/peripherals`, `/inventory`, `/purchases`, or any admin / manager
  surface; tenants with a disabled module also do not see that
  module's destination.
- **Shortcut hints**: when an action declares `shortcutId`, the
  palette renders the formatted keys on the right gutter. `⌘K` on
  macOS, `Ctrl+K` elsewhere.
- **Recent ordering** (ENG-105g): the palette records every action
  activation DEVICE-LOCALLY (`localStorage` key
  `palette_usage:<tenantId>`, helper `lib/paletteUsage.ts`; nothing
  travels to the server). When opened with an EMPTY query, a
  "Recent" section surfaces the top 5 used actions (count desc,
  tiebreak by recency) above the stable catalogue, without
  duplicating them below. An active query disables the section —
  text search keeps the predictable filter behaviour. The ranking
  runs AFTER the role/module gate, so an action a previous admin
  used on the same device never leaks into a cashier's section.
  Section headers are presentational (`aria-hidden`): the listbox
  stays a flat option list for assistive tech, and the wrap-around
  semantics from ENG-105d operate over the combined list. With no
  usage recorded the palette renders the exact pre-ENG-105g
  catalogue order.

## How to add a shortcut

1. Add the entry to `SHORTCUTS` in
   `apps/web/src/lib/shortcuts.ts` with an `id` that follows the
   existing dotted-namespace convention (`sales.X`, `palette.X`,
   `inventory.X`, ...).
2. Add the i18n key under `apps/web/src/i18n/locales/en/shortcuts.json`
   AND `es/shortcuts.json` — locale-parity gate blocks otherwise.
3. If the shortcut maps to an existing UI button, stamp
   `aria-keyshortcuts={ariaKeyshortcutsFor('<id>')}` on the button
   so screen readers announce the binding.
4. Wire the imperative handler in the most local owner (a feature-
   specific hook like `useSalesKeyboardShortcuts.ts`, or a global
   provider like `CommandPaletteProvider.tsx` for app-wide shortcuts).
   The catalogue is declarative; the catalogue does NOT own the
   event loop.
5. Update the table in this doc in the same PR.

## How to add a Command Palette action

1. Append a `CommandAction` entry to `COMMAND_ACTIONS` in
   `apps/web/src/lib/commandPaletteActions.ts`.
2. Add `actions.<group>.<id>` + `descriptions.<group>.<id>` keys
   to `palette.json` (en + es).
3. Set the `roles` tuple to match the route's `ShellRoute`
   `allowedRoles` (or the procedure's role guard for a command).
   This keeps the palette in sync with the router — never show a
   destination the router would redirect away from.
4. If the route is wrapped in `RequireModule`, set
   `requiredModule` to the same module id so the palette mirrors the
   sidebar and route gate.

## ARIA — aria-keyshortcuts contract

- The attribute value comes from `ariaKeyshortcutsFor('<id>')` —
  the helper rewrites `Mod` to the actual platform modifier:
  `Meta` on macOS and `Control` elsewhere.
- The buttons wired today (`/sales`):
  - **Charge** button — `F1`.
  - **Suspend** button — `Meta+P` on macOS, `Control+P` elsewhere.
  - **Toggle Suspended panel** button — `Meta+R` on macOS,
    `Control+R` elsewhere.
- Adding new wires follows the same pattern: import
  `ariaKeyshortcutsFor` from `@/lib/shortcuts` and pass the id of
  the matching catalogue entry.

## Browser shortcut conflicts

`Mod+K` collides with Chrome / Firefox's omnibox "search engine"
shortcut. The palette captures the event with `preventDefault()`,
so the omnibox does not steal focus. If a future shortcut competes
with a critical browser binding (e.g. `Mod+W` to close the tab),
the implementer must consult an operator before claiming it — the
operator's session is more sacred than a feature.

## Out-of-scope follow-ups

The ENG-105 cell lists 11 deliverables; slice A ships 1 (the
palette + map). The remaining 10 ride future slices `ENG-105b..`:

- Checkout preflight panel.
- Quick-create modals for product / customer / provider mid-flow.
- Fast-register / rapid cash F2 layout.
- Undo / recovery affordances for reversible actions.
- Customer attach pre-checkout (today only inside the payment
  modal).
- Payment drawer redesign.
- Focus rules tuned against barcode wedge input.
- Layout stability tweaks across desktop and tablet smoke targets.
- Most-used / recent-actions ordering in the palette (depends on
  ENG-135 observability sink).

## Running the contract locally

```
# Unit tests for the shortcut helpers
pnpm --filter @puntovivo/web run test -- --run \
  src/lib/__tests__/shortcuts.test.ts \
  src/components/feedback/__tests__/CommandPalette.test.tsx \
  src/components/feedback/__tests__/CommandPaletteProvider.test.tsx \
  src/features/sales/SalesCheckoutPanel.hubGate.test.tsx

# Full ci:web (typecheck + lint + coverage + build + bundle gate +
# contrast gate)
pnpm run ci:web
```

Live smoke evidence for each shortcut slice belongs in the review
handoff and in `docs/SPRINT-PLAN.md` when the slice ships; do not
link repo docs to per-machine agent plan files.
