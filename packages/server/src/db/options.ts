/**
 * Database options + boot-time option validation (leaf).
 *
 * The `DatabaseOptions` contract that `initDatabase()` accepts, plus the
 * three pure validators/resolvers it runs before opening the connection.
 * Kept free of any connection state so `connection.ts` can import these
 * without a cycle.
 *
 * @module db/options
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5000;

// ENG-002 — versioned Drizzle migrations live next to this module. Resolved
// lazily so `import.meta.url` is only touched in ESM contexts (standalone
// server, tests). The Electron main process always passes an explicit
// `migrationsFolder`, because Vite bundles this file into CJS where
// `import.meta.url` evaluates to `undefined` and would crash at module load.
export function getDefaultMigrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');
}

export interface DatabaseOptions {
  // ENG-179b — explicit `| undefined` on every optional field so
  // callers can forward `ServerOptions.X` (which carry
  // explicit-undefined under `exactOptionalPropertyTypes`) cleanly.
  /** Path to the SQLite database file */
  dbPath: string;
  /** Whether to run migrations on startup (default: true) */
  runMigrations?: boolean | undefined;
  /** Whether to seed default data if database is empty (default: true) */
  seedData?: boolean | undefined;
  /** Enable verbose logging (default: false) */
  verbose?: boolean | undefined;
  /**
   * SQLite writer-lock wait in milliseconds. Defaults to the ENG-174
   * production floor. High-contention harnesses may raise this so
   * parallel fixture writers do not surface transient `database is locked`
   * errors as operator-facing sale failures.
   */
  sqliteBusyTimeoutMs?: number | undefined;
  /**
   * Override the folder that holds the generated Drizzle SQL files +
   * `meta/_journal.json`. Defaults to the `migrations/` directory adjacent
   * to this compiled module (valid for dev, tests, and the standalone
   * server). Packaged Electron builds must pass an explicit path because
   * Vite bundles the server into a single `.cjs` and the `.sql` assets
   * ship separately via Forge `extraResource`.
   */
  migrationsFolder?: string | undefined;
  /**
   * ENG-167 — 64-char hex string (32 raw bytes) used as the SQLCipher
   * page-encryption key. When supplied, the runtime issues
   * `PRAGMA cipher='sqlcipher'`, `PRAGMA legacy=4`, and `PRAGMA key`
   * immediately after the native `Database` constructor and before any
   * other PRAGMA, so the on-disk file is unreadable without it. The
   * SQLCipher mode is selected via
   * SQLite3MultipleCiphers' `cipher='sqlcipher'` + `legacy=4` pragmas.
   * When omitted (tests, the standalone
   * `dev:server`), the database opens in cleartext for backwards-compat
   * with pre-encryption installs and existing fixtures. The key is
   * forwarded from Electron `safeStorage` (see
   * `apps/desktop/src/main/db-key-store.ts`); the standalone server
   * accepts `process.env.PUNTOVIVO_DB_KEY` for parity testing.
   *
   * Has no effect when `dbPath === ':memory:'` — the SQLCipher fork
   * rejects `PRAGMA key` on in-memory or temporary databases
   * (`SqliteError: Setting key not supported for in-memory or temporary databases`),
   * and there is no on-disk surface to protect either way.
   */
  encryptionKey?: string | undefined;
  /**
   * Explicit path to the better-sqlite3 native addon (.node) to load,
   * forwarded to the Database constructor's `nativeBinding` option. When
   * omitted, plain-Node runtimes auto-select the cached Node-ABI artifact
   * (see db/native-binding.ts) so they no longer depend on which ABI the
   * swapped on-disk default currently carries; Electron and packaged
   * builds keep better-sqlite3's default lookup.
   */
  nativeBindingPath?: string | undefined;
}

/**
 * ENG-167 — Validate the SQLCipher key. We accept only the raw-bytes
 * form (`x'<hex64>'`) to keep the boot path KDF-free and to surface
 * obviously-broken keys (truncated hex, accidental passphrase) as a
 * boot-time error instead of a `SQLITE_NOTADB` later when the first
 * `.prepare()` runs.
 */
export function assertEncryptionKeyShape(key: string): void {
  if (!/^[0-9a-f]{64}$/i.test(key)) {
    throw new Error(
      'encryptionKey must be a 64-character hex string (32 raw bytes); reject the safeStorage payload before boot'
    );
  }
}

/**
 * Clamp-validate the SQLite `busy_timeout` (ms) before it reaches the PRAGMA.
 * Defaults to `DEFAULT_SQLITE_BUSY_TIMEOUT_MS` when unset. The `[0, 60000]`
 * bound rejects an accidental seconds value (e.g. `30` meaning 30 s) or a
 * runaway wait: under the single-writer embedded topology a writer blocked
 * longer than a minute is a bug to surface, not a wait to honour.
 */
export function normalizeSqliteBusyTimeoutMs(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SQLITE_BUSY_TIMEOUT_MS;
  }
  if (!Number.isInteger(value) || value < 0 || value > 60_000) {
    throw new Error('sqliteBusyTimeoutMs must be an integer from 0 to 60000 milliseconds');
  }
  return value;
}
