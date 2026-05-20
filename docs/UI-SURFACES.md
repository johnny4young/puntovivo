# UI Surfaces — Desktop, Touch, KDS, Customer Display, Mobile

> Status: **Official Design Document**.
> Phase 6c of the master roadmap plan.
> Created: April 21, 2026.
> Last Updated: May 20, 2026.

## Principle

One codebase (React 19 + Vite bundle) serves every UI surface as a **different route**. Business logic lives behind the tRPC client and is consumed identically by every surface. A single Electron binary can open multiple `BrowserWindow`s (one per surface) on different physical screens of the same PC workstation.

No React Native, no separate Vite project, no duplicated domain code. Styling adapts via media queries and CSS variables.

The V3 information-architecture overlay lives in
[UI-REFRACTOR-V3.md](./UI-REFRACTOR-V3.md). Route-owned surfaces remain
valid, but daily navigation should expose role workspaces first and
surface-specific launchers second; adding another full-screen surface
must not automatically add another permanent sidebar entry.

---

## Surfaces

### 1. POS Desktop (Sales Cockpit Core)

-   **Route:** `/sales` (default today)
-   **Device:** PC + keyboard + mouse
-   **UI:** Dense `DataTable`, hover states, keyboard shortcuts, multi-column layouts, optimized for high-frequency cashiers (using `F2` to search, `Shift + E` for rapid cash checkouts, and `F8` for payment gateways).
-   **Efficiency requirements:** global command palette, checkout preflight, quick-create modals, fast-register mode, and reversible local actions as defined in [SALES-COCKPIT.md](./SALES-COCKPIT.md).
-   **Authentication:** Full user login + role gating.

---

### 2. POS Touch (Touch POS)

-   **Route:** `/touch`
-   **Device:** All-in-one touch monitor (Elo, HP RP9), Android/iOS tablet (in portrait kiosk mode).
-   **UI & Interaction Design:**
    *   **Dense Product Tile Grid:** Responsive fixed-aspect tiles with product image, name, price, stock state, and stable height. Styling follows the shared design system; avoid decorative glass effects or large radius values that reduce density.
    *   **Fat-finger Protection:** Minimum tactile hit targets of `44px` across all buttons and inputs.
    *   **Touch Numpad:** Tapping a quantity counter opens a docked or modal numeric keypad with rapid multipliers (`+1`, `+5`, `+10`, `-1`) and explicit confirm/cancel controls.
    *   **Surface Picker:** A compact toolbar lets operators switch between catalog, voice, tables, and waiter/KDS read-only view when the matching modules are active.
-   **Detection:** Evaluates `navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches` at boot to suggest auto-redirecting to `/touch`.
-   **State Management:** Consumes the same `useCartWorkspace` Zustand store as the desktop POS to prevent state duplication.

---

### 3. KDS — Kitchen Display System

-   **Route:** `/kds?station=<stationId>`
-   **Device:** TV 32-50" in the kitchen, running either inside the Electron app (local second window) or on a Raspberry Pi kiosk browser pointing at `http://<host>:8090/kds?station=...`
-   **UI & Kitchen Workflow:**
    *   **Station Columns:** CSS Grid layout mapped to physical preparation stations such as `Cocina`, `Barra`, and `Parrilla`, allowing isolated real-time ticket filtering.
    *   **High-contrast Comanda Cards:** Opaque cards with order number, table, waiter when available, elapsed timer, item list, and modifiers. Cards must be readable from a kitchen monitor without relying on blur or transparency.
    *   **Touch Interactions:** Primary action advances the card through the configured state machine; recovery actions remain visible but visually secondary.
    *   **SLA Time-based Alerts:**
        *   *0 to 5 minutes:* normal tone with readable timer.
        *   *5 to 10 minutes:* warning tone with alert icon and label.
        *   *More than 10 minutes:* critical tone with stronger border and label. Animation, if used, must be subtle and tested for readability.
    *   **Recall Button:** Persistent recovery action to reverse accidental state changes and restore the kitchen card.
-   **Authentication:** **Station Token** (stored in `localStorage` for unattended boots) generated from admin settings. No user credentials required on the line.
-   **Scope:** Restricted to `kitchen:read + tickets:advance`. Cannot access financial reports or customer databases.

---

### 4. Customer-facing Display

-   **Route:** `/display/customer?terminal=<id>`
-   **Device:** Second monitor facing the customer.
-   **UI:** Brand logo, dynamic line-item checkout list, grand total in large Outfit typography, and a promotional footer. Read-only.
-   **Mechanism (Electron):** Main process opens a second `BrowserWindow` on `screen.getAllDisplays()[1]` in full-screen. POS cart modifications trigger an IPC `broadcastToDisplays` event to update the customer view in milliseconds.
-   **Mechanism (Web-only):** Server-Sent Events (SSE) subscription over `/api/realtime/cart/:terminal`.

---

### 5. Mobile Waiter

-   **Route:** `/m`
-   **Device:** Android/iOS tablet 10" in portrait.
-   **UI:** Vertical one-handed layout with category sliders and rapid-fire add keys, optimized for tableside order intake.
-   **Distribution:** Serves the same Vite bundle over local LAN. No native apps needed for v1.

---

## Performance Targets

-   **Touch POS:** First layout paint < 1.5s on legacy Elo AIO terminals (Intel Celeron, 4GB RAM).
-   **KDS:** Renders up to 50 active comanda cards in < 300ms without layout lag.
-   **LAN Latency:** End-to-end latency from a waiter's table checkout to KDS ingestion < 500ms over local WiFi networks.
-   **Bundle Splitting:** Lazy-loads each surface route independently using React dynamic bundles (`React.lazy`), ensuring a desktop cashier checkout does not download KDS or Services assets.
