# Puntovivo — Sprint Plan

> Tactical, iteration-level execution plan. Each iter here is **one ENG
> ticket** in [docs/ROADMAP.md §3b](./ROADMAP.md), with the extra
> granularity that ROADMAP intentionally keeps out of the table:
> commit sequencing, per-commit file list, edge-case coverage, verification
> matrix, and draft commit messages. ROADMAP remains the canonical ticket
> list; this file is the execution checklist the agent opens next to it.

Always work one iter at a time, in the order of the "Recommended sequence"
below. Do not interleave commits between iters. The first line of the
chat when starting an iter is `Executing <ENG-NNN> — <one-liner>`.

## 1. Status at a glance (2026-04-23)

This table mirrors the authoritative `Status` column in
[ROADMAP §3b](./ROADMAP.md). When discrepancies appear, ROADMAP wins.

| Iter | Ticket | Status | Scope |
|---|---|---|---|
| Iter 1 | (doc-only, no ENG) | Shipped | Design stubs + Mermaid architecture + 12 follow-up docs |
| Iter 2 | (pre-ENG numbering, follow-up in `ENG-016`) | Shipped | Receipt templates — editor + renderer. See [RECEIPT-TEMPLATES.md](./RECEIPT-TEMPLATES.md). ENG-016 follow-ups landed across pass 1 (items 4/5/6 — bindings captions + appFooter + FLIP), pass 2 (item 1 — dnd-kit drag-and-drop), pass 3 (item 3 — template functions: parser + 12-fn whitelist + Zod AST validator + editor cheat-sheet), pass 4 (item 2 + item 7 parser-side markers — CodeMirror 6 editor with custom StreamLanguage tokenizer, namespace/property/function autocomplete, `{{` `}}` auto-close, and inline error markers via @codemirror/lint), and pass 5 (item 7 runtime hints — `receiptTemplates.variableAvailability` admin endpoint + CM6 Decoration extension that dims unset variable tokens with translatable hover tooltips). |
| — | [`ENG-015`](./ROADMAP.md) | Shipped | Dev seed command. See [DEV-SEED.md](./DEV-SEED.md). |
| Iter 6 | [`ENG-018`](./ROADMAP.md) | Shipped | Sales park-and-resume (multi-cart workspace). Server + audit + UI shipped across 5d8f720 / 05eea2d / 38e2a47 / ENG-018b diff. Spec §3. |
| Iter 6b | [`ENG-018b`](./ROADMAP.md) | Shipped | ENG-018 UI follow-up: Zustand multi-cart workspace, SuspendedSalesPanel, suspend/new-sale/resume controls, Ctrl+P / Ctrl+R / Ctrl+Shift+P shortcuts, close-session drafts warning, row-selection in history, E2E round-trip. |
| Iter 6c | [`ENG-018c`](./ROADMAP.md) | Shipped | Server: `sales.completeDraft` + `sales.discardDraft` stock reversal + ownership gate widen. Shipped 38e2a47. |
| Iter 7 | [`ENG-019`](./ROADMAP.md) | Shipped | Sales receipt reprint — server 5d8f720 + UI 05eea2d. Spec §4. Ctrl+Shift+P + history row selection landed as part of ENG-018b. |
| Iter 3 Fase A | [`ENG-020`](./ROADMAP.md) | Shipped | Fiscal DIAN modeling + MockAdapter. Spec §5. |
| — | [`ENG-017`](./ROADMAP.md) | Shipped | Country / locale / currency configuration — 3 catalog tables, resolver service, LocaleProvider, admin CompanyLocaleSettingsCard. See [LOCALE-CURRENCY.md](./LOCALE-CURRENCY.md). |
| Iter 4 | [`ENG-022`](./ROADMAP.md) | Gated | Hardware POS (test lab hardware). Spec §6. |
| Iter 3 Fase B | [`ENG-021`](./ROADMAP.md) | Gated | Fiscal DIAN PT integration (PT contract). Spec §7. |
| Iter 5 | [`ENG-023`](./ROADMAP.md) | Gated | Bold payment terminal (depends on Iter 4 + Bold sandbox). Spec §8. |
| Iter 8 | [`ENG-024`](./ROADMAP.md) | Deferred | Inter-site transfer requests + `reserved` lifecycle. Spec §9. |
| Plan v2.0 | [`ENG-025..ENG-040`](./ROADMAP.md) | Pending | 16-ticket phased plan promoted from the 2026-Q2 audit (security + code-quality + dependency + market intelligence). Phase 0 hardening (`ENG-025..029`), Phase 1 AI Wave 1 (`ENG-030..033`, Vercel AI SDK + Anthropic), Phase 2 multi-country fiscal engine (`ENG-034..036`, MX + CL packs), Phase 3 sync + LATAM payment rails (`ENG-037..038`), Phase 4 restaurant vertical + AI Wave 2 (`ENG-039..040`). Per-quarter spec in [PLAN-V2.md](./PLAN-V2.md). `ENG-025` (critical security closure) lands first and is unconditional. |

## 2. Recommended sequence

Value-per-day priority, skipping gated tickets:

1. **`ENG-025` — critical security closure** — first and unconditional. Closes the SEC-1 HIGH finding (Electron IPC bridge bypassing tenant scope) plus three MED findings (rate-limit, XSS, logout sessionVersion). Spec lives in [PLAN-V2.md](./PLAN-V2.md) §2 Phase 0; per-vector approach captured in the 2026-Q2 audit synthesis. Must ship before any new feature touches user data.
2. **`ENG-026..ENG-029` — Phase 0 hygiene tail** — Vite 8 bump, dead code removal, cross-cutting helpers, hotspot splits triggered defensively. Cheap to land, raises the floor for everything else.
3. **`ENG-030..ENG-033` — AI Wave 1** — Vercel AI SDK foundation (`ENG-030`) blocks `ENG-031` and `ENG-033`; `ENG-032` (local-only anomaly) can run in parallel with the foundation work. Operator-approved provider default: Anthropic Sonnet 4.7; Ollama parked for `ENG-040`.
4. **`ENG-034..ENG-036` — Multi-country fiscal engine** — `ENG-034` FISCAL-CORE refactor blocks the country packs; `ENG-035` (MX) and `ENG-036` (CL) can run in parallel once the contract is in place. Argentina / Peru / Brazil packs queue after MX + CL are in sandbox-validated state.
5. **`ENG-037..ENG-038` — Sync + payment rails** — libSQL/Turso spike + LATAM payment rails (Wompi, Bold, ePayco, Mercado Pago, Nequi) with AI-assisted reconciliation.
6. **`ENG-039..ENG-040` — Vertical restaurant MX + AI Wave 2** — restaurant mode integrated with the MX pack; vision + voice features layer on the AI foundation.
7. **Gated tickets** stay parked until their gate clears: `ENG-022` hardware POS (test lab), `ENG-021` fiscal PT integration (signed contract + 5 more gates), `ENG-023` Bold datáfono (depends on `ENG-022` adapter interface + Bold sandbox).
8. **`ENG-024`** (inter-site transfer reservation) is deferred unless a multi-site tenant pushes for it.

Per-quarter detail and architectural decisions closed by the 2026-Q2 audit live in [PLAN-V2.md](./PLAN-V2.md). Anything gated stops the flow and raises a question to the user — do not speculate a workaround.

## 3. Iter 6 / ENG-018 — Sales park-and-resume

**One-liner**: Multi-cart workspace with `sales.suspend` / `sales.resume` / `sales.listDrafts` + persistent Zustand workspace + panel for suspended sales + Ctrl+P / Ctrl+R shortcuts.

**Domain context**: the backend already has `status='draft'` on `sales` (schema.ts:20). The UI does not: a cashier cannot suspend a cart to attend a different customer. This iter fills the UI gap and extends the backend with the missing procedures.

**3.1 Sequencing (3 commits)**:

1. **Commit 1 — server procedures + schema patches** (~1 day)
   - Extend `sales` with nullable `suspendedAt` (ISO), `suspendedBy` (FK users.id), `suspendedLabel` (optional human number). Raw DDL mirror + Drizzle migration + `ensureColumn`.
   - `sales.suspend({ saleId, label? })` — cashierProcedure, idempotent, persists `status='draft'` + `suspendedAt=now` + `suspendedBy=ctx.userId`. Optional audit log if tenant flag `audit_park_sale` is set.
   - `sales.resume({ saleId })` — cashierProcedure, SELECT FOR UPDATE (SQLite busy_timeout emulates), FORBIDDEN when `suspendedBy !== ctx.userId && ctx.role not in {manager, admin}`. Returns items + discounts + customer + notes and clears the suspended flags.
   - `sales.listDrafts({ filter: { site, cashier?, date? }, page, perPage })` — paginated. Default: cashier sees only their own; manager/admin sees all in the site.
   - `sales.discardDraft({ saleId })` — marks `status='cancelled'` and reverses the stock debited when the draft was created, scoped by tenant and original cash-session site.
   - Tests: suspend→resume round-trip preserves items/discounts/customer/notes; two cashiers cannot resume the same draft concurrently; cashier A cannot resume cashier B's draft but manager can; `listDrafts` respects role scope.

2. **Commit 2 — UI web** (~2 days)
   - `apps/web/src/features/sales/useCartWorkspace.ts` — Zustand store with `Record<draftId, Cart>` + `activeId` + `createDraft` / `suspendActive({ label? })` / `resume(id)` / `discard(id)` / `switchTo(id)`. Persist in `localStorage` keyed `${tenantId}:${userId}` to survive refresh.
   - Refactor `SalesPage.tsx` to read the active cart from the store instead of local `useState`.
   - "Suspender" button in `SalesCheckoutPanel` next to "Charge sale"; "Nueva venta" creates a blank draft.
   - `SuspendedSalesPanel.tsx` (new) — side panel with cards (number + customer + item count + total + age + resume / discard). Badge with count in the header.
   - Extend `useSalesKeyboardShortcuts.ts`: `Ctrl+P` / `Cmd+P` = suspend, `Ctrl+R` / `Cmd+R` = open resume panel. Guard against firing when focus is inside `<input>/<textarea>/[contenteditable]` (reuse existing `isEditableFocused` helper).
   - When `cashSessions.close` is invoked with outstanding drafts from the shift, prompt: "X ventas suspendidas. ¿Continuar de todos modos? Quedarán accesibles para el supervisor" with options "Descartar todos" / "Continuar".
   - i18n: extend `sales` namespace with `park.suspend`, `park.resume`, `park.discard`, `park.emptyState`, `park.shortcutHint`, `park.closedSessionWarning`, `park.confirmDiscardTitle`, `park.confirmDiscardMessage` in both locales.
   - Tests: suspend+resume round-trip preserves state in UI; `Ctrl+P` does not fire while a text input is focused; two concurrent cashiers see a clean error when racing the same draft; close-session prompt appears when drafts exist.
   - E2E in `e2e/web/business.spec.ts`: cashier creates cart A → suspends → creates cart B → charges B → resumes A → charges A. Assert both sales complete and stock decrement is correct per site.

3. **Commit 3 — docs + audit** (~0.5 days)
   - Add `sale.park` and `sale.resume` to `auditLogActionEnum` (string enum, no migration), gated by the `audit_park_sale` tenant flag.
   - Update `ROADMAP.md` ENG-018 row with "Shipped: <summary>".
   - Update `TEST-PLAN.md` marking PARK-01 through PARK-06 as automated.

**3.2 Edge cases**: empty listDrafts → empty state with CTA; skeleton in panel while loading; suspend network failure → toast + keep local cart; offline (Electron) works 100% against embedded SQLite; Zod rejects suspending a `status !== 'draft'` sale; cashier trying to resume someone else's draft gets a translated FORBIDDEN; parity test green.

**3.3 Draft commit messages**:

```
feat(pos): sales.suspend sales.resume sales.listDrafts procedures

- Extend sales table with suspendedAt suspendedBy suspendedLabel nullable columns
- Suspend is idempotent, resume enforces per-cashier lock with manager override
- Cover cross-cashier lock, role based scope, round trip field preservation
```

```
feat(pos): park and resume UI with multi cart workspace and shortcuts

- Add useCartWorkspace Zustand store persisted per user
- Add SuspendedSalesPanel with list, resume, discard actions
- Wire Ctrl P and Ctrl R shortcuts with input focus guard
- Warn when closing a cash session with outstanding drafts
- Add park.* keys to sales i18n in en and es
```

```
docs(pos): mark ENG-018 park and resume shipped
```

## 4. Iter 7 / ENG-019 — Sales receipt reprint

**One-liner**: `sales.getForReprint` procedure + reprint counter + audit `sale.reprint` + reprint button in history and sale details modal + Ctrl+Shift+P shortcut.

**Domain context**: `print-receipt` IPC handler (apps/desktop/src/main/index.ts:1708) accepts HTML and prints immediately, but no procedure exposes a past sale for reprint. When the printer runs out of paper or the hardware fails, the cashier cannot reprint from history — the sale is trapped behind a one-way flow.

**4.1 Sequencing (2 commits)**:

1. **Commit 1 — server + audit** (~1 day)
   - Add `reprintCount: integer default 0`, `lastReprintedAt: text`, `lastReprintedBy: text (FK users.id)` to `sales`. Raw DDL + `ensureColumn` + migration.
   - `sales.getForReprint({ saleId, reason? })` — cashierProcedure. Returns the full `saleRecord` (items + payments + customer snapshot when Iter 3 Fase A lands). Increments counter + timestamp + user. Emits `sale.reprint` audit log with metadata `{ reason?: string, count: number }`.
   - Permissions: cashier may reprint their own sales from the current shift; manager and admin may reprint anything within the tenant.
   - Tests: round-trip (getForReprint matches getById shape); counter increments; audit row emitted; permissions honored; cross-tenant isolated.

2. **Commit 2 — UI** (~1.5 days)
   - `SalesHistoryPage.tsx` — add "Reimprimir" row action with `Printer` icon (disabled without permission).
   - `SaleDetailsModal.tsx` — prominent "Reimprimir recibo" button that calls `getForReprint` first then `printSaleReceipt()`; optional reason dropdown (Paper out / Customer request / Previous print error / Other with free text).
   - Banner in the modal when `reprintCount > 0`: "Reimpresa {count} veces. Última: {lastReprintedAt} por {lastReprintedBy}".
   - Shortcut: with a row selected on `SalesHistoryPage`, `Ctrl+Shift+P` reprints (`Ctrl+P` is taken by Iter 6).
   - i18n: extend `sales` namespace with `reprint.button`, `reprint.title`, `reprint.reasonLabel`, `reprint.reasonOptions.*`, `reprint.confirmTitle`, `reprint.successToast`, `reprint.errorToast`, `reprint.historyBanner`, `reprint.noPermission`.
   - Tests: button visible with permission, disabled without, reprint round-trip preserves items/payments/totals, toast success, banner updates after reprint.
   - E2E extension: admin completes a sale → navigates to history → reprints → DB shows `reprintCount = 1` and audit log has the `sale.reprint` row.

**4.2 Edge cases**: skeleton while fetch; network failure → toast, no counter bump; Electron works 100% offline; Zod rejects invalid `saleId`; cashier trying to reprint another cashier's past-shift sale gets FORBIDDEN; `status='draft'` sale disables the button (those are Iter 6 suspended carts); `status='void'` allows reprint with an "ANULADA" watermark for trace.

**4.3 Integration with Iter 2 and Iter 4**: reuses the `receipt-renderer.ts` from Iter 2 (no duplication). If Iter 4 shipped and `EscPosPrinterAdapter` is configured, reprint uses ESC/POS natively and can open the cash drawer on reprint (useful at end-of-shift reconciliation). If Iter 7 lands before Iter 4, fallback path is `SystemPrinterAdapter` — zero tech debt.

**4.4 Draft commit messages**:

```
feat(sales): sales.getForReprint procedure with reprint counter and audit

- Add sales.getForReprint returning full sale snapshot for re-emission
- Track reprintCount lastReprintedAt lastReprintedBy on sales row
- Emit sale.reprint audit log with optional reason
- Cover permissions cashier-own vs manager-any and cross tenant isolation
```

```
feat(sales): reprint receipt action in history and sale details

- Add reprint button in SalesHistoryPage and SaleDetailsModal
- Capture optional reason and show reprint history banner
- Add Ctrl Shift P shortcut and reprint.* keys to sales i18n in en and es
- Cover round trip reprint, disabled states, void sale watermark
```

## 5. Iter 3 Fase A / ENG-020 — Fiscal DIAN data model + MockAdapter

**One-liner**: `fiscal_documents` + `fiscal_document_items` with immutable buyer and line snapshots + global `dian_identification_types` + `FiscalAdapter` interface + `MockAdapter` + hooks in `sales.complete`/`return`/`void` + architectural lint banning fiscal reports from joining with `customers`/`products`.

**Gates**: none. The MockAdapter is deterministic against DIAN Anexo 1.9 canonical vectors. **Depends on ENG-017 landing first** so the buyer currency snapshot has the right currency code.

**Full detail**: see [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md) and the five architectural decisions captured in that doc (§Modelamiento del adquiriente y líneas):

1. Global read-only `dian_identification_types` (CC=13, NIT=31, TI=12, CE=22, PA=41, RC=11, NUIP=91, TDE, PEP, PPT) — not tenant-scoped.
2. Immutable buyer snapshot in `fiscal_documents` (`buyerTaxId`, `buyerTaxIdTypeCode`, `buyerName`, `buyerEmail`, `buyerAddress`, `buyerCity`, `buyerDepartment`, `buyerCountry`, `buyerPersonType`, `buyerFiscalRegime`, `buyerFiscalResponsibility`).
3. Consumidor final for DEE POS = `buyerTaxId='222222222222'` + `buyerTaxIdTypeCode='31'` + `buyerName='Consumidor final'` — no ficticious customer row.
4. Immutable line snapshot in `fiscal_document_items` (`productName`, `productSku`, `unitMeasureCode`, `quantity`, `unitPrice`, `discountAmount`, `taxRate`, `taxAmount`, `taxCategoryCode`, `lineTotal`).
5. Architectural lint: vitest that parses `routers/reports/fiscal*` imports and fails on any reference to `customers` or `products`.

**5.1 Sequencing (5 commits, ~2 weeks)**:

1. **Commit 1** — Global `dian_identification_types` + seed + migration for `customers.dianIdentificationTypeId` (data migration by `abbr`).
2. **Commit 2** — `fiscal_documents` + `fiscal_document_items` + `fiscal_numbering_resolutions` + `fiscal_certificates` tables with all snapshot fields.
3. **Commit 3** — `FiscalAdapter` interface + `MockAdapter` with canonical CUFE SHA-384 and simulated contingency.
4. **Commit 4** — `fiscal-documents` orchestrator + hooks in `sales.complete`/`void`/`return` + dev seed for `fiscal_numbering_resolution` + `fiscal_certificate`.
5. **Commit 5** — `FiscalHabilitationWizard` placeholder + `FiscalContingencyIndicator` + `FiscalDocumentListPage` + `FiscalReportsPage` + architectural lint.

**5.2 Status**: **Shipped**. All five commits staged end-to-end:

- Commit 1 — migration `0004_dian_identification_types.sql` + `seedDianIdentificationTypes` (10 DIAN codes).
- Commit 2 — migration `0005_fiscal_documents.sql` + 4 fiscal tables with the immutable buyer + line snapshots in `schema.ts` + `fiscalDocumentsRelations` drizzle joins.
- Commit 3 — `services/fiscal/{cufe,adapter,mock-adapter,registry}.ts` + 13 tests (6 CUFE avalanche + canonical-order assertions, 7 MockAdapter issue/void/fetchStatus assertions).
- Commit 4 — `services/fiscal/orchestrator.ts` with `emitFiscalDocument` idempotent by `(tenantId, source, sourceId, kind)`; four hooks wired into `sales.ts` (`create` completed / `completeDraft` / `void` / `returnSale`) as best-effort post-tx calls behind `tenants.settings.fiscal_dian_enabled`. Dev seed now enables the flag and inserts one DEE resolution per site + placeholder cert for `demo-co`; 10 orchestrator integration tests cover site-scoped resolution lookup and rollback when fiscal persistence fails mid-write, plus extended seed-dev assertion (20 sales → 20 fiscal documents).
- Commit 5 — `trpc/routers/reports/fiscal.ts` + `reports/index.ts` aggregator mounted on `appRouter`, `trpc/schemas/fiscal.ts`, `architectural-lint.test.ts` (regex-based guard + synthetic positive test), `fiscal-reports.test.ts` (7 tests across list, paginated total count, getByCufe, cross-tenant isolation, FORBIDDEN, NOT_FOUND). Web UI: `FiscalDocumentListPage`, `FiscalReportsPage`, `FiscalHabilitationWizard`, header-mounted `FiscalContingencyIndicator`; `fiscal` i18n namespace registered en/es; admin-only `/fiscal-documents` and `/fiscal-reports` routes.

ENG-021 is the one-file swap of `MockAdapter` → `FactureAdapter`/`HkaAdapter` — the seams hold (FiscalAdapter interface + registry + hooks).

## 6. Iter 4 / ENG-022 — Hardware POS 🟡

**Gates**: physical test lab (thermal printer, USB HID scanner, RJ11 cash drawer) — do not start without confirmed hardware.

**One-liner**: `PrinterAdapter` with `system` and `escpos` drivers + cash drawer kick via ESC/POS + `useBarcodeScanner` hook (EAN-13 + price-embedded prefix 20-29) + peripherals configuration page.

**Full detail**: see [HARDWARE-POS.md](./HARDWARE-POS.md).

## 7. Iter 3 Fase B / ENG-021 — Fiscal DIAN PT integration 🟡

**Gates** (six, documented in [FISCAL-INTEGRATION.md](./FISCAL-INTEGRATION.md) §Pre-implementation checklist):
1. PT contract signed (Facture / HKA / Gosocket).
2. Sandbox + production credentials delivered.
3. Tenant pilot's DIAN digital certificate.
4. DIAN numbering resolution associated with the software.
5. POC validated out-of-repo: DEE + FEV + NC + ND + fetchStatus.
6. PT error-code → `ServerErrorWithCode` mapping agreed.

**Swap-only diff**: replaces `MockAdapter` with `FactureAdapter` / `HkaAdapter`. No domain changes beyond the adapter file.

## 8. Iter 5 / ENG-023 — Bold payment terminal 🟡

**Gates**: Bold sandbox credentials + Bluetooth device for tests. Also **depends on ENG-022 commit 1** which installs the `PaymentTerminalAdapter` interface.

**One-liner**: `BoldAdapter` calls the Bluetooth SDK for charge / void / printSlip; `SalePaymentModal` integrates the adapter with `ManualAdapter` fallback.

## 9. Iter 8 / ENG-024 — Inter-site transfer with reservation ⚪

**Status**: deferred proposal. The user surfaced this as a concern, not a firm requirement.

**Scope**: extend `transferOrderStatusEnum` with `requested`/`approved`/`rejected`; use `inventory_balances.reserved` (currently always 0); enable destination-initiated requests; add `initiatedBy`/`requestedBy`/`approvedBy`/`rejectedBy`/`rejectionReason`/`expectedArrivalAt`; state machine `create → requested → approved → in_transit → completed`; UI inbox + timeline. ~1.5 weeks.

## 10. Cross-iteration concerns

- **i18n parity** must stay green after each iter (`apps/web/src/i18n/locale-parity.test.ts`).
- **Drizzle migrations** — one migration per iter that touches schema; update `schema.ts`, generate the SQL migration, register the journal entry, and use `IF NOT EXISTS` when Drizzle's SQLite dialect cannot emit the construct (partial unique indexes, `WHERE` clauses). `db/index.ts` is no longer a raw-DDL mirror after ENG-002 Step 3.
- **Audit trail** — `auditLogActionEnum` is free-form strings; adding a new action never needs a migration. But `AuditLogsTable.tsx` needs an i18n key per action.
- **E2E suite** — 25+ tests in `e2e/web/`; every closing commit runs `npm run test:e2e:web` before pushing.
- **Electron boundary** — any peripheral or FS call goes through `ipcMain.handle` → `contextBridge.exposeInMainWorld('electron', {...})` → `window.electron.*`. Never `require('fs')` in the renderer.
- **Seed data** — when an iter adds a schema with defaults that matter for tests (like a fiscal resolution row), extend `packages/server/src/db/seed-dev.ts` so `npm run seed:dev` keeps producing a ready-to-demo dataset.

## 11. Verification matrix (per iter, before the closing commit)

| Check | Command | Must pass |
|---|---|---|
| Typecheck web | `npm run typecheck --workspace=@puntovivo/web` | ✓ |
| Typecheck server | `npm run typecheck --workspace=@puntovivo/server` | ✓ |
| Typecheck desktop | `npm run typecheck --workspace=@puntovivo/desktop` (if main changed) | ✓ |
| Lint web | `npm run lint --workspace=@puntovivo/web` | 0 new errors |
| Lint server | `npm run lint --workspace=@puntovivo/server` | 0 new errors |
| Tests server | `npm run test --workspace=@puntovivo/server -- --run` | all pass |
| Tests web | `npm run test --workspace=@puntovivo/web -- --run` | coverage ≥ 70/70/70/70 |
| i18n parity | included in web test run | ✓ |
| E2E | `npm run test:e2e:web` | all pass |
| CI aggregate | `npm run ci:web` and `npm run ci:server` in parallel | ✓ |
| Smoke web | manual boot `dev:web` + `dev:server`, driven with Playwright MCP | concrete strings asserted |
| Smoke Electron | `npm run dev:desktop` + validate feature + IPC when applicable | ✓ (or explicit gap declared) |
| Review skills | `typescript-react-reviewer` + `node` in parallel on the diff | zero HIGH blockers |

## 12. Update protocol

When an iter closes, do three things in the last commit:

1. Update this file: move the iter row in §1 to "✓ Shipped", shorten the full iter section to a one-sentence summary + "Shipped <date> — see <ENG-NNN>", link to the closing commit.
2. Update the matching row in `docs/ROADMAP.md` §3b: append "Shipped: <2-3 line summary>" to the Description column (matching the existing ENG-003..009 style).
3. If the iter introduced new docs (spec, runbook), add them to `docs/PLAN.md` §18.1 "Already landed".
