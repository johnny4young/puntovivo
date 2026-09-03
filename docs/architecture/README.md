# Architecture Decision Records

This directory contains durable decisions that constrain the implementation.
Use [`../ARCHITECTURE.md`](../ARCHITECTURE.md) for the current system overview
and these records for the reasoning behind boundaries that remain active.

## Lifecycle

- **Proposed**: open for review; not yet binding.
- **Accepted**: binding for new and changed code.
- **Superseded**: retained only for historical reasoning and linked to its replacement.
- **Rejected**: retained only when the rejected alternative is likely to recur.

New records use the next four-digit sequence and contain context, decision,
consequences, alternatives, and verification evidence. Implementation schedules,
estimates, and private work queues do not belong in ADRs.

## Decision index

| Record                                                                   | Decision                                   | Status   |
| ------------------------------------------------------------------------ | ------------------------------------------ | -------- |
| [ADR-0001](./0001-local-store-authority.md)                              | Local Store Authority                      | Accepted |
| [ADR-0002](./0002-command-envelope.md)                                   | Command envelope                           | Accepted |
| [ADR-0003](./0003-outbox-taxonomy.md)                                    | Outbox taxonomy                            | Accepted |
| [ADR-0004](./0004-conflict-policy.md)                                    | Conflict policy                            | Accepted |
| [ADR-0005](./0005-sync-payload-contract.md)                              | Sync payload contract                      | Accepted |
| [ADR-0006](./0006-local-data-security.md)                                | Local data security                        | Accepted |
| [ADR-0007](./0007-module-activation.md)                                  | Module activation                          | Accepted |
| [ADR-0008](./0008-authority-node-runtime-modes.md)                       | Authority Node runtime modes               | Accepted |
| [ADR-0009](./0009-money-storage-and-validation.md)                       | Money storage and validation               | Accepted |
| [ADR-0010](./0010-labor-overtime-policy.md)                              | Labor overtime policy                      | Accepted |
| [ADR-0011](./0011-product-search-vectors.md)                             | Product search vectors                     | Accepted |
| [ADR-0012](./0012-audit-chain-external-freshness.md)                     | Audit chain external freshness             | Accepted |
| [ADR-0013](./0013-quotation-conversion-and-supplier-payables.md)         | Quotation conversion and supplier payables | Accepted |
| [ADR-0014](./0014-normalized-sale-returns-and-store-credit.md)           | Normalized returns and store credit        | Accepted |
| [ADR-0015](./0015-retail-counts-and-replenishment.md)                    | Retail counts and replenishment            | Accepted |
| [ADR-0016](./0016-server-authoritative-promotions-and-customer-value.md) | Promotions and customer-value tenders      | Accepted |
| [ADR-0017](./0017-vertical-profiles-site-gs1.md)                         | Vertical profiles and site GS1 authority   | Accepted |
| [ADR-0018](./0018-lot-procurement-and-transformations.md)                | Lot procurement and transformations        | Accepted |
| [ADR-0019](./0019-pharmacy-policy-evidence-and-lot-custody.md)           | Pharmacy policy and regulated lot custody  | Accepted |
| [ADR-0020](./0020-restaurant-service-check-model.md)                     | Restaurant service and check model         | Accepted |
| [ADR-0021](./0021-durable-kitchen-preparation.md) | Durable kitchen preparation | Accepted |

## Reusable implementation patterns

Patterns document proven implementation shapes that support more than one
architecture decision. They are not chronological and do not contain planning
ownership metadata.

| Pattern                                              | Companion decisions          | Code                                              |
| ---------------------------------------------------- | ---------------------------- | ------------------------------------------------- |
| [Operation Journal](./patterns/operation-journal.md) | ADR-0001, ADR-0002, ADR-0003 | `packages/server/src/services/operation-journal/` |
| [Outbox Kernel](./patterns/outbox-kernel.md)         | ADR-0003                     | `packages/server/src/lib/outbox/`                 |

## Documentation boundary

Public architecture documents describe current constraints and stable reasoning.
Private planning, handoffs, prioritization, and estimates belong in an ignored
private planning artifact. Feature guides must link to code, tests, or an
ADR—not to internal ticket identifiers.
