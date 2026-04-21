# UI Surfaces — Desktop, Touch, KDS, Customer Display, Mobile

> Status: **Stub — design document, not yet implemented.**
> Phase 6c of the April 2026 plan.
> Created: April 21, 2026.

## Principle

One codebase (React 19 + Vite bundle) serves every UI surface as a
**different route**. Business logic lives behind the tRPC client and is
consumed identically by every surface. A single Electron binary can
open multiple `BrowserWindow`s (one per surface) on different physical
screens of the same PC.

No React Native, no separate Vite project, no duplicated domain code.
Styling adapts via media queries and CSS variables.

## Surfaces

### 1. POS Desktop (shipped)

- Route: `/sales` (default today)
- Device: PC + keyboard + mouse
- UI: dense `DataTable`, hover states, keyboard shortcuts, multi-column layouts
- Authentication: full user login + role gating

### 2. POS Touch (planned, Phase 6c)

- Route: `/pos/touch`
- Device: all-in-one touch monitor (Elo, HP RP9), Android tablet (in
  portrait kiosk mode)
- UI: tile grid of products grouped by category; tiles 150x150px with
  photo + name + price; >=44px touch targets; on-screen numeric keypad
  for quantity and price overrides; no hover states
- Detection: `navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)')`
  at boot → auto-redirect to `/pos/touch` unless overridden in settings
- Styling: reuse the same Tailwind theme with a `pointer: coarse` media
  query that bumps padding + text size globally
- No duplicated state: consumes the same `useCartWorkspace` Zustand store
  as the desktop POS

### 3. KDS — Kitchen Display (planned, Phase 6b)

- Route: `/kds?station=<stationId>`
- Device: TV 32-50" in the kitchen, running either inside the Electron
  app (local second window) or on a Raspberry Pi 4 Chromium kiosk
  pointing at `http://<host>:8090/kds?station=...`
- UI: three-column kanban (`queued | preparing | ready`); each ticket
  card shows mesa + waiter + items + modifiers + timer since `queued_at`
  (turns red past station SLA)
- Interaction: click/touch a card to advance; TV-only: USB remote →
  arrow keys + Enter navigation
- Authentication: **station token** (not user credentials) — an admin
  generates the token per station; the TV stores it in `localStorage`
  for unattended boot
- Scope: `kitchen:read + tickets:advance` — cannot see sales or
  customers

### 4. Customer-facing Display (planned, Phase 6c)

- Route: `/display/customer?terminal=<id>`
- Device: second monitor facing the customer
- UI: logo, live list of items in the current cart, big total, thank-you
  footer. Read-only.
- Mechanism (Electron): main process opens an additional `BrowserWindow`
  on `screen.getAllDisplays()[1]` full-screen, loading this route.
  The POS cart pushes updates via IPC `broadcastToDisplays` → the
  display window re-renders.
- Alternative (web-only deployment): SSE on `/api/realtime/cart/:terminal`

### 5. Mobile Waiter (planned, Phase 6c)

- Route: `/pos/mobile`
- Device: Android tablet 10" in portrait
- UI: vertical layout, category drawer, quick-fire buttons. Optimized
  for one-handed operation while the waiter stands next to the table.
- Distribution: same Vite bundle accessed over LAN via Chromium mobile
  browser (no native packaging in v1). For a wrapped experience
  (offline + home-screen icon), Capacitor can wrap the same bundle —
  post-MVP.

## Exposing the server to LAN

For KDS / mobile waiter, the Electron embedded Fastify must listen on
the LAN IP, not only 127.0.0.1. This is opt-in in settings ("Enable
LAN access for peripherals"):

- Opens port 8090 on `0.0.0.0` only when the feature is toggled
- Emits an audit log entry on activation
- Requires a station token or user cookie — no unauthenticated LAN access

## Performance targets

- Touch POS: initial render < 1.5s on Elo AIO (8th-gen i3, 4GB)
- KDS: render 50 tickets in < 300ms; SSE update latency end-to-end < 500ms
- Customer display: cart change → on-screen reflect < 200ms

## Bundle splitting

Each surface lazy-loads its feature tree via `React.lazy()` + Suspense,
so an Electron instance that only ever runs POS Desktop doesn't ship
KDS code to the renderer. Already the pattern in `apps/web/src/App.tsx`
for existing routes.

## Testing plan

- Touch mode: layout snapshots under `pointer: coarse` media query
- KDS: SSE round-trip test with simulated station token
- Customer display: cart-sync end-to-end over IPC
- Smoke: each surface renders sample fixture data in CI via Playwright
  (depends on ENG-001 landing)

## Out of scope (v1)

- Native React Native apps — Capacitor is the planned wrap
- Windowed KDS on tablet (only TV / PC kiosk in v1)
- Configurable KDS layouts (fixed 3-column kanban in v1)
- Menu board / digital signage TV — separate surface, Phase 15
