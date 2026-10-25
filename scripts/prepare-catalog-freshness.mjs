// Run in a fresh disposable checkout, with an existing acknowledged synthetic fixture.
import D from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
if (process.env.LAB_FRESHNESS_ACK_SYNTHETIC !== '1' || !process.env.LAB_FRESHNESS_FIXTURE_DB)
  throw new Error(
    'Supply LAB_FRESHNESS_ACK_SYNTHETIC=1 and LAB_FRESHNESS_FIXTURE_DB for an existing synthetic fixture'
  );
const source = resolve(process.env.LAB_FRESHNESS_FIXTURE_DB);
const target = resolve('packages/server/data/local.db');
if (source === target || existsSync(target) || existsSync('.env'))
  throw new Error('Use a fresh checkout; never overwrite a DB/environment');
if (existsSync(source + '-wal') && statSync(source + '-wal').size !== 0)
  throw new Error('Fixture source must be quiescent with an empty WAL');
const digest = () => createHash('sha256').update(readFileSync(source)).digest('hex');
const beforeHash = digest();
mkdirSync(dirname(target), { recursive: true });
copyFileSync(source, target);
const old = new D(target, { readonly: true, fileMustExist: true });
const foreignUsers = old
  .prepare(
    "SELECT count(*) AS n FROM users WHERE email NOT LIKE '%@local.test' AND email != 'admin@localhost'"
  )
  .get().n;
if (foreignUsers)
  throw new Error('Source contains identities outside the canonical synthetic fixture');
if (
  !old.prepare("SELECT id FROM users WHERE email='e2e.admin@local.test'").get() ||
  !old.prepare("SELECT id FROM users WHERE email='e2e.manager@local.test'").get()
)
  throw new Error(
    'Existing canonical synthetic identities are required; this script never creates accounts'
  );
for (const table of ['fiscal_documents', 'fiscal_outbox'])
  if (old.prepare('SELECT count(*) AS n FROM ' + table).get().n)
    throw new Error('Source fiscal tables must be empty');
if (
  old
    .prepare(
      "SELECT count(*) AS n FROM tenants WHERE json_extract(settings,'$.fiscal_dian_enabled')=1 OR json_extract(settings,'$.fiscalDianEnabled')=1"
    )
    .get().n
)
  throw new Error('Fiscal processing must be disabled');
old.close();
if (digest() !== beforeHash) throw new Error('Fixture source changed');
const db = new D(target);
try {
  const before = db.prepare('SELECT count(*) AS n FROM users').get();
  const tenant = db
    .prepare("SELECT tenant_id AS id FROM users WHERE email='e2e.admin@local.test'")
    .get().id;
  db.transaction(() => {
    for (let i = 0; i < 24; i++) {
      const n = String(i).padStart(2, '0');
      const stamp = '2026-10-25T00:00:00.000Z';
      db.prepare(
        'INSERT INTO categories (id,tenant_id,name,created_at,updated_at) VALUES (?,?,?,?,?)'
      ).run('lab-cat-' + n, tenant, 'Lab Category ' + n, stamp, stamp);
      db.prepare(
        'INSERT INTO providers (id,tenant_id,name,created_at,updated_at) VALUES (?,?,?,?,?)'
      ).run('lab-provider-' + n, tenant, 'Lab Provider ' + n, stamp, stamp);
      db.prepare(
        'INSERT INTO locations (id,tenant_id,code,name,created_at,updated_at) VALUES (?,?,?,?,?,?)'
      ).run('lab-location-' + n, tenant, 'LAB' + n, 'Lab Location ' + n, stamp, stamp);
      db.prepare(
        'INSERT INTO units (id,tenant_id,name,abbreviation,created_at,updated_at) VALUES (?,?,?,?,?,?)'
      ).run('lab-unit-' + n, tenant, 'Lab Unit ' + n, 'lu' + n, stamp, stamp);
    }
    for (let i = 0; i < 6; i++) {
      const n = String(i).padStart(2, '0');
      db.prepare(
        'INSERT INTO products (id,tenant_id,name,sku,category_id,provider_id,location_id,price,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)'
      ).run(
        'lab-fresh-' + i,
        tenant,
        'Synthetic Freshness ' + i,
        'LAB-FRESH-' + i,
        'lab-cat-' + n,
        'lab-provider-' + n,
        'lab-location-' + n,
        12500,
        '2026-10-25T00:00:00.000Z',
        '2026-10-25T00:00:00.000Z'
      );
      db.prepare(
        'INSERT INTO unit_x_product (id,product_id,unit_id,equivalence,price,is_base) VALUES (?,?,?,?,?,?)'
      ).run('lab-unit-assignment-' + i, 'lab-fresh-' + i, 'lab-unit-' + n, 1, 12500, 1);
    }
  })();
  if (db.prepare('SELECT count(*) AS n FROM users').get().n !== before.n)
    throw Error('No new accounts allowed');
} finally {
  db.close();
}
console.log(
  JSON.stringify({
    fixtureSourceSha256: beforeHash,
    products: 6,
    lookupOptionsPerKind: 24,
    accountsCreated: 0,
  })
);
