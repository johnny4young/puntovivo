import D from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
const db = new D('packages/server/data/local.db', { readonly: true, fileMustExist: true });
const tenant = db
  .prepare("SELECT tenant_id AS id FROM users WHERE email='e2e.admin@local.test'")
  .get().id;
const state = {};
for (const table of ['products', 'categories', 'providers', 'locations', 'units'])
  state[table] = db
    .prepare('SELECT * FROM ' + table + ' WHERE tenant_id=? ORDER BY id')
    .all(tenant);
state.unitAssignments = db
  .prepare(
    'SELECT unit_x_product.* FROM unit_x_product INNER JOIN products ON products.id=unit_x_product.product_id WHERE products.tenant_id=? ORDER BY unit_x_product.id'
  )
  .all(tenant);
const result = {
  catalogSha256: createHash('sha256').update(JSON.stringify(state)).digest('hex'),
  counts: Object.fromEntries(Object.entries(state).map(([k, v]) => [k, v.length])),
  users: db.prepare('SELECT count(*) AS n FROM users').get().n,
  fiscalDocuments: db.prepare('SELECT count(*) AS n FROM fiscal_documents').get().n,
  fiscalOutbox: db.prepare('SELECT count(*) AS n FROM fiscal_outbox').get().n,
  enabled: db
    .prepare(
      "SELECT count(*) AS n FROM tenants WHERE json_extract(settings,'$.fiscal_dian_enabled')=1 OR json_extract(settings,'$.fiscalDianEnabled')=1"
    )
    .get().n,
};
db.close();
if (result.fiscalDocuments || result.fiscalOutbox || result.enabled)
  throw Error('Fiscal boundary failed');
if (process.env.LAB_NAV_STATE)
  writeFileSync(process.env.LAB_NAV_STATE, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
