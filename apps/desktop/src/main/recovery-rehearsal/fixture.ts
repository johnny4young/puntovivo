import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type Database from 'better-sqlite3';

export interface HistoricalFixtureContract {
  fixtureVersion: 1;
  sourceVersion: string;
  migrationCount: number;
  lastMigrationTag: string;
  journalSha256: string;
  migrationSqlSha256: string[];
}

interface MigrationJournal {
  version: string;
  dialect: string;
  entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }>;
}

export interface HistoricalMigrationFixture {
  contract: HistoricalFixtureContract;
  migrationsFolder: string;
}

const FIXED_TIME = '2026-07-19T12:00:00.000Z';

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function buildHistoricalMigrationFixture(
  repositoryRoot: string,
  stagingDirectory: string
): Promise<HistoricalMigrationFixture> {
  const contractPath = resolve(repositoryRoot, 'scripts/fixtures/recovery/v1.7.0.json');
  const sourceFolder = resolve(repositoryRoot, 'packages/server/src/db/migrations');
  const contract = JSON.parse(await readFile(contractPath, 'utf8')) as HistoricalFixtureContract;
  const journal = JSON.parse(
    await readFile(join(sourceFolder, 'meta', '_journal.json'), 'utf8')
  ) as MigrationJournal;
  const entries = [...journal.entries]
    .sort((left, right) => left.idx - right.idx)
    .slice(0, contract.migrationCount);

  if (entries.length !== contract.migrationCount) {
    throw new Error(`historical fixture requires ${contract.migrationCount} migrations`);
  }
  if (entries.at(-1)?.tag !== contract.lastMigrationTag) {
    throw new Error('historical fixture last migration tag does not match the contract');
  }

  const historicalJournal: MigrationJournal = { ...journal, entries };
  if (sha256(JSON.stringify(historicalJournal)) !== contract.journalSha256) {
    throw new Error('historical migration journal prefix no longer matches the fixture contract');
  }

  const migrationsFolder = join(stagingDirectory, 'migrations-v1.7.0');
  await mkdir(join(migrationsFolder, 'meta'), { recursive: true });
  for (const [index, entry] of entries.entries()) {
    const sql = await readFile(join(sourceFolder, `${entry.tag}.sql`));
    if (sha256(sql) !== contract.migrationSqlSha256[index]) {
      throw new Error(`historical migration ${entry.tag} no longer matches the fixture contract`);
    }
    await writeFile(join(migrationsFolder, `${entry.tag}.sql`), sql, { mode: 0o600 });
    // Snapshot names use the numeric migration index, not the descriptive tag.
    const snapshotByIndex = join(
      sourceFolder,
      'meta',
      `${String(entry.idx).padStart(4, '0')}_snapshot.json`
    );
    try {
      await cp(
        snapshotByIndex,
        join(migrationsFolder, 'meta', `${String(entry.idx).padStart(4, '0')}_snapshot.json`)
      );
    } catch (error) {
      // Drizzle runtime only requires SQL + journal. Keep fixture compatible
      // with histories where an intermediate snapshot was intentionally absent.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  await writeFile(
    join(migrationsFolder, 'meta', '_journal.json'),
    `${JSON.stringify(historicalJournal, null, 2)}\n`,
    { mode: 0o600 }
  );
  return { contract, migrationsFolder };
}

export const REHEARSAL_TABLES = [
  'tenants',
  'companies',
  'sites',
  'users',
  'cash_sessions',
  'customers',
  'products',
  'sales',
  'sale_items',
  'sale_payments',
  'inventory_movements',
  'inventory_lots',
  'fiscal_numbering_resolutions',
  'fiscal_documents',
  'fiscal_outbox',
  'loyalty_accounts',
  'loyalty_movements',
] as const;

/** Seeds two independent tenant graphs using only columns available in v1.7.0. */
export function seedHistoricalSentinels(sqlite: Database.Database): void {
  const insert = (sql: string, values: unknown[]) => sqlite.prepare(sql).run(...values);
  sqlite.transaction(() => {
    for (const suffix of ['a', 'b']) {
      const id = (entity: string) => `rehearsal-${entity}-${suffix}`;
      const tenant = id('tenant');
      const company = id('company');
      const site = id('site');
      const user = id('user');
      const customer = id('customer');
      const product = id('product');
      const cashSession = id('cash-session');
      const sale = id('sale');
      const resolution = id('resolution');
      const fiscalDocument = id('fiscal-document');
      const loyaltyAccount = id('loyalty-account');

      insert(
        'INSERT INTO tenants (id,name,slug,default_currency_code,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        [
          tenant,
          `Tenant ${suffix.toUpperCase()}`,
          `rehearsal-${suffix}`,
          'COP',
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      insert('INSERT INTO companies (id,tenant_id,name,created_at,updated_at) VALUES (?,?,?,?,?)', [
        company,
        tenant,
        `Company ${suffix.toUpperCase()}`,
        FIXED_TIME,
        FIXED_TIME,
      ]);
      insert(
        'INSERT INTO sites (id,tenant_id,company_id,name,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        [site, tenant, company, `Site ${suffix.toUpperCase()}`, FIXED_TIME, FIXED_TIME]
      );
      insert(
        'INSERT INTO users (id,tenant_id,email,name,password_hash,role,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        [
          user,
          tenant,
          `rehearsal-${suffix}@example.invalid`,
          `User ${suffix.toUpperCase()}`,
          'not-a-login-credential',
          'admin',
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      insert(
        'INSERT INTO customers (id,tenant_id,name,email,credit_limit,credit_limit_currency_code,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
        [
          customer,
          tenant,
          `Customer ${suffix.toUpperCase()}`,
          `customer-${suffix}@example.invalid`,
          25,
          'COP',
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      insert(
        'INSERT INTO products (id,tenant_id,name,sku,price,cost,currency_code,tracks_lots,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [
          product,
          tenant,
          `Product ${suffix.toUpperCase()}`,
          `REHEARSAL-${suffix.toUpperCase()}`,
          125.5,
          80,
          'COP',
          1,
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      insert(
        'INSERT INTO cash_sessions (id,tenant_id,site_id,cashier_id,register_name,opening_float,opening_count_denominations,expected_balance,status,opened_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          cashSession,
          tenant,
          site,
          user,
          `Register ${suffix.toUpperCase()}`,
          100,
          '{}',
          225.5,
          'open',
          FIXED_TIME,
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      insert(
        'INSERT INTO sales (id,tenant_id,sale_number,customer_id,subtotal,total,currency_code,payment_method,payment_status,status,cash_session_id,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          sale,
          tenant,
          `R-${suffix.toUpperCase()}-1`,
          customer,
          125.5,
          125.5,
          'COP',
          'cash',
          'paid',
          'completed',
          cashSession,
          user,
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      insert(
        'INSERT INTO sale_items (id,sale_id,product_id,quantity,unit_price,total,currency_code) VALUES (?,?,?,?,?,?,?)',
        [id('sale-item'), sale, product, 1, 125.5, 125.5, 'COP']
      );
      insert(
        'INSERT INTO sale_payments (id,tenant_id,sale_id,method,amount,created_at) VALUES (?,?,?,?,?,?)',
        [id('sale-payment'), tenant, sale, 'cash', 125.5, FIXED_TIME]
      );
      insert(
        'INSERT INTO inventory_movements (id,tenant_id,product_id,type,quantity,previous_stock,new_stock,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [id('movement'), tenant, product, 'adjustment', 7, 0, 7, user, FIXED_TIME]
      );
      insert(
        'INSERT INTO inventory_lots (id,tenant_id,site_id,product_id,lot_number,on_hand,unit_cost,received_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [
          id('lot'),
          tenant,
          site,
          product,
          `LOT-${suffix.toUpperCase()}`,
          7,
          80,
          FIXED_TIME,
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      insert(
        'INSERT INTO fiscal_numbering_resolutions (id,tenant_id,site_id,kind,resolution_number,prefix,from_number,to_number,current_number,technical_key,valid_from,valid_until,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          resolution,
          tenant,
          site,
          'FEV',
          `RES-${suffix.toUpperCase()}`,
          `R${suffix.toUpperCase()}`,
          1,
          1000,
          1,
          `technical-${suffix}`,
          '2026-01-01',
          '2027-01-01',
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      insert(
        'INSERT INTO fiscal_documents (id,tenant_id,source,source_id,kind,resolution_id,consecutive,document_number,cufe,status,customer_id,buyer_tax_id,buyer_country_code,buyer_tax_id_type_code,buyer_name,subtotal,total_amount,currency_code,locale_code,provider_id,emitted_by_user_id,emitted_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [
          fiscalDocument,
          tenant,
          'sale',
          sale,
          'FEV',
          resolution,
          1,
          `R${suffix.toUpperCase()}1`,
          `rehearsal-cufe-${suffix}`,
          'accepted',
          customer,
          `90000000${suffix === 'a' ? '1' : '2'}`,
          'CO',
          '13',
          `Buyer ${suffix.toUpperCase()}`,
          125.5,
          125.5,
          'COP',
          'es-CO',
          'mock',
          user,
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      insert(
        'INSERT INTO fiscal_outbox (id,tenant_id,status,kind,fiscal_document_id,provider_id,cufe,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [
          id('fiscal-outbox'),
          tenant,
          'sent',
          'emit',
          fiscalDocument,
          'mock',
          `rehearsal-cufe-${suffix}`,
          '{"fixture":true}',
          FIXED_TIME,
          FIXED_TIME,
        ]
      );
      insert(
        'INSERT INTO loyalty_accounts (id,tenant_id,customer_id,points,created_at,updated_at) VALUES (?,?,?,?,?,?)',
        [loyaltyAccount, tenant, customer, 12, FIXED_TIME, FIXED_TIME]
      );
      insert(
        'INSERT INTO loyalty_movements (id,tenant_id,account_id,sale_id,kind,points,rate_at_earn,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [id('loyalty-movement'), tenant, loyaltyAccount, sale, 'earn', 12, 0.1, user, FIXED_TIME]
      );
    }
  })();
}
