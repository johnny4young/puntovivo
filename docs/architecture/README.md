# Architecture Decision Records (ADRs)

This directory holds the Puntovivo Architecture Decision Records — short
documents that capture **the architectural decisions that gate work
across multiple tickets**, the alternatives considered, and the impact
on future implementation.

ADRs differ from the strategic prose in `docs/PLAN.md` and the
ticket index in `docs/ROADMAP.md`:

- `PLAN.md` is broad market and architecture analysis (what, why, when).
- `ROADMAP.md §3b` is the live ticket queue (`ENG-NNN` rows).
- ADRs lock **how** we will build something, the constraints we accept,
  and the trade-offs we explicitly reject.

When in doubt about which file wins, see
[`docs/README.md §4 — Authority resolution`](../README.md). ADRs sit at
the "Specialty docs" tier under `AGENTS.md` / `ROADMAP.md` /
`SPRINT-PLAN.md` / `PLAN-V2.md` / `PLAN.md`.

---

## When to write an ADR

Open a new ADR only when **all** of the following are true:

1. The decision spans more than one ticket (it gates two or more
   `ENG-NNN` rows in `ROADMAP.md §3b`).
2. The decision constrains future code — a later ticket cannot
   silently violate it without a Superseder ADR.
3. The decision has at least one rejected alternative worth recording
   so a future contributor does not re-litigate it.

Skip an ADR for:

- Single-ticket implementation choices (capture them in the ticket's
  scope cell or commit body instead).
- Stylistic / formatting decisions (those live in lint configuration).
- Tactical fixes that do not constrain anything beyond the immediate
  diff.

---

## Numbering and naming

Files are named `NNNN-kebab-case-title.md` with a four-digit prefix:

```
0001-local-store-authority.md
0002-command-envelope.md
0003-outbox-taxonomy.md
0004-conflict-policy.md
0005-sync-payload-contract.md
```

The number is **chronological and immutable**. Once an ADR ships, never
renumber it — references in commit messages, ROADMAP cells, and code
comments rely on the stable id (e.g. `(see ADR-0003)`).

Cross-references inside ADRs use `ADR-NNNN` in prose and a relative
markdown link (`[ADR-0003](./0003-outbox-taxonomy.md)`) where useful.

---

## States

Every ADR carries a `Status` line in its frontmatter:

| Status | Meaning |
| --- | --- |
| `Proposed` | Draft under discussion. Not binding on implementation. |
| `Accepted` | Locked in. Implementation tickets must respect the decision. |
| `Superseded by NNNN` | Replaced by a newer ADR. The text is preserved (do not delete) but new work follows the superseder. |
| `Deprecated` | Explicitly retired without a successor (rare — usually only when a whole subsystem is removed). |

ADRs **must** ship with `Status: Accepted`. Do not commit ADRs as
`Proposed` — discussion happens in tickets and reviews, not as a
floating draft in the repo.

---

## Required sections

Every ADR must contain these four sections in this order:

1. **Decision** — the call we are locking. Single sentence that names
   the rule, plus a short paragraph that grounds it in current code or
   the problem it solves. Include any data shapes, naming conventions,
   or feature flags the decision introduces.
2. **Alternatives Rejected** — bullet list of options we considered
   and turned down, each with a one-line reason. Future contributors
   should not have to re-argue any of these.
3. **Implementation Impact** — concrete consequences: tables to add,
   modules to create, contracts to extend, files to touch. References
   to existing primitives (paths under `packages/server/src/...`,
   `apps/desktop/src/main/...`, etc.) make the impact verifiable.
4. **Affected Tickets** — the `ENG-NNN` rows that depend on this
   decision. The list is the **current** state at ADR write-time;
   it can grow over time via an `Updated:` marker at the bottom of
   the section. Do not delete tickets from the list — let them age
   into Shipped state instead.

ADRs may add `Notes`, `Open Questions`, or `Examples` sections after
the four required ones, but never before.

---

## Template

When you write a new ADR, start from this skeleton:

```markdown
# NNNN — Short Title

> Status: Accepted
> Date: YYYY-MM-DD
> Owner: <ticket id that opened the ADR, e.g. ENG-051>

## Decision

<One-sentence rule.>

<Two or three paragraphs that ground the rule in current code or
the problem it solves. Name the data shapes, naming conventions, and
feature flags introduced.>

## Alternatives Rejected

- **<option>** — <one-line reason it was rejected>.
- **<option>** — <one-line reason it was rejected>.

## Implementation Impact

- <Table / module / contract / file change.>
- <Reference to existing primitive at `path/to/file.ts`.>

## Affected Tickets

- `ENG-NNN` — <one-line link to the row in ROADMAP §3b>.
- `ENG-NNN` — <one-line link>.

Updated: <list grows by appending here, never removing>.
```

---

## Active ADRs

| ID | Title | Status | Owner ticket |
| --- | --- | --- | --- |
| [ADR-0001](./0001-local-store-authority.md) | Local Store Authority | Accepted | ENG-051 |
| [ADR-0002](./0002-command-envelope.md) | Command Envelope | Accepted | ENG-051 |
| [ADR-0003](./0003-outbox-taxonomy.md) | Outbox Taxonomy | Accepted | ENG-051 |
| [ADR-0004](./0004-conflict-policy.md) | Conflict Policy | Accepted | ENG-051 |
| [ADR-0005](./0005-sync-payload-contract.md) | Sync Payload Contract v1 | Accepted | ENG-064 |

When you ship an ADR, append a row here in the same commit. When an ADR
is superseded, update the row's Status column to
`Superseded by NNNN` and link to the successor.

---

## Patterns

ADRs lock **what** we decided. The `patterns/` subdirectory documents
**how** to use the building blocks those decisions introduced. Patterns
are descriptive references for engineers who will compose the kernel
or service primitives in future tickets — they include code examples,
lifecycle diagrams, and a list of related tickets.

When to write a pattern doc:

- A subsystem (kernel, service module, or runtime contract) ships a
  reusable primitive that more than one future ticket will compose.
- The composition rules go beyond the brief decision text the parent
  ADR captures — there's enough nuance ("when to use it", "code
  examples", "common pitfalls") to deserve a dedicated page.

Convention: patterns live at `architecture/patterns/<kebab-name>.md`
(no numeric prefix; patterns are not chronological the way ADRs are).
The frontmatter cross-links the companion ADR(s) so readers can hop
between the decision and the implementation guide.

| Pattern | Owner ticket | Companion ADR(s) | Code |
| --- | --- | --- | --- |
| [Operation Journal](./patterns/operation-journal.md) | ENG-053 | [ADR-0001](./0001-local-store-authority.md), [ADR-0002](./0002-command-envelope.md), [ADR-0003](./0003-outbox-taxonomy.md) | `packages/server/src/services/operation-journal/` |
| [Outbox Kernel](./patterns/outbox-kernel.md) | ENG-053 | [ADR-0003](./0003-outbox-taxonomy.md) | `packages/server/src/lib/outbox/` |

---

## Language

ADRs are written in **English**, following the same convention as the
top-level `PLAN.md`, `ARCHITECTURE.md`, `STACK-EVOLUTION.md`, and
`SELLABILITY.md`.

Sections that describe rules over `services/fiscal/**` (or any prose
about Colombian / Mexican / Chilean fiscal pipelines) follow the
**Spanish convention** documented in `AGENTS.md` (neutral LATAM `tú`,
no voseo). When an ADR mixes general architecture and fiscal-specific
rules, the general sections stay in English and the fiscal subsections
switch to Spanish — this keeps each rule readable by the contributors
who will execute it.

Identifiers (table names, types, function names, file paths) stay in
English even inside Spanish prose, because they cross the tRPC
boundary and live in code.
