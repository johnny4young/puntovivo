/**
 * Auth Zod Schemas
 *
 * Input/output validation schemas for auth tRPC procedures
 *
 * @module trpc/schemas/auth
 */

import { z } from 'zod';
import { emailField } from './common.js';
import { STAFF_PIN_PATTERN } from '../../security/staffPins.js';

// ============================================================================
// Input Schemas
// ============================================================================

export const loginInput = z
  .object({
    // login historically accepts `admin@localhost` (no TLD) for the
    // seeded admin account. Normalise to lowercase + trim but skip the
    // strict `.email()` regex so a legacy install can still authenticate.
    email: emailField('Invalid email address', { strict: false }),
    password: z.string().min(1, 'Password is required'),
  })
  .strict();

export const strongPasswordSchema = z.string().superRefine((password, ctx) => {
  const validation = validatePasswordStrength(password);

  if (validation.valid) {
    return;
  }

  for (const error of validation.errors) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: error,
    });
  }
});

export const changePasswordInput = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: strongPasswordSchema,
  })
  .strict();

export const staffPinSchema = z
  .string()
  .regex(STAFF_PIN_PATTERN, 'Staff PIN must contain exactly 6 digits');

export const switchStaffInput = z
  .object({
    targetUserId: z.string().min(1, 'Target user is required'),
    pin: staffPinSchema,
  })
  .strict();

// ============================================================================
// Output Schemas
// ============================================================================

export const authUserOutput = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  role: z.string(),
  tenantId: z.string(),
});

export const authTenantOutput = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});

export const loginOutput = z.object({
  token: z.string(),
  user: authUserOutput,
  tenant: authTenantOutput,
});

export const meOutput = z.object({
  user: z.object({
    id: z.string(),
    email: z.string(),
    name: z.string(),
    role: z.string(),
    tenantId: z.string(),
    isActive: z.boolean().nullable(),
    createdAt: z.string(),
  }),
  tenant: z
    .object({
      id: z.string(),
      name: z.string(),
      slug: z.string(),
      settings: z.record(z.string(), z.unknown()).nullable(),
    })
    .nullable(),
});

export const refreshOutput = z.object({
  token: z.string(),
});

export const successOutput = z.object({
  success: z.boolean(),
  message: z.string(),
});

// ============================================================================
// Password Validation
// ============================================================================

/**
 * Validate password strength
 * Extracted from routes/auth.ts so it can be reused
 */
export function validatePasswordStrength(password: string): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (password.length < 12) {
    errors.push('Password must be at least 12 characters');
  }
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
