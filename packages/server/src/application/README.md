# `application/` — use-case boundary

> Status: Active (introduced by ENG-054)
> Companion ADRs: [ADR-0001](../../../../docs/architecture/0001-local-store-authority.md), [ADR-0002](../../../../docs/architecture/0002-command-envelope.md)

The `application/` directory hosts the **stable use-case boundary** for
critical business operations. Each subfolder owns one bounded
context (`sales/`, `cash-sessions/`, `inventory/`, ...) and exposes a
narrow surface that the tRPC router, future workers, and tests can
all call without re-implementing the orchestration.

## Why this layer exists

Before ENG-054, the orchestration for sales lived inline inside the
tRPC router (`packages/server/src/trpc/routers/sales.ts`). The router
file grew past 2670 lines because each procedure inlined:

- input shaping (resolving items, payments, tenders)
- pre-checks (cash session open, customer valid, ownership)
- one big `db.transaction(...)` call writing 8+ tables
- post-commit hooks (fiscal emission, sync queue, audit logs)

That coupling meant invariant changes (a new payment method, a new
inventory rule) had to be edited in two-or-three places at once, and
unit tests had to be written against the tRPC caller (HTTP-shaped) for
operations that are pure orchestration.

The `application/` layer fixes this by hosting one async function per
use-case. The router becomes a thin wrapper that adapts tRPC input to
the use-case input and returns whatever the use-case returns.

## What goes in `application/` vs `services/`

| Location | What lives there | Examples |
| --- | --- | --- |
| `services/` | **Primitives** invoked by multiple use-cases | `audit-logs.ts`, `idempotency/`, `operation-journal/`, `cash-session.ts` (helpers), `fraction-policy.ts`, `inventory-balances.ts` |
| `application/` | **Use-cases** that orchestrate primitives behind a stable boundary | `sales/completeSale.ts`, future `sales/voidSale.ts`, `sales/returnSale.ts`, `cash-sessions/openSession.ts`, ... |

A use-case typically:

1. Validates input against the current DB state.
2. Opens one transaction that writes every row the operation touches.
3. After the commit, emits best-effort journal effects + post-commit
   side effects (fiscal, hardware, future outboxes).

A primitive typically:

1. Accepts a `tx` or `db` handle plus tenant scope.
2. Writes one or two related rows.
3. Throws or returns a typed result; never owns its own transaction.

## File layout per use-case

```
application/<feature>/
├── index.ts              # barrel re-export of the public surface
├── types.ts              # input + output + context types
├── policies.ts           # pure functions (no DB access)
├── <useCase>.ts          # orchestration entry point
└── journal-effects.ts    # best-effort journal effect emission
```

`policies.ts` and `journal-effects.ts` are optional — tiny use-cases
can keep everything in one file. The convention is to extract them
when the use-case file grows past ~500 lines or when policies are
reused by multiple use-cases in the same feature.

## Test convention

Use-case tests live alongside other server tests in
`packages/server/src/__tests__/application-<feature>-<useCase>.test.ts`.
They invoke the use-case function directly with a `Context`-shaped
object built in-test, **without** booting Fastify or going through
tRPC. The HTTP-shaped tests (`<feature>.test.ts`) stay as they are —
they exercise the wiring (auth, role guards, input parsing, error
codes) but no longer carry the orchestration coverage.

## Related tickets

- ENG-054 created this layer with `sales/completeSale`.
- ENG-055 will add `sales/voidSale`, `sales/returnSale`,
  `sales/discardDraft` and shared sale lifecycle policies.
- ENG-056 will introduce `cash-sessions/` for the cash session
  aggregate boundary.
