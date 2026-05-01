/**
 * ENG-035a — Schemas de input para `fiscal.settings.*` admin router.
 *
 * Las validaciones de dominio fiscal (RFC válido, régimen presente
 * en catálogo SAT, lugar de expedición de 5 dígitos) viven en el
 * router — el schema sólo tipa la forma del payload y deja al
 * router elegir cuándo levantar `FISCAL_RFC_INVALID` vs
 * `FISCAL_REGIMEN_INVALID`.
 *
 * @module trpc/schemas/fiscalSettings
 */

import { z } from 'zod';

/** Códigos de país soportados por el registry fiscal (ENG-034). */
export const fiscalCountryCodeEnum = z.enum(['CO', 'MX', 'CL']);

export const getFiscalSettingsInput = z.object({
  countryCode: fiscalCountryCodeEnum,
});

/**
 * Input parcial de `fiscal.settings.updateMx`. Sólo los campos
 * presentes se persisten; los ausentes mantienen el valor previo
 * del blob `tenants.settings.fiscal.mx`.
 */
export const updateMxFiscalSettingsInput = z.object({
  enabled: z.boolean().optional(),
  rfc: z.string().trim().min(1).max(13).optional().nullable(),
  regimenFiscalCode: z
    .string()
    .trim()
    .regex(/^\d{3}$/u, 'El régimen fiscal debe ser un código de 3 dígitos')
    .optional()
    .nullable(),
  lugarExpedicion: z
    .string()
    .trim()
    .regex(/^\d{5}$/u, 'El lugar de expedición debe ser un código postal de 5 dígitos')
    .optional()
    .nullable(),
  environment: z.enum(['sandbox', 'production']).optional(),
});

/**
 * ENG-036a — Input parcial de `fiscal.settings.updateCl`. Mismo
 * shape que el de México pero con los campos del SII (RUT, giro
 * CIIU.cl, comuna SUBDERE, casa matriz, ambiente
 * certificacion/produccion).
 */
export const updateClFiscalSettingsInput = z.object({
  enabled: z.boolean().optional(),
  // El validador semántico vive en el router (validateRut). Aquí
  // sólo limitamos longitud razonable: RUT chileno máximo es
  // 99999999-K (10 chars + guión = 11), pero damos margen para
  // formatos con puntos al ingresar (15).
  rut: z.string().trim().min(1).max(15).optional().nullable(),
  giroCode: z.string().trim().min(2).max(10).optional().nullable(),
  comunaCode: z.number().int().positive().optional().nullable(),
  casaMatriz: z.string().trim().min(1).max(200).optional().nullable(),
  environment: z.enum(['certificacion', 'produccion']).optional(),
});

export type GetFiscalSettingsInput = z.infer<typeof getFiscalSettingsInput>;
export type UpdateMxFiscalSettingsInput = z.infer<
  typeof updateMxFiscalSettingsInput
>;
export type UpdateClFiscalSettingsInput = z.infer<
  typeof updateClFiscalSettingsInput
>;
