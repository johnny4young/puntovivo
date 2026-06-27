# Restaurant Lifecycle — Tables + Preparation + KDS

> Status: **Stub — design document, not yet implemented.**
> Phase 6b of the April 2026 plan. Depends on [PRODUCT-COMPOSITION.md](./PRODUCT-COMPOSITION.md) and [HARDWARE-POS.md](./HARDWARE-POS.md).
> Created: April 21, 2026.

## Goal

A restaurant flow that the current POS does not support: a customer
sits at a table, orders items over the course of a meal, the kitchen
and bar receive tickets, the waiter delivers plates as they become
ready, and the bill is closed when the customer asks for it — possibly
split across multiple payers.

## New concepts

### Preparation station

Where a ticket is prepared: hot kitchen, cold kitchen, bar, bakery.
Each can route to its own ESC/POS printer or to a KDS only.

### Table and table session

A `table` is a physical seat (or seating unit). A `table_session` is a
logical meal — opened when a customer sits, closed when they pay and
leave. A session can accumulate multiple sales if the bill is split.

### Preparation ticket

When items are "fired" to the kitchen, they become one `preparation_ticket`
per station (items grouped by `preparation_station_id`). The ticket
moves `queued → preparing → ready → served`.

## Schema additions

```sql
CREATE TABLE preparation_stations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL REFERENCES sites(id),
  name TEXT NOT NULL,
  printer_target TEXT,                -- peripheral id or NULL for KDS-only
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE tables (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  site_id TEXT NOT NULL REFERENCES sites(id),
  label TEXT NOT NULL,                -- "Mesa 12", "Barra 3"
  zone TEXT,
  seats INTEGER NOT NULL DEFAULT 4,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, site_id, label)
);

CREATE TABLE table_sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  table_id TEXT NOT NULL REFERENCES tables(id),
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  opened_by TEXT NOT NULL REFERENCES users(id),
  covers INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'voided'))
);

ALTER TABLE sales ADD COLUMN table_session_id TEXT REFERENCES table_sessions(id);

CREATE TABLE preparation_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  sale_id TEXT NOT NULL REFERENCES sales(id),
  station_id TEXT NOT NULL REFERENCES preparation_stations(id),
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'preparing', 'ready', 'served', 'voided')),
  queued_at TEXT NOT NULL,
  preparing_at TEXT,
  ready_at TEXT,
  served_at TEXT,
  priority INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE preparation_ticket_items (
  ticket_id TEXT NOT NULL REFERENCES preparation_tickets(id) ON DELETE CASCADE,
  sale_item_id TEXT NOT NULL REFERENCES sale_items(id),
  PRIMARY KEY (ticket_id, sale_item_id)
);

ALTER TABLE products ADD COLUMN requires_preparation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN preparation_station_id TEXT REFERENCES preparation_stations(id);
```

## Lifecycle walkthrough

1. Waiter opens `table_session` for a table with N covers.
2. Waiter adds items. The associated sale stays `draft` with
   `table_session_id` set.
3. Waiter fires the order. Items with `requires_preparation=true` are
   grouped by `preparation_station_id` and one `preparation_ticket` is
   created per station in status `queued`. Non-preparation items (bottled
   drinks) skip ticketing and are considered served immediately.
4. The KDS for each station shows `queued` tickets; cook advances
   `queued → preparing → ready`. An SSE message notifies the waiter POS.
5. Waiter sees "ready" tray, delivers to table, marks `served`.
6. Further rounds of fire add more items to the same session.
7. Customer asks for the bill; waiter prints pre-check. Payment can
   split one sale into multiple completed sales.
8. When all sales are completed and no ticket is still `queued |
   preparing`, the session closes.

## Invariants

- `table_session` cannot close if any `preparation_ticket` is still
  `queued` or `preparing` (alert: "platos en cocina").
- A `sale_item` whose ticket is `ready` or `served` cannot be voided
  without elevated permission + audit reason.
- Splitting a session produces N completed sales whose totals sum to
  the original; Σ still reconciles.

## Kitchen printing

`preparation_station.printer_target` points to a `site_peripherals` row.
When a ticket moves to `queued`, the service auto-prints an ESC/POS
ticket on that station's printer — compact format: time, table, waiter,
items with modifiers, timer start.

If the printer fails, the KDS remains authoritative. Printing is a
best-effort notification layer.

## KDS (Kitchen Display System)

See [UI-SURFACES.md](./UI-SURFACES.md) §KDS for the client-side details.
The server exposes:

- `trpc.kitchen.listQueued({ stationId })` — initial snapshot
- `SSE /api/realtime/kds/:stationId` — push on each ticket state change
- `trpc.kitchen.advance({ ticketId, toStatus })` — gated by station token

## Services (planned)

```
packages/server/src/services/restaurant/
  tables.ts          # openSession, closeSession, transferTable, mergeTables
  preparation.ts     # fireTicket, advanceTicket, voidTicket
  split-check.ts     # split session into N completed sales
```

Wire-up:

- `sales.complete` enforces "no open tickets" before letting the last
  sale of a session go `completed`
- `sales.void` cascades to `preparation_tickets.status = voided`

## Testing plan

- Fire groups items by station correctly
- Cannot close session with queued/preparing tickets
- Splitting session preserves totals and tender integrity
- Void-after-ready requires elevated role + audit entry
- SSE delivers state changes within 500ms in CI

## Out of scope (v1)

- Course firing sequencing ("appetizers now, mains in 10 min")
- Floor plan drag-and-drop editor (admin sets tables as rows first)
- Delivery integrations (Rappi, Didi Food — separate module)
- Auto-86'ing ingredients to hide menu items at runtime — arrives for
  free once product composition (6a) ships
