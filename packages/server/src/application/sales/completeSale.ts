/**
 * ENG-054 — `completeSale` use-case service.
 *
 * Single entry point for both the fresh-sale path (formerly
 * `sales.create`) and the draft-completion path (formerly
 * `sales.completeDraft`). ENG-178 decomposed the former monolith into a
 * thin dispatcher (this file) over per-concern modules:
 *
 * - `runFreshSale.ts` / `runCompleteDraft.ts` — the two path bodies,
 *   each owning its pre-checks + the one synchronous `db.transaction`.
 * - `pricing.ts` — pre-tx money resolution (items, sequential, customer,
 *   payment plan).
 * - `creditPolicy.ts` — credit pre-flight + best-effort ledger write.
 * - `fiscalPostHook.ts` — best-effort post-commit fiscal emit + KDS enqueue.
 * - `journal-effects.ts` — journal lookup, summary, effect builders + emit.
 *
 * Behavior parity with the previous inline router code is the explicit
 * acceptance criterion (ROADMAP §3b ENG-054 / ENG-178). The control flow,
 * shape of the rows written, and ordering of side effects all match what
 * `sales.create` / `sales.completeDraft` used to do.
 *
 * @module application/sales/completeSale
 */

import { createModuleLogger } from '../../logging/logger.js';
import { runFreshSale } from './runFreshSale.js';
import { runCompleteDraft } from './runCompleteDraft.js';
import type { CompleteSaleSaleRecord } from './sale-read.js';
import type {
  CompleteSaleContext,
  CompleteSaleInput,
  CompleteSaleResult,
} from './types.js';

export type { CompleteSaleSaleRecord } from './sale-read.js';

const fallbackLog = createModuleLogger('application/sales/completeSale');

/**
 * Public entry point for sale completion — dispatches to the fresh-sale path
 * (`mode: 'fresh'`, formerly `sales.create`) or the draft-completion path
 * (`mode: 'fromDraft'`, formerly `sales.completeDraft`).
 *
 * Invariants (shared by both paths):
 * - MONEY ROUNDING IS UNIFORM 2-DECIMAL. Every monetary intermediate and
 *   every running accumulation passes through `roundMoney()`
 *   (`Math.round((v + EPSILON) * 100) / 100`, half-away-from-zero) — per
 *   line (`resolveSaleItems`), at the header re-round, and on tip / service
 *   charge / total. This holds REGARDLESS of the tenant's country: there is
 *   NO per-country rounding branch in this file. Per-country rounding
 *   (Chile integer peso, Peru ICBPER) is NOT implemented in the
 *   transactional money path today; the only integer rounding that exists
 *   is `roundClp` in the Chile DTE XML serializer, which never touches the
 *   live POS money columns. Implementing per-country transactional rounding
 *   would be a separate code ticket, not a documentation change.
 * - One synchronous `db.transaction(...)` writes every row the sale touches
 *   (sequential, header, items, payments, stock, inventory movement +
 *   balance, cash movement, sync queue, audit logs), fronted by
 *   `assertCashSessionStillOpen` (in-tx TOCTOU re-check on the drawer).
 * - Fiscal emission is a BEST-EFFORT POST-COMMIT hook
 *   (`safelyEmitFiscalDocument`): it runs after the sale transaction has
 *   already committed and a fiscal failure NEVER rolls the sale back.
 *
 * Preconditions: the `mode` discriminator selects one of the two validated
 * path contracts documented on `runFreshSale` and `runCompleteDraft`.
 *
 * Postconditions: returns the completed sale payload from the selected path;
 * path-specific write sets are documented on each path.
 */
export async function completeSale(
  ctx: CompleteSaleContext,
  input: CompleteSaleInput
): Promise<CompleteSaleResult<CompleteSaleSaleRecord>> {
  const log = ctx.log ?? fallbackLog;

  if (input.mode === 'fresh') {
    return runFreshSale(ctx, log, input);
  }
  return runCompleteDraft(ctx, log, input);
}
