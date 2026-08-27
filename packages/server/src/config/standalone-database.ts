/**
 * Standalone database-encryption policy.
 *
 * Electron obtains its key from safeStorage. The standalone runtime has no OS
 * keychain adapter, so production-like deployments must provide the same
 * 32-byte raw key explicitly through PUNTOVIVO_DB_KEY. Only an explicitly
 * development/test runtime (or the unset local-development default) may open a
 * file-backed database without SQLCipher.
 */

import { assertEncryptionKeyShape } from '../db/options.js';

export const MISSING_STANDALONE_DB_KEY_ERROR =
  'PUNTOVIVO_DB_KEY is required for standalone startup outside development/test. ' +
  'Set a 64-character hexadecimal SQLCipher key; refusing to create or open a cleartext production database.';

export const INVALID_STANDALONE_DB_KEY_ERROR =
  'PUNTOVIVO_DB_KEY must be a 64-character hexadecimal SQLCipher key (32 raw bytes).';

function allowsStandaloneCleartext(env: NodeJS.ProcessEnv): boolean {
  const declaredEnvironments = [env.NODE_ENV, env.PUNTOVIVO_RUNTIME_ENV].filter(
    (value): value is string => value !== undefined
  );
  if (declaredEnvironments.length === 0) return true;
  return declaredEnvironments.every(value => value === 'development' || value === 'test');
}

/**
 * Resolve and validate the only key accepted by standalone startup.
 *
 * A production declaration in either environment variable wins over a
 * conflicting development/test declaration. Unknown environment names are
 * production-like and therefore fail closed when the key is absent.
 */
export function resolveStandaloneEncryptionKey(
  env: NodeJS.ProcessEnv = process.env
): string | undefined {
  const key = env.PUNTOVIVO_DB_KEY;
  if (key !== undefined) {
    try {
      assertEncryptionKeyShape(key);
    } catch (cause) {
      throw new Error(INVALID_STANDALONE_DB_KEY_ERROR, { cause });
    }
    return key;
  }

  if (!allowsStandaloneCleartext(env)) {
    throw new Error(MISSING_STANDALONE_DB_KEY_ERROR);
  }
  return undefined;
}
