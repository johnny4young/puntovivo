/**
 * slice 2 — `paymentSettings.*` admin router.
 *
 * Two procedures:
 *
 * - `paymentSettings.getAll` returns the full readiness view for every
 * rail in the manifest: descriptor + masked stored credentials +
 * `validateConfig` issues + the rail's `liveIntegration` flag. The
 * admin card consumes this in one round-trip.
 * - `paymentSettings.updateRail({ railId, credentials })` writes a
 * partial credential patch under
 * `tenants.settings.payments.<railId>.credentials.*`. Undeclared keys
 * are rejected with `PAYMENT_CREDENTIAL_UNKNOWN_FIELD`; empty-string
 * values clear the stored field; sensitive credentials are NEVER
 * reflected back in plaintext (response uses the same masked
 * projection as `getAll`).
 *
 * Plaintext credentials live alongside the other JSON namespaces in
 * `tenants.settings` (mirror of `tenants.settings.fiscal.{mx,cl}.*`).
 * Per ADR-0006 /  the diagnostic exporter's `SENSITIVE_KEYS`
 * denylist redacts every credential key listed in
 * `CREDENTIAL_FIELDS_BY_RAIL` so the support bundle stays safe out of
 * the box; future per-OS keychain integration is the  lane.
 *
 * Multi-tenant: every read / write scopes by `ctx.tenantId`. There is
 * no global storage of payment credentials.
 *
 * @module trpc/routers/payments-settings
 */

import { eq } from 'drizzle-orm';

import { tenants, type PaymentRailId } from '../../db/schema.js';
import type { DatabaseInstance } from '../../db/index.js';
import { throwServerError } from '../../lib/errorCodes.js';
import type { PaymentRailValidationResult } from '../../services/payments/contracts.js';
import {
  mergePaymentRailCredentialsIntoTenantSettings,
  projectRailCredentials,
  readPaymentRailCredentials,
  type PaymentRailCredentialView,
} from '../../services/payments/credentials.js';
import {
  CREDENTIAL_FIELDS_BY_RAIL,
  PAYMENT_RAIL_IDS,
  PAYMENT_RAILS_MANIFEST,
} from '../../services/payments/manifest.js';
import { getPaymentRailAdapter } from '../../services/payments/registry.js';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { updatePaymentRailSettingsInput } from '../schemas/payments.js';

async function readTenantSettings(
  db: DatabaseInstance,
  tenantId: string
): Promise<Record<string, unknown>> {
  const row = await db
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .get();
  return (row?.settings ?? {}) as Record<string, unknown>;
}

export interface PaymentRailSettingsEntry {
  railId: PaymentRailId;
  label: string;
  countryFocus: readonly string[];
  liveIntegration: boolean;
  credentials: PaymentRailCredentialView[];
  validation: PaymentRailValidationResult;
}

async function buildRailEntry(
  railId: PaymentRailId,
  tenantId: string,
  settings: Record<string, unknown>
): Promise<PaymentRailSettingsEntry> {
  const manifest = PAYMENT_RAILS_MANIFEST[railId];
  const adapter = getPaymentRailAdapter(railId);
  const credentials = projectRailCredentials(railId, readPaymentRailCredentials(settings, railId));
  const validation: PaymentRailValidationResult = adapter.validateConfig
    ? await adapter.validateConfig({ tenantId, settings })
    : { ok: true, issues: [] };
  return {
    railId,
    label: manifest.label,
    countryFocus: manifest.countryFocus,
    liveIntegration: manifest.liveIntegration,
    credentials,
    validation,
  };
}

export const paymentSettingsRouter = router({
  /**
   * Full readiness snapshot for every rail in one call. Mirror-
   * structural with `fiscalSettings.getByCountry` — the frontend
   * hydrates the entire admin card without a per-rail round-trip.
   */
  getAll: adminProcedure.query(async ({ ctx }) => {
    const settings = await readTenantSettings(ctx.db, ctx.tenantId);
    const rails: PaymentRailSettingsEntry[] = [];
    for (const railId of PAYMENT_RAIL_IDS) {
      rails.push(await buildRailEntry(railId, ctx.tenantId, settings));
    }
    return { rails };
  }),

  /**
   * Patch the stored credentials for one rail. Undeclared keys throw
   * `PAYMENT_CREDENTIAL_UNKNOWN_FIELD`; empty-string values clear the
   * stored field. Re-runs `validateConfig` post-write so the response
   * carries fresh readiness without a second query.
   */
  updateRail: adminProcedure
    .input(updatePaymentRailSettingsInput)
    .mutation(async ({ ctx, input }) => {
      const declaredKeys = new Set(CREDENTIAL_FIELDS_BY_RAIL[input.railId].map(field => field.key));
      const patch: Record<string, string | null> = {};
      for (const [key, value] of Object.entries(input.credentials)) {
        if (!declaredKeys.has(key)) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'PAYMENT_CREDENTIAL_UNKNOWN_FIELD',
            message: `Field ${key} is not declared for rail ${input.railId}`,
            details: { railId: input.railId, unknownKey: key },
          });
        }
        if (value === undefined) continue;
        patch[key] = value === null ? null : value.trim();
      }

      const settings = await readTenantSettings(ctx.db, ctx.tenantId);
      const nextSettings = mergePaymentRailCredentialsIntoTenantSettings(
        settings,
        input.railId,
        patch
      );
      await ctx.db
        .update(tenants)
        .set({ settings: nextSettings, updatedAt: new Date().toISOString() })
        .where(eq(tenants.id, ctx.tenantId));

      const entry = await buildRailEntry(input.railId, ctx.tenantId, nextSettings);
      return { ok: true as const, rail: entry };
    }),
});

export type PaymentSettingsRouter = typeof paymentSettingsRouter;
