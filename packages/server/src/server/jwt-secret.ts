/**
 * JWT-secret strength policy + secret generation.
 *
 * Store Hub hardening: a `site_hub` boot refuses an
 * auto-generated, weak, or placeholder JWT secret because the embedded
 * Fastify becomes reachable to every cashier terminal on the LAN. These
 * pure predicates classify a candidate secret; `createServer`'s config
 * resolution consumes them. `generateSecret` mints the auto-generated
 * fallback for device_local boots.
 *
 * @module server/jwt-secret
 */

import { randomBytes } from 'node:crypto';

const SITE_HUB_JWT_SECRET_MIN_LENGTH = 32;
const SITE_HUB_JWT_SECRET_MIN_UNIQUE_CHARS = 8;
const BLOCKED_JWT_SECRET_PLACEHOLDERS = [
  'admin',
  'changeme',
  'development',
  'devsecret',
  'jwtsecret',
  'localhost',
  'password',
  'puntovivo',
  'secret',
  'testsecret',
  'testsecretnonempty',
  'testsecretmustbenonempty',
  '12345678901234567890123456789012',
] as const;

function normalizeJwtSecretForPolicy(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isPlaceholderJwtSecret(value: string): boolean {
  const normalized = normalizeJwtSecretForPolicy(value);
  if (normalized.length === 0) return true;

  return BLOCKED_JWT_SECRET_PLACEHOLDERS.some(placeholder => {
    if (normalized === placeholder) return true;
    const repeated = placeholder.repeat(Math.ceil(normalized.length / placeholder.length));
    return repeated.slice(0, normalized.length) === normalized;
  });
}

export function getSiteHubJwtSecretPolicyFailures(secret: string | undefined): string[] {
  if (secret === undefined || secret.length === 0) return ['JWT_SECRET'];

  const failures: string[] = [];
  if (secret.length < SITE_HUB_JWT_SECRET_MIN_LENGTH) {
    failures.push(`minimum ${SITE_HUB_JWT_SECRET_MIN_LENGTH} characters`);
  }
  if (new Set(secret).size < SITE_HUB_JWT_SECRET_MIN_UNIQUE_CHARS) {
    failures.push(`at least ${SITE_HUB_JWT_SECRET_MIN_UNIQUE_CHARS} unique characters`);
  }
  if (isPlaceholderJwtSecret(secret)) {
    failures.push('not a common placeholder');
  }
  return failures;
}

export function describeSiteHubJwtSecretRequirement(failures: string[]): string {
  if (failures.length === 1 && failures[0] === 'JWT_SECRET') return 'JWT_SECRET';
  return `strong JWT_SECRET (${failures.join('; ')})`;
}

/**
 * Generate a cryptographically secure random JWT secret
 */
export function generateSecret(): string {
  // Use crypto.randomBytes for cryptographically secure random generation
  return randomBytes(32).toString('base64');
}
