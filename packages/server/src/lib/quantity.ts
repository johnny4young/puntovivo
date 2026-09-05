/**
 * Tolerance used when reconciling stock quantities that have crossed SQLite
 * or repeated arithmetic boundaries. It is deliberately three orders of
 * magnitude below the smallest 0.001 quantity exposed by Puntovivo's forms,
 * so it absorbs IEEE-754 residue without hiding an operational unit.
 */
export const QUANTITY_EPSILON = 1e-6;

/**
 * The stock level left after debiting `requested` from `available`, with
 * sub-epsilon residue canonicalised to exactly zero.
 *
 * Every stock guard in the application accepts a debit that overshoots the
 * recorded balance by up to QUANTITY_EPSILON, because a balance that has
 * crossed SQLite and repeated unit arithmetic carries IEEE-754 residue and a
 * strict comparison would reject legitimate operations. But the debit that
 * followed subtracted the FULL requested amount, so a balance of 0.9999995
 * debited by 1 passed the guard and then persisted -0.0000005. Site balances
 * carry no non-negative constraint, so that value simply stuck, and it
 * compounds: every later read, transfer and report inherits it.
 *
 * Callers must run their insufficiency guard FIRST — this helper assumes the
 * debit was already authorised and only decides what the remainder is. It
 * deliberately does not clamp a genuine shortfall to zero: a residue larger
 * than the tolerance is real missing stock and must stay visible.
 *
 * The requested quantity itself is unchanged. The movement and transfer rows
 * keep recording what the operator actually moved; writing 0.9999995 into the
 * audit evidence would put float noise into the ledger to paper over float
 * noise in the balance.
 */
export function settleDebitedBalance(available: number, requested: number): number {
  const remainder = available - requested;
  return Math.abs(remainder) <= QUANTITY_EPSILON ? 0 : remainder;
}
