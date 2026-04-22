import type { FullConfig } from '@playwright/test';
import Database from 'better-sqlite3';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';

const E2E_PASSWORD = 'PuntovivoE2E!123';
const E2E_USERS = [
  { email: 'e2e.admin@local.test', name: 'E2E Admin', role: 'admin' },
  { email: 'e2e.manager@local.test', name: 'E2E Manager', role: 'manager' },
  { email: 'e2e.cashier@local.test', name: 'E2E Cashier', role: 'cashier' },
  { email: 'e2e.viewer@local.test', name: 'E2E Viewer', role: 'viewer' },
] as const;

const DB_PATH = 'packages/server/data/local.db';
const SECONDARY_SITE_NAME = 'E2E Branch Site';

async function ensureUsers(db: Database.Database, tenantId: string) {
  const passwordHash = await argon2.hash(E2E_PASSWORD);
  const now = new Date().toISOString();

  const selectUser = db.prepare('select id, session_version as sessionVersion from users where email = ?');
  const insertUser = db.prepare(`
    insert into users (
      id, tenant_id, email, name, password_hash, session_version, role, is_active, created_at, updated_at
    ) values (
      @id, @tenantId, @email, @name, @passwordHash, @sessionVersion, @role, 1, @createdAt, @updatedAt
    )
  `);
  const updateUser = db.prepare(`
    update users
    set tenant_id = @tenantId,
        name = @name,
        password_hash = @passwordHash,
        session_version = @sessionVersion,
        role = @role,
        is_active = 1,
        updated_at = @updatedAt
    where id = @id
  `);

  for (const user of E2E_USERS) {
    const existing = selectUser.get(user.email) as { id: string; sessionVersion: number } | undefined;

    if (existing) {
      updateUser.run({
        id: existing.id,
        tenantId,
        name: user.name,
        passwordHash,
        sessionVersion: (existing.sessionVersion ?? 1) + 1,
        role: user.role,
        updatedAt: now,
      });
      continue;
    }

    insertUser.run({
      id: nanoid(),
      tenantId,
      email: user.email,
      name: user.name,
      passwordHash,
      sessionVersion: 1,
      role: user.role,
      createdAt: now,
      updatedAt: now,
    });
  }
}

function ensureSecondarySite(db: Database.Database, tenantId: string, companyId: string) {
  const activeSites = db
    .prepare('select id, name from sites where tenant_id = ? and is_active = 1 order by created_at asc')
    .all(tenantId) as Array<{ id: string; name: string }>;

  if (activeSites.length >= 2) {
    return;
  }

  const existing = db
    .prepare('select id from sites where tenant_id = ? and name = ?')
    .get(tenantId, SECONDARY_SITE_NAME) as { id: string } | undefined;

  if (existing) {
    db.prepare('update sites set is_active = 1, updated_at = ? where id = ?').run(
      new Date().toISOString(),
      existing.id
    );
    return;
  }

  const now = new Date().toISOString();
  db.prepare(`
    insert into sites (
      id, tenant_id, company_id, name, address, phone, is_active, created_at, updated_at
    ) values (
      @id, @tenantId, @companyId, @name, @address, @phone, 1, @createdAt, @updatedAt
    )
  `).run({
    id: nanoid(),
    tenantId,
    companyId,
    name: SECONDARY_SITE_NAME,
    address: 'E2E Secondary Site',
    phone: '0000000001',
    createdAt: now,
    updatedAt: now,
  });
}

function cleanupPriorRunArtifacts(db: Database.Database, tenantId: string) {
  // Test runs accumulate E2E products, providers, cash sessions, sales,
  // purchases, transfers, and audit rows under predictable prefixes. Left
  // unbounded, `inventory.listStock` (page 1 of 10 rows) stops returning
  // recently-seeded products because older ones dominate the list. Prune
  // everything tagged `E2E`/`e2e_` that was created before the current run.
  //
  // This keeps individual tests isolated (each seeds its own fresh data)
  // while keeping the shared ledger bounded across CI runs. We keep the
  // four template users (e2e.admin/manager/cashier/viewer) plus
  // `E2E Branch Site` so global-setup itself stays idempotent.

  const keepUserPrefixes = ['e2e.admin@', 'e2e.manager@', 'e2e.cashier@', 'e2e.viewer@'];
  const keepUserClause = keepUserPrefixes.map(() => 'email not like ?').join(' and ');
  const keepUserArgs = keepUserPrefixes.map(prefix => `${prefix}%`);

  // Delete audit_logs referencing the soon-to-disappear actors.
  db.prepare(
    `delete from audit_logs
     where tenant_id = ?
       and actor_id in (
         select id from users
         where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
       )`
  ).run(tenantId, tenantId, ...keepUserArgs);

  // Transfer-related rows — children first so FK-driven cascades don't
  // strand rows (the schema uses `ON DELETE CASCADE` on most of them, but
  // older installs may not have the FK — explicit delete is safer).
  db.prepare(
    `delete from transfer_order_items
     where transfer_order_id in (select id from transfer_orders where tenant_id = ? and notes like 'E2E %')`
  ).run(tenantId);
  db.prepare(
    `delete from transfer_orders where tenant_id = ? and notes like 'E2E %'`
  ).run(tenantId);

  // Sale lifecycle.
  db.prepare(
    `delete from sale_items where sale_id in (
       select id from sales where created_by in (
         select id from users where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
       )
     )`
  ).run(tenantId, ...keepUserArgs);
  db.prepare(
    `delete from sale_payments where sale_id in (
       select id from sales where created_by in (
         select id from users where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
       )
     )`
  ).run(tenantId, ...keepUserArgs);
  db.prepare(
    `delete from sale_returns where sale_id in (
       select id from sales where created_by in (
         select id from users where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
       )
     )`
  ).run(tenantId, ...keepUserArgs);
  db.prepare(
    `delete from sales where created_by in (
       select id from users where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
     )`
  ).run(tenantId, ...keepUserArgs);

  // Purchase lifecycle.
  db.prepare(
    `delete from purchase_return_items where purchase_return_id in (
       select id from purchase_returns where purchase_id in (
         select id from purchases where created_by in (
           select id from users where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
         )
       )
     )`
  ).run(tenantId, ...keepUserArgs);
  db.prepare(
    `delete from purchase_returns where purchase_id in (
       select id from purchases where created_by in (
         select id from users where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
       )
     )`
  ).run(tenantId, ...keepUserArgs);
  db.prepare(
    `delete from purchase_items where purchase_id in (
       select id from purchases where created_by in (
         select id from users where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
       )
     )`
  ).run(tenantId, ...keepUserArgs);
  db.prepare(
    `delete from purchases where created_by in (
       select id from users where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
     )`
  ).run(tenantId, ...keepUserArgs);

  // Cash movements + sessions for the disposable users.
  db.prepare(
    `delete from cash_movements where session_id in (
       select id from cash_sessions where cashier_id in (
         select id from users where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
       )
     )`
  ).run(tenantId, ...keepUserArgs);
  db.prepare(
    `delete from cash_sessions where cashier_id in (
       select id from users where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
     )`
  ).run(tenantId, ...keepUserArgs);

  // Quotations lifecycle — clear before products so FK on
  // quotation_items.product_id does not block the product delete below.
  db.prepare(
    `delete from quotation_items where product_id in (
       select id from products where tenant_id = ? and name like 'E2E %'
     )`
  ).run(tenantId);
  db.prepare(
    `delete from quotations where tenant_id = ? and created_by in (
       select id from users where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
     )`
  ).run(tenantId, tenantId, ...keepUserArgs);

  // Inventory artefacts tied to the disposable products.
  db.prepare(
    `delete from inventory_movements where product_id in (
       select id from products where tenant_id = ? and name like 'E2E %'
     )`
  ).run(tenantId);
  db.prepare(
    `delete from inventory_balances where product_id in (
       select id from products where tenant_id = ? and name like 'E2E %'
     )`
  ).run(tenantId);
  db.prepare(
    `delete from unit_x_product where product_id in (
       select id from products where tenant_id = ? and name like 'E2E %'
     )`
  ).run(tenantId);

  // Disposable products + providers.
  db.prepare(
    `delete from products where tenant_id = ? and name like 'E2E %'`
  ).run(tenantId);
  db.prepare(
    `delete from providers where tenant_id = ? and name like 'E2E Provider %'`
  ).run(tenantId);

  // Finally the disposable user accounts (template users are kept).
  db.prepare(
    `delete from users
     where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}`
  ).run(tenantId, ...keepUserArgs);
}

export default async function globalSetup(_config: FullConfig) {
  const db = new Database(DB_PATH);

  try {
    const tenant = db.prepare('select id from tenants order by created_at asc limit 1').get() as
      | { id: string }
      | undefined;
    const company = db
      .prepare('select id from companies where tenant_id = ? order by created_at asc limit 1')
      .get(tenant?.id ?? '') as { id: string } | undefined;

    if (!tenant?.id || !company?.id) {
      throw new Error('Unable to prepare E2E baseline: tenant/company not found.');
    }

    // Clean up artefacts from prior runs BEFORE asserting the baseline so
    // downstream tests see a lean catalog. Running inside a transaction so
    // a partial failure doesn't leave dangling children.
    db.transaction(() => {
      cleanupPriorRunArtifacts(db, tenant.id);
    })();

    ensureSecondarySite(db, tenant.id, company.id);
    await ensureUsers(db, tenant.id);
  } finally {
    db.close();
  }
}
