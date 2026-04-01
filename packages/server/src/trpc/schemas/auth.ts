/**
 * Auth Zod Schemas
 *
 * Input/output validation schemas for auth tRPC procedures
 *
 * @module trpc/schemas/auth
 */

import { z } from 'zod';

// ============================================================================
// Input Schemas
// ============================================================================

export const loginInput = z.object({
  email: z.string().min(3, 'Email must be at least 3 characters'),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordInput = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(12, 'Password must be at least 12 characters'),
});

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
