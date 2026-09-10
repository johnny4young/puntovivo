import { z } from 'zod';
import { VERTICAL_PRESET_IDS } from '@puntovivo/shared/vertical-presets';
import { strongPasswordSchema } from './auth.js';
import { emailField } from './common.js';

/** One-time local installation claim; no user-selected tenant identity or privilege. */
export const completeInstallationInput = z
  .object({
    token: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{64}$/i)
      .transform(value => value.toLowerCase()),
    ownerName: z.string().trim().min(1).max(120),
    email: emailField('Invalid email address').pipe(z.string().max(254)),
    password: strongPasswordSchema.pipe(z.string().max(128)),
    businessName: z.string().trim().min(1).max(120),
    siteName: z.string().trim().min(1).max(120),
    countryCode: z.string().regex(/^[A-Z]{2}$/),
    presetId: z.enum(VERTICAL_PRESET_IDS),
  })
  .strict();

/** Validated claim data; plaintext credentials exist only until hashing/login. */
export type CompleteInstallationInput = z.infer<typeof completeInstallationInput>;
