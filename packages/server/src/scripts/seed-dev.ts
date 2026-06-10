/**
 * Dev Seed CLI entry point.
 *
 * Bootstraps the database, applies the default seed (tenant,
 * catalogs), and then runs `seedDevData()` to load the rich demo
 * dataset described in `docs/DEV-SEED.md`. Refuses to run in
 * production.
 *
 * Invoke via `npm run seed:dev` at the repo root or
 * `npm run seed:dev --workspace=@puntovivo/server` inside the server
 * workspace. Accepts `--preset=default|large` and `--reset`.
 *
 * @module scripts/seed-dev
 */

import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDatabase, initDatabase } from '../db/index.js';
import {
  DEV_ADMIN_EMAIL,
  DEV_TENANT_NAME,
  DEV_TENANT_SLUG,
  DEV_USER_PASSWORD,
  seedDevData,
} from '../db/seed-dev.js';
import { createModuleLogger } from '../logging/logger.js';
import { tenants } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';

const log = createModuleLogger('seed-dev-cli');

const __dirname = dirname(fileURLToPath(import.meta.url));

function banner(line = ''): void {
  process.stdout.write(`${line}\n`);
}

interface CliOptions {
  preset: 'default' | 'large' | 'mega';
  /**
   * ENG-035b / ENG-036b — country code for the demo tenant. Default
   * `'CO'` preserves backward compat with all existing tests + E2E.
   * `'MX'` activates the Mexico CFDI 4.0 pack so seeded sales emit
   * XML; `'CL'` activates the Chile DTE 1.0 pack + inserts fixture
   * CAFs (TipoDTE 33/39/61, folios 1..100) so seeded sales emit DTE drafts.
   */
  countryCode: 'CO' | 'MX' | 'CL';
  reset: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  // Start from env-var defaults so operators can avoid npm's flaky
  // double-`--` forwarding through workspace barriers. Explicit CLI
  // flags still win over env.
  const presetFromEnv = process.env.SEED_PRESET;
  const countryFromEnv = (process.env.SEED_COUNTRY ?? '').toUpperCase();
  const options: CliOptions = {
    preset:
      presetFromEnv === 'large'
        ? 'large'
        : presetFromEnv === 'mega'
          ? 'mega'
          : 'default',
    countryCode:
      countryFromEnv === 'MX' ? 'MX' : countryFromEnv === 'CL' ? 'CL' : 'CO',
    reset: process.env.SEED_RESET === 'true' || process.env.SEED_RESET === '1',
    help: false,
  };
  for (const arg of argv) {
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--reset') {
      options.reset = true;
      continue;
    }
    if (arg.startsWith('--preset=')) {
      const value = arg.slice('--preset='.length);
      if (value !== 'default' && value !== 'large' && value !== 'mega') {
        throw new Error(`Unknown preset: ${value}`);
      }
      options.preset = value;
      continue;
    }
    if (arg.startsWith('--country=')) {
      const value = arg.slice('--country='.length).toUpperCase();
      if (value !== 'CO' && value !== 'MX' && value !== 'CL') {
        throw new Error(`Unknown country: ${value} (expected CO, MX o CL)`);
      }
      options.countryCode = value;
      continue;
    }
    throw new Error(`Unknown flag: ${arg}`);
  }
  return options;
}

/**
 * Replicate Electron's `app.getPath('userData')` for `@puntovivo/desktop`
 * without having to spawn Electron. Used when the operator sets
 * `SEED_TARGET=desktop` so the seeded data lands in the same file
 * `npm run dev:desktop` will read on next boot.
 *
 * Per Electron docs the userData directory is:
 *   - macOS:    ~/Library/Application Support/<AppName>
 *   - Linux:    $XDG_CONFIG_HOME/<AppName> or ~/.config/<AppName>
 *   - Windows:  %APPDATA%/<AppName>  (i.e. C:\Users\<U>\AppData\Roaming)
 *
 * `<AppName>` matches the `name` field in the Electron package.json,
 * which here is `@puntovivo/desktop`. Electron preserves the scoped
 * segment verbatim.
 */
function resolveElectronUserDataDbPath(): string {
  const appName = '@puntovivo/desktop';
  const home = homedir();
  let baseDir: string;
  switch (platform()) {
    case 'darwin':
      baseDir = join(home, 'Library', 'Application Support', appName);
      break;
    case 'win32':
      baseDir = join(
        process.env.APPDATA ?? join(home, 'AppData', 'Roaming'),
        appName
      );
      break;
    default:
      // Linux / BSD — honour XDG_CONFIG_HOME if set.
      baseDir = join(
        process.env.XDG_CONFIG_HOME ?? join(home, '.config'),
        appName
      );
      break;
  }
  return join(baseDir, 'data', 'local.db');
}

function isProduction(): boolean {
  const runtimeEnv = process.env.PUNTOVIVO_RUNTIME_ENV;
  if (runtimeEnv) {
    return runtimeEnv === 'production';
  }
  return process.env.NODE_ENV === 'production';
}

function printHelp(): void {
  banner('');
  banner('Puntovivo — developer seed');
  banner('');
  banner('Usage:');
  banner('  npm run seed:dev                                  # default preset, no reset');
  banner('  SEED_PRESET=large npm run seed:dev                # bigger catalog and history');
  banner('  SEED_RESET=true npm run seed:dev                  # wipe the demo tenant first (destructive)');
  banner('  SEED_COUNTRY=mx npm run seed:dev                  # demo tenant en Mexico (CFDI 4.0); default CO');
  banner('  SEED_COUNTRY=cl npm run seed:dev                  # demo tenant en Chile (DTE 1.0)');
  banner('  SEED_TARGET=desktop npm run seed:dev              # seed the Electron userData DB instead of the repo-local one');
  banner('  SEED_PRESET=large SEED_RESET=true npm run seed:dev');
  banner('');
  banner('Equivalent --flag form (only works when invoked directly on the workspace):');
  banner('  npm run seed:dev --workspace=@puntovivo/server -- --preset=large --reset');
  banner('');
  banner('DB path precedence:');
  banner('  DATABASE_URL      -> explicit override (wins over everything)');
  banner('  SEED_TARGET=desktop -> Electron userData path for this OS');
  banner('  (default)         -> packages/server/data/local.db (same as npm run dev:server)');
  banner('');
  banner('Creates tenant "' + DEV_TENANT_NAME + '" (slug ' + DEV_TENANT_SLUG + ') with a');
  banner('multi-site dataset: 6 users, 2 sites, 5 providers, 8 categories, 50 products');
  banner('with stock at both sites, 30 customers, ~20 sales per cashier across two shifts,');
  banner('a handful of purchases, quotations, transfers, and stock adjustments. Safe to');
  banner('re-run: the command is idempotent unless --reset is passed.');
  banner('');
  banner('Refuses to run when NODE_ENV=production or PUNTOVIVO_RUNTIME_ENV=production.');
}

async function resetDemoTenant(db: Awaited<ReturnType<typeof initDatabase>>): Promise<void> {
  // Delete in FK-safe order for the demo tenant. Cascades on
  // unit_x_product / product_x_provider / sale_items / sale_payments
  // do most of the heavy lifting; we touch only the parent tables here
  // and rely on ON DELETE CASCADE where declared. For tables without
  // cascade we issue explicit deletes scoped by tenant_id.
  const existingTenant = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, DEV_TENANT_SLUG))
    .get();
  if (!existingTenant) {
    return;
  }
  const tenantId = existingTenant.id;

  const tables = [
    'audit_logs',
    'ai_anomaly_snoozes',
    'ai_audit_log',
    'operation_errors',
    'operation_effects',
    'operation_events',
    'outbox_metadata',
    'hardware_outbox',
    'site_peripherals',
    'fiscal_outbox',
    'fiscal_cafs',
    'tenant_locale_settings',
    'idempotency_keys',
    'devices',
    'fiscal_document_items',
    'fiscal_documents',
    'fiscal_numbering_resolutions',
    'fiscal_certificates',
    'receipt_templates',
    'sync_conflicts',
    'sync_outbox',
    'quotation_items',
    'quotations',
    'sale_payments',
    'sale_items',
    'sale_returns',
    'sales',
    'cash_movements',
    'cash_sessions',
    'denomination_templates',
    'purchase_return_items',
    'purchase_returns',
    'purchase_items',
    'purchases',
    'order_items',
    'orders',
    'transfer_order_items',
    'transfer_orders',
    'inventory_movements',
    'initial_inventory',
    'inventory_balances',
    'unit_x_product',
    'product_x_provider',
    'category_x_provider',
    'location_x_site',
    'products',
    'sequentials',
    'customers',
    'providers',
    'categories',
    'vat_rates',
    'units',
    'locations',
    'cities',
    'departments',
    'countries',
    'identification_types',
    'person_types',
    'regime_types',
    'client_types',
    'commercial_activities',
    'users',
    'sites',
    'companies',
    'logos',
  ];
  for (const table of tables) {
    try {
      await db.run(sql.raw(`DELETE FROM "${table}" WHERE tenant_id = '${tenantId}'`));
    } catch (error) {
      // Some tables may not have tenant_id (e.g. pure join tables with cascades).
      log.debug({ table, err: error }, 'reset: skipping table without tenant scope');
    }
  }
  await db.delete(tenants).where(eq(tenants.id, tenantId)).run();
  log.info({ tenantId }, 'demo tenant wiped');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    process.exit(0);
  }

  if (isProduction()) {
    process.stderr.write('[seed-dev] refusing to run: NODE_ENV / PUNTOVIVO_RUNTIME_ENV is production.\n');
    process.stderr.write('[seed-dev] If you really want demo data in production (you do not), unset the env var first.\n');
    process.exit(1);
  }

  // DB path resolution, in priority order:
  //   1. explicit `DATABASE_URL` env var — always wins
  //   2. `SEED_TARGET=desktop` env var — points at Electron's
  //      per-user DB so `npm run dev:desktop` sees the seeded data
  //   3. default — repo-local DB (`packages/server/data/local.db`),
  //      shared with `npm run dev:server`
  //
  // Electron reads `app.getPath('userData')` at runtime; we replicate
  // the same location here via the standard OS conventions so the
  // CLI can target it without spawning Electron. App name is
  // `@puntovivo/desktop` (from `apps/desktop/package.json`), which
  // Electron sanitizes to a path segment with the same shape we use
  // below.
  const dbPath =
    process.env.DATABASE_URL ||
    (process.env.SEED_TARGET === 'desktop'
      ? resolveElectronUserDataDbPath()
      : join(__dirname, '..', '..', 'data', 'local.db'));

  banner('==========================================');
  banner('  Puntovivo — developer seed');
  banner('==========================================');
  banner(`  DB path: ${dbPath}`);
  banner(`  Preset:  ${options.preset}`);
  if (options.reset) {
    banner('  Reset:   ON (destructive)');
  }
  banner('');

  // Honor PUNTOVIVO_DB_KEY exactly like standalone.ts does: without it,
  // seeding the launcher-managed shared dev DB writes a PLAINTEXT file that
  // the desktop later fails to open with SQLITE_NOTADB (it keys every open).
  const db = await initDatabase({
    dbPath,
    runMigrations: true,
    seedData: true,
    encryptionKey: process.env.PUNTOVIVO_DB_KEY,
  });

  try {
    if (options.reset) {
      await resetDemoTenant(db);
    }
    const result = await seedDevData(db, {
      preset: options.preset,
      countryCode: options.countryCode,
    });

    banner('');
    if (!result.seeded) {
      banner('  Dev tenant already present — nothing to do.');
      banner('  Pass --reset to wipe + reseed.');
      banner('');
    } else {
      banner('  ✓ Seeding complete');
      banner('');
      banner(`  Tenant:                    ${DEV_TENANT_NAME} (${DEV_TENANT_SLUG})`);
      banner(`  Sites:                     ${result.sites.map(s => s.name).join(', ')}`);
      banner(`  Users:                     ${result.counts.users}`);
      banner(`  Products:                  ${result.counts.products}`);
      banner(`  Customers:                 ${result.counts.customers}`);
      banner(`  Providers:                 ${result.counts.providers}`);
      banner(`  Categories:                ${result.counts.categories}`);
      banner(`  Receipt templates:         ${result.counts.receiptTemplates}`);
      banner(`  Historical purchases:      ${result.counts.purchases}`);
      banner(`  Historical sales:          ${result.counts.sales}`);
      banner(`  Cash sessions:             ${result.counts.cashSessions}`);
      banner(`  Quotations:                ${result.counts.quotations}`);
      banner(`  Inventory transfers:       ${result.counts.inventoryTransfers}`);
      banner(`  Stock adjustments:         ${result.counts.stockAdjustments}`);
      banner('');
    }
    banner('  Sign-in credentials (all seeded users share the same password):');
    banner('    Password:  ' + DEV_USER_PASSWORD);
    banner('');
    for (const user of result.users) {
      banner(`    • ${user.email.padEnd(30)} ${user.role.padEnd(8)} ${user.name}`);
    }
    banner('');
    banner('  Primary admin login: ' + DEV_ADMIN_EMAIL);
    banner('');
    banner('  Tip: the built-in admin@localhost account from the default seed also stays');
    banner('  available — use it if you want to test the "empty tenant" branch or compare.');
    banner('');
  } finally {
    closeDatabase();
  }
}

void main().catch(error => {
  log.error({ err: error }, 'dev seed failed');
  process.stderr.write(`\n[seed-dev] FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
  process.stderr.write('[seed-dev] See structured logs above for details.\n');
  closeDatabase();
  process.exit(1);
});
