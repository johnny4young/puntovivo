/**
 * Single definition of "this quotation can still be converted into a sale".
 *
 * Why it lives here. Conversion eligibility was being decided twice: once in
 * the browser against the CLIENT clock, and once inside the conversion
 * transaction against the server clock. A workstation whose clock runs ahead
 * hides or blocks a quotation the server would happily convert, and one
 * running behind offers a conversion that then fails. The read models now
 * carry a server-computed `convertible`, and the transactional check uses
 * this same predicate, so the surface the operator sees and the rule that
 * actually runs cannot drift apart.
 *
 * The transactional check remains authoritative: `convertible` is a snapshot
 * taken at read time, and validity can lapse between the read and the write.
 *
 * @module services/quotations/eligibility
 */

import { parseStrictIsoInstant } from '../../lib/isoDate.js';

/**
 * True when an accepted quotation is still inside its validity window.
 *
 * Dates are read with the strict parser rather than `Date.parse`, which
 * rolls an impossible calendar date forward (2026-02-30 becomes March 2nd)
 * and would silently extend validity past the stored date. An unparseable or
 * impossible `validUntil` fails closed, matching the existing rule that a
 * malformed validity is not a valid one.
 */
export function isQuotationConvertibleAt(
  quotation: { status: string; validUntil: string | null },
  nowIso: string
): boolean {
  if (quotation.status !== 'accepted') return false;
  if (!quotation.validUntil) return true;
  const validUntil = parseStrictIsoInstant(quotation.validUntil);
  const now = parseStrictIsoInstant(nowIso);
  if (validUntil === null || now === null) return false;
  return validUntil >= now;
}
