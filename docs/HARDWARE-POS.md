# POS Hardware

Puntovivo keeps hardware effects outside the sale transaction. A completed sale
is durable before printing, drawer, scanner, or terminal work is attempted.
Hardware failures are queued, observable, and recoverable.

## Current support boundary

| Device or transport         | Current state                                                                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| System printer              | Implemented through the Electron print boundary.                                                    |
| ESC/POS over TCP            | Implemented with target validation and failure reporting.                                           |
| Direct USB ESC/POS          | Not implemented; configuration must not claim support.                                              |
| Direct serial ESC/POS       | Not implemented; configuration must not claim support.                                              |
| RJ11 drawer through ESC/POS | Implemented where the selected printer transport supports the drawer pulse.                         |
| USB HID barcode scanner     | Implemented as keyboard-wedge input with cashier focus protection.                                  |
| Manual payment terminal     | Implemented as a recorded manual tender path.                                                       |
| Provider terminal SDK/API   | Adapter seam exists; no provider is production-qualified.                                           |
| Hub-client local bridge     | Implemented as a renderer-to-main IPC bridge that dispatches bytes locally without database access. |

## Architecture

- Device configuration and status are tenant and site scoped.
- The hardware outbox records retryable effects and terminal states.
- Renderer code never opens sockets or native devices directly.
- Electron preload exposes narrow invoke/handle APIs; main owns local transport.
- A hub-client bridge may print or open a drawer locally, but it cannot write
  sales, cash, inventory, fiscal, journal, or sync tables.
- Printer or drawer failure must not roll back a committed sale.
- Test and diagnostic actions must be auditable and role protected.

## Main implementation areas

- `packages/server/src/services/peripherals/` — contracts, registry, worker,
  transports, target policy, and drivers.
- `packages/server/src/db/schema/hardware.ts` — peripheral and hardware-outbox
  persistence.
- `apps/desktop/src/main/peripherals/` — local bridge and Electron transport.
- `apps/desktop/src/main/ipc/peripherals.ts` — IPC registration and validation.
- `apps/web/src/features/peripherals/` — administrative configuration and tests.

## Physical qualification gate

A device is supported only after a release candidate proves:

1. print, cut, drawer pulse, reconnect, timeout, and duplicate-job behavior;
2. cashier-speed scans, focus restoration, and duplicate-scan handling;
3. power loss and application restart with pending hardware work;
4. safe fallbacks that preserve the sale and tell the operator what failed;
5. model, firmware, operating system, connection type, and recovery steps in a
   maintained support matrix;
6. terminal cancellation, timeout, duplicate response, and offline-risk policy
   for every payment provider advertised as supported.

Follow the release-candidate checks in [TESTING.md](./TESTING.md). Remaining
hardware and payment gates are summarized in
[PROJECT-STATUS.md](./PROJECT-STATUS.md).
