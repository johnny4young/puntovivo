/**
 * ENG-035a + ENG-036a — Admin router de `fiscal.settings.*`.
 *
 * Tres procedures:
 *
 * - `getByCountry({ countryCode })` — devuelve la lectura
 *   normalizada del namespace `tenants.settings.fiscal.<country>`
 *   más el resultado de `validateConfig` del adapter activo. La
 *   shape del campo de settings depende del país: para MX trae
 *   `{ enabled, rfc, regimenFiscalCode, lugarExpedicion,
 *   environment }`; para CL trae `{ enabled, rut, giroCode,
 *   comunaCode, casaMatriz, environment }`; para CO trae
 *   `{ enabled, nit, dianResolutionNumber, prefix, rangeFrom,
 *   rangeTo, environment }` con readiness de presencia.
 * - `updateMx(...)` — patch parcial sobre
 *   `tenants.settings.fiscal.mx`. Valida RFC + régimen contra el
 *   catálogo SAT.
 * - `updateCl(...)` — patch parcial sobre
 *   `tenants.settings.fiscal.cl`. Valida RUT (algoritmo SII) +
 *   giro contra catálogo CIIU.cl.
 *
 * Los updates re-corren su readiness post-write para que la respuesta
 * lleve el estado fresco — la card del frontend evita un round-trip
 * extra.
 *
 * Multi-tenant: las procedures usan `adminProcedure` y
 * scopean por `ctx.tenantId`. Cero queries que escapen el scope.
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
import { findGiroComercial } from '../../services/fiscal/packs/cl/catalogs/index.js';
import { validateRut } from '../../services/fiscal/packs/cl/rut.js';
import {
  buildClFiscalSettingsPatch,
  mergeClFiscalSettingsIntoTenantSettings,
  readClFiscalSettings,
  type ClFiscalSettings,
} from '../../services/fiscal/packs/cl/settings.js';
import { peekActiveCaf } from '../../services/fiscal/packs/cl/caf-allocator.js';
import {
  mergeCoFiscalSettingsIntoTenantSettings,
  readCoFiscalSettings,
  validateCoFiscalConfig,
  type CoFiscalSettingsPatch,
} from '../../services/fiscal/packs/co/settings.js';
import {
  getActiveCafInput,
  getFiscalSettingsInput,
  updateClFiscalSettingsInput,
  updateCoFiscalSettingsInput,
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

      if (input.countryCode === 'CL') {
        // ENG-036a — desempaca settings CL del namespace
        // `tenants.settings.fiscal.cl.*` para que el frontend
        // hidrate el form sin un segundo round-trip.
        const cl = readClFiscalSettings(tenantSettings);
        return {
          countryCode: 'CL' as const,
          settings: cl,
          validation,
          providerId: adapter.providerId,
          notImplemented:
            (adapter as { notImplemented?: boolean }).notImplemented ?? false,
          availableInTicket:
            (adapter as { availableInTicket?: string }).availableInTicket ?? null,
        };
      }

      // CO (ENG-184): real settings projection + presence-based
      // readiness. The mock adapter's `validateConfig` is always-ok (it
      // owns CUFE/transmission validation, deferred to ENG-021); for the
      // config card we surface a PRESENCE probe instead so the badge is
      // honest about whether NIT / resolution / numbering are captured.
      const co = readCoFiscalSettings(tenantSettings);
      return {
        countryCode: 'CO' as const,
        settings: co,
        validation: validateCoFiscalConfig(co),
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

  /**
   * ENG-036a — Patch parcial sobre `tenants.settings.fiscal.cl`.
   * Espejo de `updateMx`: valida server-side el RUT (algoritmo
   * SII) + el giro contra el catálogo CIIU.cl, persiste, y
   * re-corre `validateConfig` para que la respuesta lleve el
   * readiness fresco.
   */
  updateCl: adminProcedure
    .input(updateClFiscalSettingsInput)
    .mutation(async ({ ctx, input }) => {
      // Validación de RUT: si vino en el patch y NO es null, debe
      // pasar el validador SII. `null` significa "borrar" y se
      // permite (el operador puede limpiar el campo).
      if (input.rut !== undefined && input.rut !== null) {
        const result = validateRut(input.rut);
        if (!result.ok) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'FISCAL_RUT_INVALID',
            message: result.message,
            details: { code: result.code, field: 'fiscal.cl.rut' },
          });
        }
      }

      // Validación de giro: si vino en el patch y NO es null, debe
      // existir en el catálogo CIIU.cl curado. Reusamos el code
      // FISCAL_REGIMEN_INVALID porque cubre semánticamente "el
      // catálogo rechazó el código de actividad económica del
      // emisor" (mismo concepto que régimen en MX).
      if (
        input.giroCode !== undefined &&
        input.giroCode !== null &&
        !findGiroComercial(input.giroCode)
      ) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'FISCAL_REGIMEN_INVALID',
          message: `El giro ${input.giroCode} no existe en el catálogo CIIU.cl.`,
          details: { code: input.giroCode, field: 'fiscal.cl.giroCode' },
        });
      }

      // Persistencia: lee el blob actual, aplica el patch en la
      // rama fiscal.cl, y reescribe el blob completo (preserva
      // fiscal.mx, fiscal_dian_enabled, ai, etc.).
      const tenantSettings = await readTenantSettings(ctx.db, ctx.tenantId);
      const partial: Partial<ClFiscalSettings> = {};
      if (input.enabled !== undefined) partial.enabled = input.enabled;
      if (input.rut !== undefined) {
        partial.rut =
          input.rut === null
            ? null
            : (validateRut(input.rut) as { normalized: string }).normalized;
      }
      if (input.giroCode !== undefined) partial.giroCode = input.giroCode;
      if (input.comunaCode !== undefined) partial.comunaCode = input.comunaCode;
      if (input.casaMatriz !== undefined) {
        partial.casaMatriz =
          input.casaMatriz === null ? null : input.casaMatriz.trim();
      }
      if (input.environment !== undefined) {
        partial.environment = input.environment;
      }

      const patch = buildClFiscalSettingsPatch(partial);
      const nextSettings = mergeClFiscalSettingsIntoTenantSettings(
        tenantSettings,
        patch
      );

      await ctx.db
        .update(tenants)
        .set({ settings: nextSettings, updatedAt: new Date().toISOString() })
        .where(eq(tenants.id, ctx.tenantId));

      // Re-corre validateConfig contra el blob recién persistido.
      const adapter = getFiscalAdapter('CL');
      const validation = await adapter.validateConfig({
        tenantId: ctx.tenantId,
        countryCode: 'CL',
        settings: nextSettings,
      });

      return {
        ok: true as const,
        settings: readClFiscalSettings(nextSettings),
        validation,
      };
    }),

  /**
   * ENG-184 — Patch parcial sobre la config fiscal de Colombia. El
   * switch maestro `enabled` se persiste en el flag legacy
   * `tenants.settings.fiscal_dian_enabled` (leído por el orchestrator
   * de emisión + readiness); los campos del emisor van a
   * `tenants.settings.fiscal.co.*`. Valida el NIT y el orden del rango
   * antes de escribir, y devuelve un readiness de presencia fresco
   * (no cripto — la transmisión real sigue gated en ENG-021).
   */
  updateCo: adminProcedure
    .input(updateCoFiscalSettingsInput)
    .mutation(async ({ ctx, input }) => {
      // NIT: 9-10 dígitos con dígito de verificación opcional. `null`
      // significa "borrar" y se permite. `undefined` = no tocar.
      if (input.nit !== undefined && input.nit !== null) {
        const CO_NIT_PATTERN = /^\d{9,10}(-?\d)?$/u;
        if (!CO_NIT_PATTERN.test(input.nit.trim())) {
          throwServerError({
            trpcCode: 'BAD_REQUEST',
            errorCode: 'FISCAL_NIT_INVALID',
            message: `El NIT ${input.nit} no tiene un formato válido (9-10 dígitos con dígito de verificación opcional).`,
            details: { field: 'fiscal.co.nit' },
          });
        }
      }

      // Persistencia: lee el blob actual, aplica el patch en la rama
      // fiscal.co + el flag legacy, y reescribe el blob completo
      // (preserva fiscal.mx, fiscal.cl, ai, modules, etc.).
      const tenantSettings = await readTenantSettings(ctx.db, ctx.tenantId);
      const partial: CoFiscalSettingsPatch = {};
      if (input.enabled !== undefined) partial.enabled = input.enabled;
      if (input.nit !== undefined) {
        partial.nit = input.nit === null ? null : input.nit.trim();
      }
      if (input.dianResolutionNumber !== undefined) {
        partial.dianResolutionNumber =
          input.dianResolutionNumber === null
            ? null
            : input.dianResolutionNumber.trim();
      }
      if (input.prefix !== undefined) {
        partial.prefix =
          input.prefix === null ? null : input.prefix.trim().toUpperCase();
      }
      if (input.rangeFrom !== undefined) partial.rangeFrom = input.rangeFrom;
      if (input.rangeTo !== undefined) partial.rangeTo = input.rangeTo;
      if (input.environment !== undefined) partial.environment = input.environment;

      const nextSettings = mergeCoFiscalSettingsIntoTenantSettings(
        tenantSettings,
        partial
      );
      const nextCo = readCoFiscalSettings(nextSettings);

      // Orden del rango: valida sobre el resultado mergeado, de modo
      // que un patch que sólo toca un extremo se valide contra el otro
      // ya almacenado.
      if (
        nextCo.rangeFrom !== null &&
        nextCo.rangeTo !== null &&
        nextCo.rangeFrom > nextCo.rangeTo
      ) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'FISCAL_NUMBERING_RANGE_INVALID',
          message: `El rango de numeración ${nextCo.rangeFrom}-${nextCo.rangeTo} es inválido: el consecutivo inicial no puede ser mayor que el final.`,
          details: { field: 'fiscal.co.rangeFrom' },
        });
      }

      await ctx.db
        .update(tenants)
        .set({ settings: nextSettings, updatedAt: new Date().toISOString() })
        .where(eq(tenants.id, ctx.tenantId));

      return {
        ok: true as const,
        settings: nextCo,
        validation: validateCoFiscalConfig(nextCo),
      };
    }),

  /**
   * ENG-036b — Read-only CAF lookup. Surface the admin tab consumes
   * to render "folios disponibles" without mutating cursor state.
   * Returns null when the country is not CL (or the country has no
   * CAF concept) — keeps the response shape stable across countries.
   */
  getActiveCaf: adminProcedure
    .input(getActiveCafInput)
    .query(({ ctx, input }) => {
      if (input.countryCode !== 'CL') {
        return { caf: null };
      }
      const caf = peekActiveCaf(ctx.db, ctx.tenantId, input.tipoDte);
      return { caf };
    }),
});
