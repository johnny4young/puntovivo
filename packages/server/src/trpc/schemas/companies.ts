import { z } from 'zod';
import { emailField } from './common.js';
import { isUrlSchemeBlocked } from '../../lib/urlSafety.js';

export const upsertCompanyInput = z.object({
  name: z.string().min(1, 'Company name is required').max(255),
  taxId: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  // ENG-169 — normalise (trim + lowercase) like every other email field.
  email: emailField('Invalid email address').nullable().optional(),
  logoId: z.string().nullable().optional(),
  // ENG-169 — block dangerous URL schemes (javascript:, data:text/html,
  // …) at the schema boundary; https + data:image stay allowed.
  logoUrl: z
    .string()
    .url('Invalid logo URL')
    .refine(value => !isUrlSchemeBlocked(value), {
      message: 'URL scheme not permitted',
    })
    .nullable()
    .optional(),
});

export const setCompanyLogoInput = z.object({
  logoId: z.string().nullable(),
});

export type UpsertCompanyInput = z.infer<typeof upsertCompanyInput>;
