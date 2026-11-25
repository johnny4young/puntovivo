# Contribution triage

**Language:** English · [Español](../../docs/es/repository/TRIAGE-REVIEW.md)

Every pull request and issue from an outside contributor gets an automated first review from [Centinela](https://github.com/johnny4young/centinela).
It posts one comment, keeps it updated, and sets the `centinela` status on the pull request.
A maintainer still reviews every contribution; the bot only makes sure it is ready for that review.

## What it checks

| Area         | Pull request                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Description  | Conventional Commit title and the **What**, **Why** and **How to test** sections of the template                                          |
| Evidence     | Screenshots or a recording for UI changes, reproduction steps for fixes, tests for new source code                                        |
| Size         | Lines changed without lockfiles or generated files; large pull requests are asked to split or justify                                     |
| Language     | Spelling in added lines, Spanish copy in the usted register, every locale key in English and Spanish                                      |
| Safety       | Workflows, install scripts, licenses, Electron hardening, hidden Unicode, secrets, encoded blobs                                          |
| Identity     | Commits that carry a maintainer identity without a verified signature                                                                     |
| Dependencies | New dependencies, their license and how long ago the version was published                                                                |
| Hygiene      | Merge conflicts, sequential Drizzle migrations that collide with `main`, commits shared with another open pull request, failing CI checks |

Issues that report a bug need steps to reproduce, expected and actual behavior, the Puntovivo version and the operating system.
Reports that look like a security vulnerability are pointed to the private process in [SECURITY](../../docs/SECURITY.md).

The hygiene checks compare the pull request with `main` and the other open pull requests. A migration collision means the pull request adds a migration in `packages/server/src/db/migrations/` whose sequential number is already taken on `main` or falls behind the latest one there; the author regenerates the migration on top of the current `main`.

## Results

- **To move forward**: the author needs to fix it; the pull request gets `status: waiting-on-author`.
- **Needs a maintainer review**: a maintainer has to look at it; the pull request gets `status: needs-maintainer`.
- **Suggestions**: worth doing, never blocking.

The `centinela` status fails while either of the first two groups has items. Adding the `triage: approved` label marks them as accepted by a maintainer for the current commit; a new push needs a new approval.
Incomplete issues get `needs-info`.

## When it runs

It runs again only when something it reads changes: a new commit, the title, the description, the opt-in or approval labels, or its own rules.
Maintainer contributions are skipped unless they carry the `triage` label. Drafts and automation accounts are skipped.

The workflow runs from `main` and reads the pull request only through the GitHub API; it never checks out or executes contributed code.

## Maintainer requests

A maintainer can ask Centinela for more with a label. Centinela removes the label when it finishes, so applying it again asks for a new run.

| Label                  | Applies to   | What it does                                                                                                    |
| ---------------------- | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `centinela: ai-review` | Pull request | Deep AI review of the diff against the [code rules](#code-rules); findings never change the `centinela` status  |
| `centinela: triage`    | Issue        | AI issue triage: likely duplicates, bugs already fixed by a merged pull request and contribution direction      |
| `centinela: learn`     | Any          | Collects recent maintainer reviews and opens or updates a pull request with the learned rules                   |
| `centinela: draft-pr`  | Issue        | Runs the separate `Centinela Execute` workflow, which implements the issue on a new branch and opens a Draft PR |

The Draft PR from `centinela: draft-pr` is reviewed by Centinela like any other pull request and still needs a maintainer to review and merge it.

Replying to a Centinela review thread, or mentioning `@centinela` in a comment, gets an answer grounded in these rules. When the reply shows a finding is a false positive and Centinela confirms it, the thread is resolved automatically and the dismissal is recorded for future reviews.

## Code rules

A maintainer can ask Centinela for an AI review with the `centinela: ai-review` label. It reads this section as the project rules, so keep it to rules a reviewer can check in a diff.

**Multi-tenant data**

- Every query in a tRPC router scopes by `ctx.tenantId`.
- A procedure that takes a `siteId` calls `ensureTenantSite(ctx.db, ctx.tenantId, siteId)`.
- Role checks use `adminProcedure`, `managerOrAdminProcedure` or `createRoleGuard`; never a custom middleware.

**API and desktop**

- `/api/trpc` is the application API. Do not add REST routes; only `/api/health` and `/api/realtime/*` remain.
- The Electron renderer is sandboxed: a new preload API is a one-line `ipcRenderer.invoke` wrapper routed to an `ipcMain.handle` channel.
- The embedded server runs on a worker thread. Main process code reaches it only through `apps/desktop/src/main/server-host/` and never imports `@puntovivo/server`.
- Main process code never blocks: no synchronous file, process or crypto work.

**Database**

- Schema changes go in `packages/server/src/db/schema.ts` with a migration generated by `drizzle-kit`. Hand-written SQL uses `IF NOT EXISTS`.
- Never `.default(null)` on a `{ mode: 'json' }` text column: it stores the string `null`.
- Application code never writes `product_stock_totals`; database triggers maintain it.
- Catalog updates use the versioned update that raises `STALE_VERSION` on a conflict.

**Money, sales and fiscal documents**

- Every monetary intermediate goes through `roundMoney()`. The payable total uses `resolvePayableTotal`.
- Completing a sale requires an active cash session, and cash movements go through `insertCashMovement`.
- A fiscal document, its outbox entry and the numbering advance are written in one transaction. Emission happens after commit and never rolls back the sale.
- An emitted fiscal document never changes.

**Interface text**

- Every user-visible string lives in `apps/web/src/i18n/locales/`, in both `en` and `es`.
- Spanish copy is neutral Latin American Spanish in the usted register: never voseo and never tú.

**Tests**

- New tRPC procedures need a server test that calls the router through the tRPC caller with an in-memory database, including tenant isolation when it reads or writes tenant data.

## Improving the rules

The Puntovivo rules live in `.github/centinela.json`; the checks themselves live in the [Centinela repository](https://github.com/johnny4young/centinela).
Any change to either changes the rules version, so each open contribution is reviewed once more with the new rules.

To preview a run from GitHub without posting anything, open **Actions → Centinela → Run workflow**, choose a `mode` (`review`, `triage` or `learn`), enter the pull request or issue `number` and keep `dry_run: true`. The output appears in the Job Summary of the run instead of as a comment on the pull request or issue.

To try a change against a real pull request without posting anything, from a Centinela checkout:

```bash
GITHUB_REPOSITORY=johnny4young/puntovivo GH_TOKEN=$(gh auth token) node src/centinela.mjs --dry-run --force --pr 123 --config ../puntovivo/.github/centinela.json
```
