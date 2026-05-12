/**
 * ENG-038 slice 2 — payment provider credential storage helpers.
 *
 * Mirror-structural with the fiscal pack `settings.ts` helpers
 * (`services/fiscal/packs/{mx,cl}/settings.ts`). Credentials live
 * under `tenants.settings.payments.<railId>.credentials.*` and are
 * shaped according to the descriptor declared in
 * `services/payments/manifest.ts::CREDENTIAL_FIELDS_BY_RAIL`.
 *
 * Three responsibilities:
 *
 * - `readPaymentRailCredentials(blob, railId)` — pure read with
 *   defensive defaults; never throws.
 * - `mergePaymentRailCredentialsIntoTenantSettings(existing, railId, patch)`
 *   — immutable merge that only updates the targeted rail branch.
 *   Empty-string values clear the field.
 * - `maskCredentialValue(value)` — never returns the plaintext to the
 *   client after save. The admin form re-renders against the masked
 *   form so the operator confirms they pasted the right credential
 *   without the server re-serving the secret.
 *
 * The shape is intentionally loose `Record<string, string>` rather
 * than a per-rail discriminated union because every descriptor field
 * is a string. The router validates that no undeclared key sneaks in;
 * here we just preserve / mask.
 *
 * @module services/payments/credentials
 */

import type { PaymentRailId } from '../../db/schema.js';
import {
  CREDENTIAL_FIELDS_BY_RAIL,
  type PaymentCredentialFieldDescriptor,
} from './manifest.js';

export type RailCredentialMap = Record<string, string>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read the credentials map for a single rail from a tenant settings
 * blob. Filters down to declared keys (per the manifest descriptor)
 * so stale fields written by an older slice cannot leak back into
 * the response. Missing branch → empty map.
 */
export function readPaymentRailCredentials(
  tenantSettings: Record<string, unknown> | null | undefined,
  railId: PaymentRailId
): RailCredentialMap {
  if (!isPlainRecord(tenantSettings)) return {};
  const payments = tenantSettings.payments;
  if (!isPlainRecord(payments)) return {};
  const rail = (payments as Record<string, unknown>)[railId];
  if (!isPlainRecord(rail)) return {};
  const credentials = (rail as Record<string, unknown>).credentials;
  if (!isPlainRecord(credentials)) return {};

  const declared = new Set(
    CREDENTIAL_FIELDS_BY_RAIL[railId].map(field => field.key)
  );
  const out: RailCredentialMap = {};
  for (const [key, value] of Object.entries(credentials)) {
    if (!declared.has(key)) continue;
    if (typeof value !== 'string') continue;
    // Trim before the length check: a whitespace-only value (e.g.
    // an operator who pasted spaces from a misconfigured clipboard)
    // is functionally empty and must NOT pass `validateConfig`.
    // The router also trims at write time but defense-in-depth keeps
    // older blobs (or imports from outside the router) honest.
    if (value.trim().length === 0) continue;
    out[key] = value;
  }
  return out;
}

/**
 * Merge a partial credential patch into the tenant settings blob
 * without mutating the input. Empty-string values clear the stored
 * field. Undeclared keys are filtered by the caller (`paymentSettings.updateRail`)
 * so by the time we land here every key is descriptor-approved.
 */
export function mergePaymentRailCredentialsIntoTenantSettings(
  existing: Record<string, unknown> | null | undefined,
  railId: PaymentRailId,
  patch: Record<string, string | null>
): Record<string, unknown> {
  const base = isPlainRecord(existing) ? { ...existing } : {};
  const paymentsBranch = isPlainRecord(base.payments) ? { ...base.payments } : {};
  const railBranch = isPlainRecord(paymentsBranch[railId])
    ? { ...(paymentsBranch[railId] as Record<string, unknown>) }
    : {};
  const credentialsBranch = isPlainRecord(railBranch.credentials)
    ? { ...(railBranch.credentials as Record<string, unknown>) }
    : {};

  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') {
      delete credentialsBranch[key];
    } else {
      credentialsBranch[key] = value;
    }
  }

  railBranch.credentials = credentialsBranch;
  paymentsBranch[railId] = railBranch;
  base.payments = paymentsBranch;
  return base;
}

/**
 * Mask a credential value for outbound responses. Never returns the
 * full plaintext: a short value collapses to a fixed dot block, a
 * longer value keeps the last 3 characters so the operator can
 * confirm they pasted the right credential.
 *
 * Returns the empty string when the stored value is empty so the
 * admin form renders an empty input ready for first entry.
 */
export function maskCredentialValue(value: string | null | undefined): string {
  if (!value) return '';
  if (value.length <= 4) return '••••';
  return `••••••••${value.slice(-3)}`;
}

/**
 * Project the rail credentials into the shape `paymentSettings.getAll`
 * surfaces: declared keys only, sensitive fields masked, presence flag
 * indicating whether the field has a stored value (UI uses this to
 * differentiate "blank" from "saved but masked").
 */
export interface PaymentRailCredentialView {
  readonly key: string;
  readonly value: string;
  readonly hasStoredValue: boolean;
  readonly sensitive: boolean;
}

export function projectRailCredentials(
  railId: PaymentRailId,
  credentials: RailCredentialMap
): PaymentRailCredentialView[] {
  const descriptors = CREDENTIAL_FIELDS_BY_RAIL[railId];
  return descriptors.map(
    (descriptor: PaymentCredentialFieldDescriptor): PaymentRailCredentialView => {
      const raw = credentials[descriptor.key] ?? '';
      const hasStoredValue = raw.length > 0;
      const value = descriptor.sensitive ? maskCredentialValue(raw) : raw;
      return {
        key: descriptor.key,
        value,
        hasStoredValue,
        sensitive: descriptor.sensitive,
      };
    }
  );
}
