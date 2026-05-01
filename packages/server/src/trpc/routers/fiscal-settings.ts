/**
 * ENG-035a — Admin router de `fiscal.settings.*`.
 *
 * Dos procedures:
 *
 * - `getByCountry({ countryCode })` — devuelve la lectura
 *   normalizada del namespace `tenants.settings.fiscal.<country>`
 *   más el resultado de `validateConfig` del adapter activo. La
 *   shape del campo de settings depende del país: para MX trae
 *   `{ enabled, rfc, regimenFiscalCode, lugarExpedicion,
 *   environment }`; para CO/CL la proyección es mínima por ahora
 *   (la UI de cada país llega con su ticket — ENG-035c migra CO,
 *   ENG-036 trae CL).
 * - `updateMx(...)` — patch parcial sobre
 *   `tenants.settings.fiscal.mx`. Valida server-side que el RFC
 *   pase `validateRfc` y que `regimenFiscalCode` esté en el
 *   catálogo SAT antes de persistir. Re-corre `validateConfig`
 *   después del write para que la respuesta incluya el readiness
 *   actualizado — la card del frontend evita un round-trip extra.
 *
 * Multi-tenant: ambos procedures usan `adminProcedure` y scopean
 * por `ctx.tenantId`. Cero queries nuevas que escapen el scope.
 *
 * @module trpc/routers/fiscal-settings
 */

import { eq } from 'drizzle-orm';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { tenants } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { getFiscalAdapter } from '../../services/fiscal/registry.js';
import { findRegimenFiscal } from '../../services/fiscal/packs/mx/catalogs/index.js';
import { validateRfc } from '../../services/fiscal/packs/mx/rfc.js';
import {
  buildMxFiscalSettingsPatch,
  mergeMxFiscalSettingsIntoTenantSettings,
  readMxFiscalSettings,
  type MxFiscalSettings,
} from '../../services/fiscal/packs/mx/settings.js';
import {
  getFiscalSettingsInput,
  updateMxFiscalSettingsInput,
} from '../schemas/fiscalSettings.js';
import type { DatabaseInstance } from '../../db/index.js';

/**
 * Lee `tenants.settings` como un blob plano (record). Centralizado
 * acá para evitar que cada procedure repita el cast.
 */
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

export const fiscalSettingsRouter = router({
  /**
   * Lectura por país. La shape del campo `settings` cambia según
   * `countryCode` — discriminada por la propia constante para que
   * el frontend pueda hacer narrowing.
   */
  getByCountry: adminProcedure
    .input(getFiscalSettingsInput)
    .query(async ({ ctx, input }) => {
      const tenantSettings = await readTenantSettings(ctx.db, ctx.tenantId);
      const adapter = getFiscalAdapter(input.countryCode);
      const validation = await adapter.validateConfig({
        tenantId: ctx.tenantId,
        countryCode: input.countryCode,
        settings: tenantSettings,
      });

      if (input.countryCode === 'MX') {
        const mx = readMxFiscalSettings(tenantSettings);
        return {
          countryCode: 'MX' as const,
          settings: mx,
          validation,
          providerId: adapter.providerId,
          notImplemented:
            (adapter as { notImplemented?: boolean }).notImplemented ?? false,
          availableInTicket:
            (adapter as { availableInTicket?: string }).availableInTicket ?? null,
        };
      }

      // CO + CL: proyección mínima por ahora — los settings completos
      // llegan con sus tickets (ENG-035c para CO, ENG-036 para CL).
      return {
        countryCode: input.countryCode,
        settings: null,
        validation,
        providerId: adapter.providerId,
        notImplemented:
          (adapter as { notImplemented?: boolean }).notImplemented ?? false,
        availableInTicket:
          (adapter as { availableInTicket?: string }).availableInTicket ?? null,
      };
    }),

  /**
   * Patch parcial sobre `tenants.settings.fiscal.mx`. Sólo persiste
   * los campos que el caller especifica; el resto del blob se
   * preserva. RFC y régimen se validan server-side antes del write
   * para no dejar configs inválidas persistidas.
   */
  updateMx: adminProcedure
    .input(updateMxFiscalSettingsInput)
    .mutation(async ({ ctx, input }) => {
      // Validación de RFC: si vino en el patch y NO es null, debe
      // pasar el validador SAT. `null` significa "borrar" y se
      // permite (el operador puede limpiar el campo).
      if (input.rfc !== undefined && input.rfc !== null) {
        const result = validateRfc(input.rfc);
        if (!result.ok) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'FISCAL_RFC_INVALID',
            message: result.message,
            details: { code: result.code, field: 'fiscal.mx.rfc' },
          });
        }
      }

      // Validación de régimen: si vino en el patch y NO es null,
      // debe existir en el catálogo SAT del pack.
      if (
        input.regimenFiscalCode !== undefined &&
        input.regimenFiscalCode !== null &&
        !findRegimenFiscal(input.regimenFiscalCode)
      ) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'FISCAL_REGIMEN_INVALID',
          message: `El régimen fiscal ${input.regimenFiscalCode} no existe en el catálogo SAT.`,
          details: { code: input.regimenFiscalCode, field: 'fiscal.mx.regimenFiscalCode' },
        });
      }

      // Persistencia: lee el blob actual, aplica el patch en la
      // rama fiscal.mx, y reescribe el blob completo (Drizzle no
      // tiene JSON_PATCH nativo en SQLite). El merge es inmutable
      // y respeta otras ramas (fiscal.co, fiscal.cl, ai, etc.).
      const tenantSettings = await readTenantSettings(ctx.db, ctx.tenantId);
      const partial: Partial<MxFiscalSettings> = {};
      if (input.enabled !== undefined) partial.enabled = input.enabled;
      if (input.rfc !== undefined) {
        partial.rfc =
          input.rfc === null ? null : validateRfc(input.rfc).ok && input.rfc
            ? // Normalizamos a uppercase antes de persistir — el
              // validador ya hizo trim + uppercase en la check.
              (validateRfc(input.rfc) as { normalized: string }).normalized
            : input.rfc;
      }
      if (input.regimenFiscalCode !== undefined) {
        partial.regimenFiscalCode = input.regimenFiscalCode;
      }
      if (input.lugarExpedicion !== undefined) {
        partial.lugarExpedicion = input.lugarExpedicion;
      }
      if (input.environment !== undefined) {
        partial.environment = input.environment;
      }

      const patch = buildMxFiscalSettingsPatch(partial);
      const nextSettings = mergeMxFiscalSettingsIntoTenantSettings(
        tenantSettings,
        patch
      );

      await ctx.db
        .update(tenants)
        .set({ settings: nextSettings, updatedAt: new Date().toISOString() })
        .where(eq(tenants.id, ctx.tenantId));

      // Re-correr validateConfig contra el blob recién persistido
      // para que la respuesta lleve el readiness fresco — la card
      // del frontend usa esto para pintar el badge sin segundo
      // round-trip.
      const adapter = getFiscalAdapter('MX');
      const validation = await adapter.validateConfig({
        tenantId: ctx.tenantId,
        countryCode: 'MX',
        settings: nextSettings,
      });

      return {
        ok: true as const,
        settings: readMxFiscalSettings(nextSettings),
        validation,
      };
    }),
});
