/**
 * Password hashing helpers — ENG-166.
 *
 * Pins Argon2 parameters across every call site so a future library bump
 * cannot silently weaken the cost factor. The encoded hash string carries
 * the parameters, so `needsRehash` lets us upgrade existing users lazily
 * on their next successful login.
 *
 * Parameter floor follows OWASP Password Storage Cheat Sheet (2025
 * revision) for argon2id: memoryCost ≥ 47 MiB, timeCost ≥ 3, parallelism
 * ≥ 1. We pin 64 MiB / t=3 / p=4 to leave headroom on the hardware
 * Puntovivo targets (commodity x86 laptops + Apple Silicon).
 *
 * @module security/passwords
 */

import * as argon2 from 'argon2';

const ARGON2_OPTIONS = Object.freeze({
  type: argon2.argon2id,
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const);

/**
 * Hash a password with pinned Argon2 parameters.
 */
export async function hashPasswordSecurely(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, ARGON2_OPTIONS);
}

/**
 * Verify a plaintext password against a stored Argon2 hash. Returns
 * `false` (not throw) on any malformed-hash failure so callers can fall
 * back to the same "invalid credentials" branch they already use.
 */
export async function verifyPasswordSecurely(
  storedHash: string,
  plaintext: string
): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, plaintext);
  } catch {
    return false;
  }
}

/**
 * Return `true` when the stored hash was produced with weaker parameters
 * than the current pinned options and should be re-hashed on next
 * successful login. Falls back to `true` on parser failure so a broken
 * encoded string triggers a rehash rather than crashing the login flow.
 */
export function needsRehash(storedHash: string): boolean {
  try {
    return argon2.needsRehash(storedHash, ARGON2_OPTIONS);
  } catch {
    return true;
  }
}

/**
 * Cached dummy hash used by `auth.login` to equalise response time when
 * the requested email does not exist. Generated once on first access
 * (and pre-warmed by `warmUpPasswordSecurity()` during server boot) so
 * an attacker cannot distinguish "user exists" vs "user does not exist"
 * via response timing.
 *
 * The plaintext below is a static sentinel that no real login attempt
 * would submit; even if one did, the surrounding caller still rejects
 * the request because the user row was absent.
 */
const DUMMY_PLAINTEXT = 'puntovivo:eng-166:dummy:do-not-use-as-password';
let dummyHashPromise: Promise<string> | null = null;

export function getDummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash(DUMMY_PLAINTEXT, ARGON2_OPTIONS);
  }
  return dummyHashPromise;
}

/**
 * Pre-compute the dummy hash so the first not-found login attempt does
 * not pay an extra ~50-100ms (which would itself be a small timing
 * leak). Called from `createServer` during boot; safe to call
 * repeatedly because the underlying promise is memoised.
 */
export async function warmUpPasswordSecurity(): Promise<void> {
  await getDummyPasswordHash();
}

export const ARGON2_PINNED_OPTIONS = ARGON2_OPTIONS;
