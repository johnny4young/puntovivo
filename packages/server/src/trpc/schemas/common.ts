/**
 * Common Zod Schemas
 *
 * Reusable input schemas for pagination, sorting, and ID lookups.
 *
 * @module trpc/schemas/common
 */

import { z } from 'zod';

export const paginationInput = z.object({
  page: z.number().int().min(1).default(1),
  perPage: z.number().int().min(1).max(200).default(50),
});

export const idInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const searchInput = z.object({
  q: z.string().min(1, 'Search query is required'),
});

/** Shared sync queue helper — passed a db transaction or regular db */
export const syncOperationEnum = z.enum(['create', 'update', 'delete']);

export type PaginationInput = z.infer<typeof paginationInput>;
export type IdInput = z.infer<typeof idInput>;

/**
 * Canonical email field — .
 *
 * Every schema that accepts a user-supplied email must use this helper
 * so we get a consistent surface:
 *
 * - `.email()` rejects malformed input at the parse boundary (when the
 * caller opts into strict mode — default).
 * - `.trim()` + `.toLowerCase()` in a `.transform()` normalises whitespace
 * and case before the value reaches a DB query. Without this, two
 * operators could register `Admin@x.com` and `admin@x.com` as
 * different accounts (and future SSO / IdP mappings would fail).
 *
 * Pass `{ strict: false }` for login-like inputs that historically
 * accepted user-or-email strings (e.g. the seeded `admin@localhost`
 * which Zod's `.email()` regex rejects but the legacy schema admitted).
 */
export function emailField(
  invalidMessage = 'Invalid email address',
  options: { strict?: boolean } = {}
) {
  const strict = options.strict ?? true;
  const transformed = z
    .string()
    .min(3)
    .transform(value => value.trim().toLowerCase());
  if (!strict) {
    return transformed;
  }
  return transformed.pipe(z.string().email(invalidMessage));
}
