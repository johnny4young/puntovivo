# Puntovivo Project Status

> Updated: 2026-07-19. This is the public source of truth for shipped
> capabilities and release readiness. Internal prioritization, estimates, and
> execution notes stay outside version control under `docs/planning/`.

## Product position

Puntovivo is a local-first POS for Latin American retail. Its first production
wedge remains Colombian stores with one to ten sites. The application has a
strong, demonstrable retail core, but production sale is still gated by fiscal
certification and physical-hardware validation.

## Shipped capability baseline

The current `main` branch includes:

- barcode-first sales, suspended carts, split tenders, refunds, voids, receipt
  reprints, credit sales, loyalty points, and manager approval controls;
- cash-session accountability, blind close, audited movements, day-close
  evidence, anomaly signals, and immutable manager sign-off;
- site-owned inventory, units, lots, FEFO, expiry suggestions, serialized
  products, warranty lookup, variant matrices, purchases, returns, and exact
  inter-site transfers;
- customers, suppliers, quotations, catalog administration, launch imports,
  privacy export/anonymization, and data-retention controls;
- employee PIN switching, shifts, attendance corrections, breaks, overtime
  classification, and payroll/accounting evidence exports;
- encrypted desktop storage, encrypted backup bundles, scheduled snapshots,
  restore drills, S3-compatible cloud vault upload, and backup-protection
  attestation;
- tenant and site isolation, audit logs, role guards, device registration,
  local Authority Node modes, a durable sync kernel, and operational health
  surfaces;
- Colombia fiscal foundations plus draft Mexico and Chile document packs. No
  pack is certified for production transmission yet;
- Electron and browser targets sharing the same React, Fastify, tRPC, and
  SQLite application core.

## Readiness verdict

| Stage                          | Verdict                       | Evidence and remaining gate                                                                                                                                                   |
| ------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development demo               | **Ready**                     | Core retail journeys, administrative surfaces, recovery controls, and representative vertical modules are demonstrable with automated coverage.                               |
| Controlled internal beta       | **Ready with release checks** | Requires a clean release candidate, upgrade/restore rehearsal, and platform packaging validation.                                                                             |
| Private Colombian retail pilot | **Not ready**                 | Requires a real fiscal provider path, contingency operation, signed fiscal receipt proof, and validation against the selected printer, drawer, scanner, and payment terminal. |
| Production sale                | **Not ready**                 | Requires fiscal certification, legal retention evidence, signed installers, hardware support policy, incident runbooks, and an observed pilot.                                |

## Remaining product gaps

### Release and operations

- Validate packaged desktop artifacts on every supported operating system.
- Complete code signing, notarization, update-rollout, rollback, and clean
  upgrade rehearsals using production-equivalent credentials.
- Prove encrypted backup recovery on a separate device and document recovery
  time and recovery point expectations.
- Add operator runbooks for fiscal outage, failed update, lost device,
  corrupted local storage, and cloud-vault failure.

### Fiscal and payments

- Integrate and certify a Colombian technology provider using sandbox and
  production credentials.
- Complete contingency issuance, retry/dead-letter handling, signed XML
  retention, QR/identifier proof, and operator-visible recovery.
- Validate the payment-terminal adapter and offline-risk policy with a chosen
  provider and physical terminal.
- Treat Mexico and Chile packs as draft-only until signing, transmission,
  cancellation, certification, and authority-specific conformance pass.

### Hardware and store topology

- Certify representative ESC/POS printers, RJ11 drawers, USB HID scanners, and
  the supported network printing path in a physical lab.
- Implement or explicitly exclude direct USB and serial ESC/POS transports;
  today the safe production path is system or TCP printing.
- Resolve renewable hub-client sessions over a secure LAN origin. Current
  cross-origin cookie policy requires re-login after the access token expires.
- Observe multi-register Authority Node operation in a real store before
  promising satellite offline writes or remote multi-node replication.

### Business completeness

- Model commissions and waste when a pilot requires them; day-close currently
  reports both capabilities as unavailable instead of inventing zero values.
- Add contract, wage, holiday, collective-agreement, and payroll-provider data
  before treating attendance classifications as payroll-final money.
- Complete a Windows NVDA accessibility sweep and keep real-device cashier
  ergonomics in the release checklist.
- Add production dashboards and alert ownership for telemetry already emitted
  by the application.

## Release policy

A release may package functionality that is complete and truthfully labelled
without implying that the product is production-certified. A release does not
change the pilot or production verdict above unless every corresponding gate
has fresh evidence.

For the merged staff, inventory, backup, privacy, and import feature set, a
minor release is appropriate after the release candidate passes:

1. web, server, and desktop CI gates;
2. browser and Electron end-to-end suites;
3. database upgrade plus downgrade-refusal validation;
4. encrypted backup, restore drill, and separate-device recovery check;
5. manual Linux, macOS, and Windows package validation;
6. release notes that preserve the fiscal and hardware limitations above.

## Documentation ownership

- This file owns product status, shipped scope, and externally meaningful
  gaps.
- `ARCHITECTURE.md` and the ADRs own system invariants and design decisions.
- `TESTING.md` owns validation commands and coverage boundaries.
- Feature guides describe current behavior only; they must not contain planning
  state, ticket identifiers, or future-work queues.
- Detailed strategy and execution planning belongs in the ignored
  `docs/planning/` directory.
