/**
 * ENG-184 — Market-profile resolver for the setup-readiness gate.
 *
 * Readiness was profile-blind: fiscal showed `not-applicable` whenever
 * the DIAN flag was off, so a Colombia store got no signal that it was
 * not issuing electronic invoices. This resolver decides, per the
 * tenant's country, whether readiness should SURFACE fiscal / sync
 * state as visible reminders.
 *
 * Crucially (ENG-184 operator decision): surfacing a reminder NEVER
 * escalates to a hard blocker. Selling is never gated on DIAN or
 * hardware — a merchant with no DIAN, or a broken printer, keeps
 * selling. The profile only controls whether the signal is VISIBLE
 * (optional-pending / warning) versus hidden (not-applicable).
 *
 * @module services/readiness/profile
 */

/**
 * Resolved readiness profile for a tenant. Derived purely from the
 * country today; modules could refine it later (e.g. a restaurant
 * profile that surfaces KDS readiness). Kept intentionally small.
 */
export interface ReadinessProfile {
  /** Normalized ISO 3166-1 alpha-2 country code (upper-case, may be ''). */
  countryCode: string;
  /**
   * When true, readiness surfaces fiscal + sync state as visible
   * reminders (optional-pending / warning) instead of hiding them as
   * not-applicable. Never produces a hard blocker. True for Colombia.
   */
  surfaceFiscalReminders: boolean;
}

/**
 * Resolve the readiness profile from a tenant locale country code.
 * Tolerates null/undefined/blank — an unconfigured tenant gets the
 * legacy (non-surfacing) profile so non-Colombia behaviour is
 * unchanged.
 */
export function resolveReadinessProfile(
  countryCode: string | null | undefined
): ReadinessProfile {
  const normalized = (countryCode ?? '').trim().toUpperCase();
  return {
    countryCode: normalized,
    surfaceFiscalReminders: normalized === 'CO',
  };
}
