# Puntovivo Sellability Index

> Status: **ENG-050 shipped** — single go/no-go view for selling
> Puntovivo to a Colombian retail pilot.
> Updated: 2026-06-01.

This document answers one question:

**Can Puntovivo be sold to a Colombian retail store today?**

Current answer: **not yet**. The product has a strong POS foundation,
but Colombian retail sellability is still blocked by real fiscal
provider integration, fiscal contingency, and physical POS hardware.

## Current Verdict

| Stage | Verdict | Meaning |
| --- | --- | --- |
| Development demo | **Yes** | Demo tenant, sales, inventory, cash sessions, quotations, fiscal mock, AI, sync center, and receipt templates can be shown. |
| Private retail pilot | **Not yet** | Needs at least fiscal contingency, hardware scanner/printer path, and clear operator recovery before a real store runs daily sales. |
| Production sale | **No** | Requires DIAN-authorized Proveedor Tecnologico, legal XML retention, hardware validation, and payment-terminal policy. |

## Pilot-Ready Criteria

A Colombian retail pilot is allowed only when all items below are true:

| Area | Required condition | Current state | Next ticket |
| --- | --- | --- | --- |
| Sales and cash | Complete, return, void, split tender, cash sessions, suspended carts, and receipt reprint work end to end. | **Ready** | Keep covered by regression tests. |
| Inventory | Site-owned stock, movements, transfers, and discrepancy reporting work. | **Ready** | Keep covered by regression tests. |
| Fiscal core | Fiscal document model, immutable snapshots, adapter seam, and reports exist. | **Ready as foundation** | `ENG-057`, `ENG-058`, `ENG-059`. |
| Fiscal contingency | Offline fiscal documents are queued, retried, visible, and recoverable. | **Not ready** | `ENG-057`. |
| Receipt fiscal proof | Receipt can show CUFE/CUDE or provider UUID, QR, XML reference, and pending/contingency status. | **Partial** | `ENG-058`. |
| Hardware scanner | USB HID barcode scanner adds products quickly and safely. | **Not ready** | `ENG-061`. |
| Hardware printing | ESC/POS printer and RJ11 drawer work, with system-printer fallback. | **Not ready** | `ENG-060`, `ENG-062`. |
| Payment terminal | Manual payment works; provider terminal has clear adapter and failure policy. | **Partial** | `ENG-063` when sandbox and hardware are available. |
| Recovery | Operator can see sync/fiscal/cash/payment/device health and export diagnostics. | **Partial** | `ENG-065`, `ENG-067`. |
| Multi-register LAN | One store can run several cashier terminals against a single local Authority Node. | **Ready as foundation** — `device_local`, `site_hub`, and `hub_client` modes exist; satellite offline writes remain deferred. | Keep covered by regression tests; revisit `ENG-076` only if a pilot proves the need. |

## Production-Ready Criteria

Production sales require everything in Pilot-ready plus:

- DIAN-authorized provider integration accepted in sandbox and production.
- Digital certificate and numbering resolution configured per tenant/site.
- XML storage and retention policy for at least five years.
- Fiscal retry daemon with dead-letter handling and operator-visible errors.
- Tested ESC/POS printer, cash drawer, and scanner on the hardware lab.
- Payment terminal integration with explicit offline-risk limits.
- Backup/restore runbook that preserves sales, fiscal documents, outboxes,
  device identity, and audit history.
- Local data security decision implemented and documented.
- Chaos/resilience suite covering restart, retries, provider outage, and
  large pending queues.

## Blockers

| Blocker | Owner lane | Gate | Next ticket |
| --- | --- | --- | --- |
| Real DIAN provider | Fiscal | Signed PT contract, sandbox/prod credentials, certificate, resolution, error-code map. | `ENG-059` |
| Fiscal contingency | Server + Fiscal | No external gate for mock/provider-agnostic retry engine. | `ENG-057` |
| Fiscal receipt finalization | Server + Desktop/Web | No external gate for mock/provider-agnostic proof rendering. | `ENG-058` |
| Hardware lab | Desktop + Hardware | Thermal printer, RJ11 drawer, USB HID scanner. | `ENG-060`, `ENG-061`, `ENG-062` |
| Payment terminal | Payments | Provider choice, sandbox credentials, physical terminal. | `ENG-063` |
| Store diagnostics | Operations | No external gate. | Keep extending Operations and recovery surfaces through active readiness tickets. |
| Local security | Desktop + Security | SQLCipher groundwork shipped; cleartext-to-encrypted migration UX and cross-device restore key prompts remain. | `ENG-167b` |
| Multi-register Store Hub | Runtime | Initial LAN hub/client support shipped; satellite offline fallback is deferred until a pilot proves it. | `ENG-076` if the gate clears |

## Operational Store Checklist

Before a pilot day starts, the operator should be able to confirm:

- Tenant, company, locale, tax, site, sequential, and active cash session
  are configured.
- Device is registered and assigned to the correct site.
- Scanner test finds a seeded product by barcode.
- Printer test prints, cuts, and opens the drawer or clearly falls back to
  system printing.
- Fiscal readiness is green or explicitly in contingency mode.
- Sync queue has no stale conflicts.
- Backup location and restore procedure are known.
- Authority mode is known: `device_local` for one register, or
  `site_hub` with paired `hub_client` terminals for multi-register
  stores.
- Cashier can complete one sale, suspend one sale, resume it, return it,
  void it with manager/admin permission, and reprint the receipt.

## Roadmap Link

This go/no-go checklist is anchored to
[ROADMAP.md §0](./ROADMAP.md#0-mvp-colombia--definition-of-done) — the MVP Colombia
definition of done, whose stage verdict mirrors the Current Verdict table above — and
to [PLAN-V3.md](./PLAN-V3.md) for commercial-readiness work beyond the sellable core.

Sellability work is tracked in `ROADMAP.md` as:

- `ENG-050`: this index and roadmap truth sync.
- `ENG-051..ENG-056`: foundation reset around commands, device identity,
  operation journal, sale lifecycle, and cash sessions.
- `ENG-057..ENG-059`: fiscal readiness.
- `ENG-060..ENG-063`: hardware and payment readiness.
- `ENG-064..ENG-067`: sync, recovery, operations, backup, and chaos tests.
- `ENG-068..ENG-070`: expansion architecture after the retail core is
  safe enough.
- `ENG-071..ENG-075`: shipped Authority Node / Store Hub Mode for
  multi-register stores; `ENG-076` remains deferred until a pilot proves
  hub clients need satellite offline writes.
- `ENG-182..ENG-186`: active product-truth and retail-focus reset before
  more visible vertical/platform scope.
