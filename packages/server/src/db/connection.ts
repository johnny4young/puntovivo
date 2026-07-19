/**
 * Database connection lifecycle.
 *
 * Opens the better-sqlite3 + Drizzle handle, applies the SQLCipher /
 * WAL / ENG-174 PRAGMA cluster, runs versioned migrations (with the
 * ENG-002 adoption shim + ENG-177c integrity gates), seeds catalogs +
 * default data, and owns the process-wide `db` / `sqlite` singletons.
 *
 * @module db/connection
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createModuleLogger } from '../logging/logger.js';
import { seedCatalogs } from './catalog-seed.js';
import { type DrizzleJournal, ensureMigrationBaseline } from './migration-baseline.js';
import { resolveCachedNodeBinding } from './native-binding.js';
import {
  assertEncryptionKeyShape,
  type DatabaseOptions,
  getDefaultMigrationsFolder,
  normalizeSqliteBusyTimeoutMs,
} from './options.js';
import { assertSchemaNotNewerThanApp } from './schema-downgrade-guard.js';
import * as schema from './schema.js';
import { seedDefaultData } from './seed.js';
import type { DatabaseInstance } from './types.js';

const dbLog = createModuleLogger('db');

let db: DatabaseInstance | null = null;
let sqlite: Database.Database | null = null;

/**
 * Initialize the database connection
 */
export async function initDatabase(options: DatabaseOptions): Promise<DatabaseInstance>;
export async function initDatabase(dbPath: string): Promise<DatabaseInstance>;
export async function initDatabase(
  optionsOrPath: DatabaseOptions | string
): Promise<DatabaseInstance> {
  const options = typeof optionsOrPath === 'string' ? { dbPath: optionsOrPath } : optionsOrPath;
  const {
    dbPath,
    runMigrations = true,
    seedData = true,
    verbose = false,
    migrationsFolder,
    encryptionKey,
    sqliteBusyTimeoutMs,
    nativeBindingPath,
  } = options;
  const effectiveMigrationsFolder = migrationsFolder ?? getDefaultMigrationsFolder();
  const busyTimeoutMs = normalizeSqliteBusyTimeoutMs(sqliteBusyTimeoutMs);

  // Ensure directory exists (skip for in-memory databases)
  if (dbPath !== ':memory:') {
    const dbDir = dirname(dbPath);
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true });
    }
  }

  // Create SQLite connection. `better-sqlite3`'s verbose hook emits one
  // entry per SQL statement — route it through the db module logger at
  // trace level so it shows up only when the operator explicitly opts in
  // via PUNTOVIVO_LOG_LEVEL=trace AND the server is booted with
  // verbose=true. In production (verbose=false) no hook is wired and
  // sqlite stays quiet.
  sqlite = new Database(dbPath, {
    verbose: verbose ? (statement: unknown) => dbLog.trace({ statement }, 'sqlite') : undefined,
    // ABI-dance killer: under plain Node, load the cached Node-ABI addon
    // directly so the on-disk default can stay on the Electron build the
    // desktop needs (undefined → better-sqlite3's normal lookup).
    nativeBinding: nativeBindingPath ?? resolveCachedNodeBinding(),
  });

  // ENG-167 — Apply the SQLCipher key BEFORE any other PRAGMA so the
  // very first read (including `journal_mode`, which the next line
  // touches) speaks to a successfully-keyed page cipher. The fork
  // (`better-sqlite3-multiple-ciphers`) defaults to a non-SQLCipher
  // cipher, so we explicitly select SQLCipher v4 compatibility before
  // applying the key. Skipped for `:memory:` because the fork rejects
  // keys on transient DBs (SqliteError: Setting key not supported for
  // in-memory or temporary databases) and a RAM-backed surface has no
  // cleartext to protect anyway — the standalone `dev:server`
  // therefore boots unkeyed when `PUNTOVIVO_DB_KEY` is unset,
  // preserving the legacy cleartext dev flow until ENG-167b ships the
  // one-shot migration UX.
  if (encryptionKey !== undefined && dbPath !== ':memory:') {
    assertEncryptionKeyShape(encryptionKey);
    sqlite.pragma("cipher = 'sqlcipher'");
    sqlite.pragma('legacy = 4');
    sqlite.pragma(`key = "x'${encryptionKey}'"`);
  }

  // Enable WAL mode for better concurrent access (skip for in-memory)
  if (dbPath !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }
  sqlite.pragma('foreign_keys = ON');

  // ENG-174 — pinned PRAGMA cluster for concurrent-read performance and
  // WAL-file health. Five readers/writers compete for the writer slot on
  // a busy POS (HTTP, SSE, sync worker, hardware worker, fiscal worker,
  // payment worker); without busy_timeout a lock collision aborts a
  // request immediately. The cache_size / mmap / temp_store trio reduces
  // syscall and disk pressure on the hot read paths (audit_logs listing,
  // fiscal_outbox + payment_outbox polling). wal_autocheckpoint keeps the
  // WAL file from growing unbounded between cold reboots. Settings sized
  // against the 4 GB-device floor documented in PERF-BUDGETS.md.
  //
  // busy_timeout, foreign_keys, temp_store, and cache_size apply to
  // every connection (including `:memory:`); mmap_size and
  // wal_autocheckpoint are no-ops on in-memory databases because there
  // is no underlying file to map or checkpoint, so we skip them when
  // dbPath is `:memory:` to keep the pragma list honest.
  sqlite.pragma(`busy_timeout = ${busyTimeoutMs}`);
  sqlite.pragma('cache_size = -64000');
  sqlite.pragma('temp_store = MEMORY');
  if (dbPath !== ':memory:') {
    sqlite.pragma('mmap_size = 268435456');
    sqlite.pragma('wal_autocheckpoint = 1000');
  }

  // Create Drizzle instance
  db = drizzle(sqlite, { schema });

  // ENG-002 Step 3 — versioned migrations are the single schema path.
  // The legacy `runSchemaSync()` raw-DDL mirror has been retired; the
  // only CREATE TABLE / ALTER TABLE / CREATE INDEX statements the
  // server runs at boot are the ones Drizzle generates from
  // `schema.ts` into `db/migrations/*.sql`.
  if (runMigrations) {
    // Adoption shim for DBs that predate versioned migrations: when the
    // DB already has user tables but no `__drizzle_migrations` row, seed
    // the squashed baseline migration so `drizzleMigrate` skips the
    // baseline DDL that would collide with pre-existing objects. Newer
    // migrations still run unless the adopted DB lacks their target
    // table entirely (partial legacy/test DBs have nothing to migrate).
    ensureMigrationBaseline(sqlite, effectiveMigrationsFolder);

    // Apply every migration whose `folderMillis` is greater than the
    // latest row in `__drizzle_migrations`. On a fresh DB this runs
    // the full journal; on an adopted DB the shim above pins the
    // baseline and only absent-target no-op migrations, so applicable
    // post-baseline migrations still execute normally.
    //
    // Hard-fail when the migrations folder is absent: every real boot
    // path ships it (dev resolves the default via `getDefaultMigrationsFolder()`,
    // packaged Electron receives an explicit override from
    // `process.resourcesPath` via Forge `extraResource`, and tests
    // either supply a folder override or opt out via
    // `runMigrations: false`). A missing folder means the deployment
    // is malformed — failing loudly surfaces it instead of silently
    // booting against an empty schema.
    if (!existsSync(resolve(effectiveMigrationsFolder, 'meta', '_journal.json'))) {
      throw new Error(
        `migrations folder missing at ${effectiveMigrationsFolder}; ship the Drizzle migrations alongside the server bundle (dev resolves the module-local path; packaged builds pass migrationsFolder explicitly)`
      );
    }

    // A-06 — refuse to run an OLDER binary against a DB a NEWER binary
    // already migrated (auto-update rollback path; ENG-137 remaining). The
    // failure otherwise surfaces later as a random `no such column`
    // mid-operation; here it becomes an operator-facing boot error with the
    // remediation in the message. Runs after the journal-exists check so the
    // guard can trust the file, and before drizzleMigrate touches anything.
    assertSchemaNotNewerThanApp(sqlite, effectiveMigrationsFolder);
    // ENG-177c — snapshot the applied-migration count so the
    // post-migrate integrity check below runs ONLY on a boot that
    // actually lands a migration. A steady-state boot must not pay a
    // full-DB `foreign_key_check`, and must never refuse to start over a
    // pre-existing orphan it did not create. The tracking table does not
    // exist until the first migrate, so a missing table reads as zero.
    // Capture the non-null connection so the closure keeps the
    // narrowing the surrounding straight-line code already established
    // (`sqlite` is the module-level `Database | null`).
    const migrationsConn = sqlite;
    const countAppliedMigrations = (): number => {
      try {
        const row = migrationsConn
          .prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations')
          .get() as { n?: number } | undefined;
        return row?.n ?? 0;
      } catch {
        return 0;
      }
    };
    const appliedMigrationsBefore = countAppliedMigrations();

    // ENG-177c — table-rebuild migrations (e.g. adding a CHECK to a core
    // table) must run with foreign-key enforcement OFF at the connection
    // level. drizzle-orm wraps every pending migration in a single
    // BEGIN/COMMIT, and `PRAGMA foreign_keys` is a no-op inside a
    // transaction (verified empirically), so a rebuild's `DROP TABLE`
    // would otherwise fire ON DELETE CASCADE on child rows (sale_items,
    // sale_payments, ...) and silently destroy data on any install that
    // already has rows. We disable enforcement only for the migrate span
    // and restore it in `finally`, then assert integrity with
    // `foreign_key_check` below. Setting it here (before drizzle's BEGIN)
    // is what makes the OFF take effect — it must NOT live inside a
    // migration file.
    sqlite.pragma('foreign_keys = OFF');
    try {
      drizzleMigrate(db, { migrationsFolder: effectiveMigrationsFolder });
    } catch (err) {
      // A migration failure on boot is an operator-facing event (the POS
      // refuses to start): name WHICH migration failed and how far the
      // journal got, instead of surfacing drizzle's bare SQL error. The
      // applied-count is read best-effort — if even that fails, the
      // original error still propagates with context.
      let progress = 'unknown';
      let failedTag = 'unknown';
      try {
        const journal = JSON.parse(
          readFileSync(resolve(effectiveMigrationsFolder, 'meta', '_journal.json'), 'utf8')
        ) as DrizzleJournal;
        const appliedRow = sqlite
          .prepare('SELECT COUNT(*) AS n FROM __drizzle_migrations')
          .get() as { n?: number } | undefined;
        const applied = appliedRow?.n ?? 0;
        const ordered = [...journal.entries].sort((a, b) => a.idx - b.idx);
        progress = `${applied}/${ordered.length}`;
        failedTag = ordered[applied]?.tag ?? 'unknown';
      } catch {
        // best-effort context only
      }
      dbLog.error(
        {
          err,
          dbPath,
          migrationsFolder: effectiveMigrationsFolder,
          appliedMigrations: progress,
          failedMigration: failedTag,
        },
        'database migration failed during boot'
      );
      throw new Error(
        `Database migration failed at ${failedTag} (applied ${progress}): ${
          err instanceof Error ? err.message : String(err)
        }. The failing migration was rolled back, so the schema is unchanged by this step; fix the cause (disk space, corrupted file, manual schema edits) and restart.`,
        { cause: err }
      );
    } finally {
      // Restore enforcement for normal operation regardless of whether
      // migrate succeeded — every runtime query after boot relies on it.
      sqlite.pragma('foreign_keys = ON');
    }

    // ENG-177c — with enforcement re-enabled, surface any orphaned row a
    // migration may have introduced (e.g. a botched table rebuild that
    // dropped a parent without re-pointing children) instead of limping
    // on with silent corruption. Gated on "a migration actually ran this
    // boot" so a steady-state boot pays nothing and an adopted DB with a
    // pre-existing orphan is never refused over a migration it skipped.
    // On a fresh boot the data tables are still empty here (seeds run
    // below), so the check is trivially clean.
    if (countAppliedMigrations() > appliedMigrationsBefore) {
      const fkViolations = sqlite.pragma('foreign_key_check') as unknown[];
      if (Array.isArray(fkViolations) && fkViolations.length > 0) {
        dbLog.error(
          { dbPath, violationCount: fkViolations.length, violations: fkViolations.slice(0, 10) },
          'foreign-key integrity check failed after migrations'
        );
        throw new Error(
          `Database failed its foreign-key integrity check after migrations (${fkViolations.length} orphaned reference(s)). ` +
            'The app did not start to avoid operating on a corrupt schema; restore from a backup or fix the offending rows.'
        );
      }
    }

    // ENG-002 Step 3 — post-migration catalog seeds. Idempotent via
    // `INSERT OR IGNORE`; table-existence-gated, so adopted DBs
    // missing a catalog table log a warning instead of crashing.
    seedCatalogs(db);
  }

  // Seed default data if needed
  if (seedData) {
    await seedDefaultData(db);
  }

  dbLog.info({ dbPath }, 'database initialized');

  return db;
}

/**
 * Get the current database instance
 */
export function getDatabase(): DatabaseInstance {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}
