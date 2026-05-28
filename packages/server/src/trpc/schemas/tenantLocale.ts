/**
 * Zod schemas for the `tenantLocale` tRPC router (ENG-017).
 */

import { z } from 'zod';

export const updateTenantLocaleInput = z.object({
  // ENG-177a — optimistic-concurrency token. Optional because the first
  // save creates the row (no prior version); supplied on every subsequent
  // edit so a stale overwrite is rejected with STALE_VERSION.
  version: z.number().int().nonnegative().optional(),
  countryCode: z
    .string()
    .trim()
    .length(2, 'Country code must be an ISO 3166-1 alpha-2 code')
    .toUpperCase(),
  localeOverride: z
    .string()
    .trim()
    .min(2)
    .max(12)
    .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/, 'Locale must be a BCP-47 tag (e.g. es-CO)')
    .nullable()
    .optional(),
  currencyOverride: z
    .string()
    .trim()
    .length(3, 'Currency code must be an ISO 4217 alpha-3 code')
    .toUpperCase()
    .nullable()
    .optional(),
  timezoneOverride: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .nullable()
    .optional(),
  firstDayOfWeekOverride: z
    .number()
    .int()
    .min(0)
    .max(6)
    .nullable()
    .optional(),
});

export type UpdateTenantLocaleInput = z.infer<typeof updateTenantLocaleInput>;
