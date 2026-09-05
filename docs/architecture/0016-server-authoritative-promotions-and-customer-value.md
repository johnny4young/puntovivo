# 0016 — Server-authoritative promotions and customer-value tenders

> Status: Accepted
> Date: 2026-09-01

## Context

A promotion changes the money due for a sale. Resolving product, category,
site, customer, quantity, time, and lot rules in the renderer would let stale or
modified client state choose the price. Applying a newly active rule to an
older client without a preview would be equally unsafe because the operator
could confirm a total that the screen never presented.

Loyalty points and store credit are money-like customer liabilities. A mutable
balance alone cannot prove which sale consumed value, which return restored it,
or whether two registers spent the final balance concurrently. Return and void
semantics also have to distinguish redeemed value from points earned by the
same ticket.

## Decision

### Authoritative promotion quote

- Promotion lifecycle is explicit and versioned: draft, active, paused, and
  archived. A draft never changes checkout pricing merely by existing.
- Modern clients request a server quote after the server validates and resolves
  the submitted cart pricing inputs. They submit its fingerprint plus quoted
  total with the sale command. Inside the write boundary, completion
  re-evaluates the mutable promotion rules, scope, time window, and lot
  eligibility and rejects stale evidence. Legacy clients that do not send a
  fingerprint retain their previous unpromoted behavior.
- Nullable product/category, site, customer, time-window, and minimum-quantity
  targets combine with AND semantics. Product and category are mutually
  exclusive. Priority descends first, specificity breaks ties, and an exclusive
  rule stops further combination.
- Manual discount applies first and remains the manager-approval input.
  Promotions apply sequentially to the remaining line value. The existing
  effective discount stays readable for returns and legacy clients, while the
  manual rate and every promotion application are frozen separately.
- Accepted quotations bypass dynamic promotion pricing because their terms are
  already immutable. Suspended drafts use their own persisted-line quote and
  still require a matching fingerprint at completion.
- Expiry suggestions remain informational until a manager converts one. The
  resulting promotion is bound to its source lot and applies only when FEFO can
  satisfy the whole line from that active, unexpired lot. Pharmacy rejects this
  conversion instead of treating a regulated expiry as a marketing rule.

### Customer-value tender kernel

- `loyalty` and `store_credit` are first-class sale-payment methods. Store
  credit uses the tenant/customer/currency account. Loyalty redemption requires
  explicit tenant enablement and a positive configured value per whole point;
  no active conversion rate is invented.
- The server derives monetary value and rechecks the available balance. Sale,
  payment, customer-value movement, materialized balance, sync intent,
  idempotency result, and audit evidence share one `BEGIN IMMEDIATE`
  transaction, so concurrent final-balance attempts have one winner.
- A return allocates each original tender cumulatively and restores loyalty or
  store credit to the exact source movement regardless of the chosen
  destination for external payments. It also removes the returned portion of
  points earned by the sale. A void restores redeemed value and reverses earned
  points exactly once.
- Legitimate return-driven loyalty debt is retained as evidence when a customer
  already spent later points. New redemptions and negative adjustments cannot
  deepen that balance; future earning amortizes it.
- Points are earned from the settled sale amount excluding value paid with
  points. Store credit remains part of the earning base because it is prior
  customer value being spent, not a second loyalty redemption.

### Persistence, replication, and presentation

- Applied promotions live in normalized immutable sale-line snapshots. The
  compatibility discount on the line remains a summary, not the source of
  promotion identity.
- Promotion rules and snapshots use manual-conflict sync policy. A divergent
  live price must never be resolved through catalog-style last-write-wins.
  Customer-value accounts and movements emit their own deterministic sync
  intent in the sale/return/void transaction.
- Sale history, receipts, privacy export, accounting export, and day close
  consume frozen payment and promotion evidence. Loyalty and store credit map
  to configured liability accounts rather than cash or an external processor.
- Cashier balance reads expose only the bounded redemption projection needed at
  checkout. Promotion lifecycle and expiry conversion remain manager/admin
  operations and every query stays tenant/site scoped.

## Consequences

- A checkout cannot silently accept a promotion that changed after preview;
  the operator must refresh the quote.
- A completed sale retains both operator-entered discount intent and the exact
  rule/version that reduced each line.
- Customer-value sale, return, and void effects are traceable and replay-safe,
  while provider-side card refunds remain external evidence rather than a
  claimed transfer.
- Percentage rules are the current explicit promotion vocabulary. This
  decision does not imply coupons, buy-X-get-Y, vendor-funded settlement, or
  regulated pharmacy discount policy.
- Local sync intent and manual-conflict classification do not by themselves
  prove causal multi-device apply or remote convergence.

## Alternatives rejected

- **Calculate promotions in React:** trusts mutable client data and can diverge
  from tax, lot, return, and receipt evidence.
- **Silently apply server promotions at completion:** changes the amount after
  the operator reviewed it and breaks older clients.
- **Reuse the manual discount field:** loses rule identity and incorrectly
  mixes owner-authored pricing with loss-prevention approval thresholds.
- **Treat points or store credit as `other`:** hides customer liabilities from
  returns, accounting, receipts, and concurrency control.
- **Clamp a return-driven loyalty balance to zero:** mints value and destroys
  ledger parity; rejecting the legitimate return would instead block the store
  operation.

## Verification evidence

- `packages/server/src/__tests__/promotions.test.ts` pins lifecycle, targeting,
  ordering, fingerprints, compatibility, lot and pharmacy boundaries, frozen
  snapshots, tenant isolation, and concurrency.
- `packages/server/src/__tests__/customer-value-tenders.test.ts` pins mixed
  tenders, final-balance races, draft completion, partial/final returns, void,
  replay, ledger parity, privacy, accounting, and sync evidence.
- `e2e/web/retail-promotions-loyalty.spec.ts` drives manager configuration and
  activation, a points + store-credit + card checkout, SQLite evidence, EN/ES
  reload, full return, external reference, and restored opening balances.
