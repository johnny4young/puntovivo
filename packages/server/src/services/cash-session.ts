/**
 * Cash-session service (barrel).
 *
 * The cash-reliability helpers — denomination validation, the
 * ENG-042/055/056 cash-movement invariants, open-session lookups, and
 * register templates — live in focused modules under `cash-session/`
 * (ENG-178 Slice 19):
 * - `constants.ts` — epsilon / register defaults / movement-type Sets
 * - `denominations.ts` — opening-float / closing-count / over-short validators
 * - `movements.ts` — the sign-convention SSOT + the in-tx drawer mutations
 * - `queries.ts` — active-session lookups + the sale precondition guard
 * - `registers.ts` — register-assignment denomination templates
 *
 * This barrel preserves the exact public surface so all importers resolve
 * through `services/cash-session.js` unchanged.
 *
 * @module services/cash-session
 */

export type { CashMovementType } from './cash-session/constants.js';
export {
  assertOpeningFloatMatchesDenominations,
  createDefaultCashSessionDenominations,
  getCashSessionDenominationTotal,
  getCashSessionOverShort,
  getClosingCountTotal,
  normalizeRegisterName,
} from './cash-session/denominations.js';
export {
  assertCashSessionStillOpen,
  getCashMovementSignedAmount,
  getPersistedSaleCashContribution,
  insertCashMovement,
} from './cash-session/movements.js';
export {
  getActiveCashSessionForCashier,
  getOpenCashSessionForRegister,
  requireActiveCashSession,
} from './cash-session/queries.js';
export {
  ensureRegisterAssignmentTemplate,
  ensureRegisterAssignmentTemplatesForSite,
} from './cash-session/registers.js';
