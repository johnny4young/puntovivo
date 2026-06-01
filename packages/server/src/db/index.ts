/**
 * Database Connection Module
 *
 * Initializes the SQLite database with better-sqlite3 and Drizzle ORM.
 * Handles migrations and provides the database instance.
 *
 * @module db/index
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createModuleLogger } from '../logging/logger.js';
import * as schema from './schema.js';
import { seedDefaultData } from './seed.js';

const dbLog = createModuleLogger('db');
export const DEFAULT_SQLITE_BUSY_TIMEOUT_MS = 5000;

// ENG-002 — versioned Drizzle migrations live next to this module. Resolved
// lazily so `import.meta.url` is only touched in ESM contexts (standalone
// server, tests). The Electron main process always passes an explicit
// `migrationsFolder`, because Vite bundles this file into CJS where
// `import.meta.url` evaluates to `undefined` and would crash at module load.
function getDefaultMigrationsFolder(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), 'migrations');
}

export type DatabaseInstance = BetterSQLite3Database<typeof schema>;

let db: DatabaseInstance | null = null;
let sqlite: Database.Database | null = null;

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
}

/**
 * ENG-167 — Validate the SQLCipher key. We accept only the raw-bytes
 * form (`x'<hex64>'`) to keep the boot path KDF-free and to surface
 * obviously-broken keys (truncated hex, accidental passphrase) as a
 * boot-time error instead of a `SQLITE_NOTADB` later when the first
 * `.prepare()` runs.
 */
function assertEncryptionKeyShape(key: string): void {
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
function normalizeSqliteBusyTimeoutMs(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_SQLITE_BUSY_TIMEOUT_MS;
  }
  if (!Number.isInteger(value) || value < 0 || value > 60_000) {
    throw new Error('sqliteBusyTimeoutMs must be an integer from 0 to 60000 milliseconds');
  }
  return value;
}

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
    // the full journal so `drizzleMigrate` treats every migration as
    // already applied and skips DDL that would collide with the
    // pre-existing objects.
    ensureMigrationBaseline(sqlite, effectiveMigrationsFolder);

    // Apply every migration whose `folderMillis` is greater than the
    // latest row in `__drizzle_migrations`. On a fresh DB this runs
    // the full journal; on an adopted DB the shim above pinned it so
    // this is a no-op.
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
    drizzleMigrate(db, { migrationsFolder: effectiveMigrationsFolder });

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

interface DrizzleJournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface DrizzleJournal {
  version: string;
  dialect: string;
  entries: DrizzleJournalEntry[];
}

/**
 * ENG-002 — adoption shim for DBs that predate versioned migrations.
 *
 * If the DB already carries application data (probed via any user
 * table) but has no `__drizzle_migrations` row, this function seeds
 * **every** journal entry with the exact (hash, created_at) tuple
 * that drizzle-orm's migrator would have written itself. That way the
 * first real `drizzleMigrate()` call finds nothing pending and skips
 * all DDL that would collide with the existing objects.
 *
 * No-op on fresh DBs (let migrate() run everything from scratch) and
 * on already-adopted DBs (tracking row exists).
 *
 * Rationale for seeding the full journal: legacy installs reached the
 * current schema shape via a now-retired raw-DDL bootstrap. Running an
 * `ALTER TABLE` in a later migration against such a DB is not safe if
 * the target column was already present from that bootstrap. Pinning
 * the whole journal at adoption time avoids the replay. Operators who
 * skipped the transitional release that ran the raw-DDL path must
 * adopt a bridge build once before upgrading — the post-migration
 * `seedCatalogs()` hook logs an actionable warning when the expected
 * tables are absent.
 */
function ensureMigrationBaseline(
  sqlite: Database.Database,
  migrationsFolder: string
): void {
  const journalPath = resolve(migrationsFolder, 'meta', '_journal.json');
  if (!existsSync(journalPath)) {
    // No migrations folder yet. Defer to drizzleMigrate which will throw
    // a loud, actionable error pointing at the missing metadata.
    return;
  }

  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as DrizzleJournal;
  if (journal.entries.length === 0) {
    return;
  }

  // Probe: this DB has pre-existing application tables iff sqlite_master
  // lists anything beyond internals (`sqlite_*`) and drizzle's own tracking
  // table. A fresh sqlite file returns no rows at all; a legacy install
  // may have any subset of the schema (some tests seed only a couple of
  // tables to exercise migration fast-paths — `tenants` is not guaranteed).
  const preExistingUserTable = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' " +
        "AND name NOT LIKE 'sqlite_%' AND name <> '__drizzle_migrations' LIMIT 1"
    )
    .get();
  if (!preExistingUserTable) {
    return;
  }

  // Pre-create the tracking table so we can seed rows. The drizzle-orm
  // migrator CREATE IF NOT EXISTS below will find it and reuse it.
  sqlite
    .prepare(
      'CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash text NOT NULL, created_at numeric)'
    )
    .run();

  const existingRow = sqlite
    .prepare('SELECT id FROM __drizzle_migrations LIMIT 1')
    .get();
  if (existingRow) {
    // Either this DB already adopted the shim, or drizzleMigrate already
    // ran on a fresh boot. Either way, hands off.
    return;
  }

  const orderedEntries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const insert = sqlite.prepare(
    'INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)'
  );

  // Compute each migration hash exactly like drizzle-orm's
  // `readMigrationFiles` does: sha256 of the raw `.sql` contents, no
  // normalisation. Seed them in journal order so the primary-key `id`
  // column matches the expected migration index.
  for (const entry of orderedEntries) {
    const sqlPath = resolve(migrationsFolder, `${entry.tag}.sql`);
    const sqlContents = readFileSync(sqlPath, 'utf8');
    const hash = createHash('sha256').update(sqlContents).digest('hex');
    insert.run(hash, entry.when);
  }
}

/**
 * ENG-002 Step 3 — post-migration catalog-seed hook.
 *
 * Invoked from `initDatabase()` after `drizzleMigrate()` runs. Both
 * seeders use `INSERT OR IGNORE`, so re-entry is a no-op on every
 * boot beyond the first.
 *
 * Defensive design: each call is table-existence-gated. Adopted DBs
 * whose journal was pinned by `ensureMigrationBaseline()` BEFORE the
 * ENG-017 / ENG-020 migrations would have run (i.e. the operator
 * skipped the transitional release that materialised those tables)
 * hit the gate and skip the seed with a warning instead of crashing
 * the boot. The warning is actionable — it names the missing table and
 * points at the upgrade sequence.
 */
function seedCatalogs(database: DatabaseInstance): void {
  const client = (database as unknown as { $client: Database.Database }).$client;
  const tableExists = (name: string): boolean => {
    const row = client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1"
      )
      .get(name);
    return Boolean(row);
  };

  // ENG-017 — the read-only locale catalogs (currency + country).
  if (tableExists('currency_catalog') && tableExists('country_catalog')) {
    seedLocaleCatalogs(client);
  } else {
    dbLog.warn(
      { reason: 'catalog_tables_missing', seeder: 'seedLocaleCatalogs' },
      'skipping locale-catalog seed because currency_catalog or country_catalog is absent; adopt a transitional version that runs drizzleMigrate against a fresh DB or verify ensureMigrationBaseline did not pin unexecuted migrations'
    );
  }

  // ENG-176c — fiscal identification types (renamed from
  // `dian_identification_types` in 0038). Now keyed by composite
  // (country_code, code) so DIAN + SAT + SUNAT + SII rows coexist.
  if (tableExists('fiscal_identification_types')) {
    seedFiscalIdentificationTypes(client);
  } else {
    dbLog.warn(
      { reason: 'catalog_tables_missing', seeder: 'seedFiscalIdentificationTypes' },
      'skipping fiscal identification types seed because fiscal_identification_types is absent; adopt a transitional version that runs migration 0038 against this DB'
    );
  }
}

/**
 * Seed the global `currency_catalog` + `country_catalog` tables with
 * the ENG-017 matrices (18 currencies, 21 LATAM+USA countries). Uses
 * `INSERT OR IGNORE` so the function is safe to re-run on every boot
 * — existing rows are preserved, new rows are added. Updates to
 * existing rows (e.g. adjusting `display_decimals`) require a targeted
 * migration; this seeder never writes over prior values.
 */
function seedLocaleCatalogs(client: Database.Database): void {
  const insertCurrency = client.prepare(
    'INSERT OR IGNORE INTO currency_catalog (code, name_en, name_es, symbol, decimals, display_decimals) VALUES (?, ?, ?, ?, ?, ?)'
  );
  // ISO 4217 codes ordered to mirror the LOCALE-CURRENCY.md matrix.
  const currencies: Array<[string, string, string, string, number, number]> = [
    ['COP', 'Colombian Peso', 'Peso colombiano', '$', 2, 0],
    ['USD', 'US Dollar', 'Dólar estadounidense', '$', 2, 2],
    ['MXN', 'Mexican Peso', 'Peso mexicano', '$', 2, 2],
    ['ARS', 'Argentine Peso', 'Peso argentino', '$', 2, 2],
    ['CLP', 'Chilean Peso', 'Peso chileno', '$', 0, 0],
    ['PEN', 'Peruvian Sol', 'Sol peruano', 'S/', 2, 2],
    ['VES', 'Venezuelan Sovereign Bolívar', 'Bolívar soberano', 'Bs. S', 2, 2],
    ['UYU', 'Uruguayan Peso', 'Peso uruguayo', '$U', 2, 2],
    ['PYG', 'Paraguayan Guaraní', 'Guaraní', '₲', 0, 0],
    ['BOB', 'Bolivian Boliviano', 'Boliviano', 'Bs', 2, 2],
    ['CRC', 'Costa Rican Colón', 'Colón costarricense', '₡', 2, 2],
    ['PAB', 'Panamanian Balboa', 'Balboa', 'B/.', 2, 2],
    ['GTQ', 'Guatemalan Quetzal', 'Quetzal', 'Q', 2, 2],
    ['HNL', 'Honduran Lempira', 'Lempira', 'L', 2, 2],
    ['NIO', 'Nicaraguan Córdoba', 'Córdoba', 'C$', 2, 2],
    ['DOP', 'Dominican Peso', 'Peso dominicano', 'RD$', 2, 2],
    ['CUP', 'Cuban Peso', 'Peso cubano', '$', 2, 2],
    ['BRL', 'Brazilian Real', 'Real', 'R$', 2, 2],
  ];
  for (const row of currencies) {
    insertCurrency.run(...row);
  }

  const insertCountry = client.prepare(
    `INSERT OR IGNORE INTO country_catalog (
       code, name_en, name_es, default_locale, general_locale,
       default_currency_code, additional_currency_codes,
       default_timezone, first_day_of_week, date_format_short,
       date_format_long, tax_id_types_hint, ui_locale_ready
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  type CountryRow = [
    code: string,
    nameEn: string,
    nameEs: string,
    defaultLocale: string,
    generalLocale: string,
    defaultCurrencyCode: string,
    additionalCurrencyCodes: string,
    defaultTimezone: string,
    firstDayOfWeek: number,
    dateFormatShort: string,
    dateFormatLong: string,
    taxIdTypesHint: string,
    uiLocaleReady: number,
  ];
  const countries: CountryRow[] = [
    ['CO', 'Colombia', 'Colombia', 'es-CO', 'es', 'COP', '[]', 'America/Bogota', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CC', 'NIT', 'CE', 'TI', 'PA']), 1],
    ['US', 'United States', 'Estados Unidos', 'en-US', 'en', 'USD', '[]', 'America/New_York', 0, 'MM/dd/yyyy', 'MMMM d, yyyy', JSON.stringify(['SSN', 'EIN']), 1],
    ['MX', 'Mexico', 'México', 'es-MX', 'es', 'MXN', '[]', 'America/Mexico_City', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['RFC', 'CURP']), 1],
    ['AR', 'Argentina', 'Argentina', 'es-AR', 'es', 'ARS', '[]', 'America/Argentina/Buenos_Aires', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DNI', 'CUIT', 'CUIL']), 1],
    ['CL', 'Chile', 'Chile', 'es-CL', 'es', 'CLP', '[]', 'America/Santiago', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['RUT']), 1],
    ['PE', 'Peru', 'Perú', 'es-PE', 'es', 'PEN', '[]', 'America/Lima', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DNI', 'RUC']), 1],
    ['EC', 'Ecuador', 'Ecuador', 'es-EC', 'es', 'USD', '[]', 'America/Guayaquil', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CI', 'RUC']), 1],
    ['VE', 'Venezuela', 'Venezuela', 'es-VE', 'es', 'VES', JSON.stringify(['USD']), 'America/Caracas', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['V', 'E', 'J', 'G']), 1],
    ['UY', 'Uruguay', 'Uruguay', 'es-UY', 'es', 'UYU', '[]', 'America/Montevideo', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CI', 'RUT']), 1],
    ['PY', 'Paraguay', 'Paraguay', 'es-PY', 'es', 'PYG', '[]', 'America/Asuncion', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CI', 'RUC']), 1],
    ['BO', 'Bolivia', 'Bolivia', 'es-BO', 'es', 'BOB', '[]', 'America/La_Paz', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CI', 'NIT']), 1],
    ['CR', 'Costa Rica', 'Costa Rica', 'es-CR', 'es', 'CRC', '[]', 'America/Costa_Rica', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['cedula', 'cedula_juridica']), 1],
    ['PA', 'Panama', 'Panamá', 'es-PA', 'es', 'PAB', JSON.stringify(['USD']), 'America/Panama', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['cedula', 'RUC']), 1],
    ['GT', 'Guatemala', 'Guatemala', 'es-GT', 'es', 'GTQ', '[]', 'America/Guatemala', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DPI', 'NIT']), 1],
    ['SV', 'El Salvador', 'El Salvador', 'es-SV', 'es', 'USD', '[]', 'America/El_Salvador', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DUI', 'NIT']), 1],
    ['HN', 'Honduras', 'Honduras', 'es-HN', 'es', 'HNL', '[]', 'America/Tegucigalpa', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['DNI', 'RTN']), 1],
    ['NI', 'Nicaragua', 'Nicaragua', 'es-NI', 'es', 'NIO', '[]', 'America/Managua', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['cedula', 'RUC']), 1],
    ['DO', 'Dominican Republic', 'República Dominicana', 'es-DO', 'es', 'DOP', '[]', 'America/Santo_Domingo', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['cedula', 'RNC']), 1],
    ['CU', 'Cuba', 'Cuba', 'es-CU', 'es', 'CUP', '[]', 'America/Havana', 1, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['carne_identidad']), 1],
    ['PR', 'Puerto Rico', 'Puerto Rico', 'es-PR', 'es', 'USD', '[]', 'America/Puerto_Rico', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['SSN']), 1],
    // Brazil is seeded with uiLocaleReady=0 until the pt-BR bundle
    // ships — the admin UI will warn and still let the operator pick
    // it (formatters work because Intl has pt-BR; only the i18next
    // UI copy needs the bundle).
    ['BR', 'Brazil', 'Brasil', 'pt-BR', 'pt', 'BRL', '[]', 'America/Sao_Paulo', 0, 'dd/MM/yyyy', 'd MMMM yyyy', JSON.stringify(['CPF', 'CNPJ']), 0],
  ];
  for (const row of countries) {
    insertCountry.run(...row);
  }
}

/**
 * Seed the global `fiscal_identification_types` catalog with the
 * official codes that Colombia's DIAN, México's SAT, Perú's SUNAT,
 * and Chile's SII publish. Composite-PK-gated (country_code, code)
 * so the seed is idempotent across reboots. These rows are
 * regulated — the `code` column feeds directly into the fiscal XML
 * each authority accepts, so operators cannot edit them.
 *
 * Sources:
 * - CO (DIAN): Resolución 042/2020 Anexo Técnico — Codificación Tipos
 *   de Documento de Identificación.
 * - MX (SAT): Anexo 20 CFDI 4.0 — c_RegimenFiscal + complemento de
 *   identificación de receptor.
 * - PE (SUNAT): Catálogo Nº 6 — Tipo de Documento de Identidad.
 * - CL (SII): Catálogo Nº 11 — Tipo de RUT / RUN.
 *
 * The MX/PE/CL subsets are minimal viable sets that cover the
 * common cases. ENG-156 (multi-currency operations) and ENG-161
 * (NFe Brazil) may extend per business need.
 */
function seedFiscalIdentificationTypes(client: Database.Database): void {
  const insert = client.prepare(
    'INSERT OR IGNORE INTO fiscal_identification_types (country_code, code, abbr, name_es, name_en, natural_person) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const rows: Array<[string, string, string, string, string, number]> = [
    // Colombia — DIAN (10 codes, regulated)
    ['CO', '11', 'RC', 'Registro civil', 'Civil registry', 1],
    ['CO', '12', 'TI', 'Tarjeta de identidad', 'Identity card', 1],
    ['CO', '13', 'CC', 'Cédula de ciudadanía', 'Citizenship ID', 1],
    ['CO', '21', 'TE', 'Tarjeta de extranjería', 'Foreigner card', 1],
    ['CO', '22', 'CE', 'Cédula de extranjería', 'Foreigner ID', 1],
    ['CO', '31', 'NIT', 'Número de identificación tributaria', 'Tax identification number', 0],
    ['CO', '41', 'PA', 'Pasaporte', 'Passport', 1],
    ['CO', '42', 'TDE', 'Tipo de documento extranjero', 'Foreign document type', 1],
    ['CO', '47', 'PEP', 'Permiso especial de permanencia', 'Special stay permit', 1],
    ['CO', '91', 'NUIP', 'Número único de identificación personal', 'Unique personal identification number', 1],
    // México — SAT (4 codes, minimal viable set)
    ['MX', 'RFC', 'RFC', 'Registro Federal de Contribuyentes', 'Federal taxpayer registry', 0],
    ['MX', 'CURP', 'CURP', 'Clave Única de Registro de Población', 'Unique population registry code', 1],
    ['MX', 'IFE', 'IFE', 'Credencial para Votar', 'Voter credential', 1],
    ['MX', 'PA', 'PA', 'Pasaporte', 'Passport', 1],
    // Perú — SUNAT Catálogo Nº 6 (5 codes, minimal viable set)
    ['PE', '0', 'NDOM', 'No domiciliado, sin RUC', 'Non-domiciled, no RUC', 0],
    ['PE', '1', 'DNI', 'Documento Nacional de Identidad', 'National identity document', 1],
    ['PE', '4', 'CE', 'Carné de Extranjería', 'Foreigner card', 1],
    ['PE', '6', 'RUC', 'Registro Único de Contribuyentes', 'Unique taxpayer registry', 0],
    ['PE', '7', 'PA', 'Pasaporte', 'Passport', 1],
    // Chile — SII Catálogo Nº 11 (4 codes, minimal viable set)
    ['CL', 'RUT', 'RUT', 'Rol Único Tributario', 'Unique tax registry', 0],
    ['CL', 'RUN', 'RUN', 'Rol Único Nacional', 'Unique national registry', 1],
    ['CL', 'EXT', 'EXT', 'Extranjero', 'Foreigner', 1],
    ['CL', 'PA', 'PA', 'Pasaporte', 'Passport', 1],
  ];
  for (const row of rows) {
    insert.run(...row);
  }
}

// Re-export schema
export * from './schema.js';
