/**
 * ENG-001 Step 3 — shared E2E baseline preparation.
 *
 * Both the web Playwright suite (`e2e/web/global-setup.ts`) and the
 * Electron smoke runner (`e2e/electron/global-setup.ts`) need the same
 * tenant to end up with:
 *
 *   - 4 template users with known credentials
 *     (`e2e.admin@local.test`, `e2e.manager@local.test`,
 *     `e2e.cashier@local.test`, `e2e.viewer@local.test`; shared password
 *     `PuntovivoE2E!123`).
 *   - At least 2 active sites so inventory transfers have somewhere to go.
 *   - Artefacts from prior runs pruned so the catalog and history lists
 *     stay bounded under parallel reruns.
 *
 * This module performs those three tasks against ANY `better-sqlite3`
 * database handle supplied by the caller. The web runner opens
 * `packages/server/data/local.db` and passes the handle; the Electron
 * runner opens a per-run tmpdir DB after booting the embedded server
 * once to materialise the schema, then passes that handle.
 *
 * @module e2e/shared/baseline
 */

import type Database from 'better-sqlite3';
import argon2 from 'argon2';
import { nanoid } from 'nanoid';

/** Shared password for every E2E template user. Documented in `docs/DEV-SEED.md`. */
export const E2E_PASSWORD = 'PuntovivoE2E!123';

export interface E2EUserProfile {
  email: string;
  name: string;
  role: 'admin' | 'manager' | 'cashier' | 'viewer';
}

export const E2E_USERS: readonly E2EUserProfile[] = [
  { email: 'e2e.admin@local.test', name: 'E2E Admin', role: 'admin' },
  { email: 'e2e.manager@local.test', name: 'E2E Manager', role: 'manager' },
  { email: 'e2e.cashier@local.test', name: 'E2E Cashier', role: 'cashier' },
  { email: 'e2e.viewer@local.test', name: 'E2E Viewer', role: 'viewer' },
] as const;

export const SECONDARY_SITE_NAME = 'E2E Branch Site';

/**
 * Upsert the 4 template users (`E2E_USERS`) with a fresh argon2 password
 * hash and bumped `session_version` so any stale JWT from a previous run
 * is invalidated. Idempotent: safe to call twice.
 */
export async function ensureUsers(
  db: Database.Database,
  tenantId: string
): Promise<void> {
  const passwordHash = await argon2.hash(E2E_PASSWORD);
  const now = new Date().toISOString();

  const selectUser = db.prepare(
    'select id, session_version as sessionVersion from users where email = ?'
  );
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
    const existing = selectUser.get(user.email) as
      | { id: string; sessionVersion: number }
      | undefined;

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

/**
 * Ensure the tenant has at least 2 active sites so inventory transfer
 * tests always have a `from` and `to` to pick from. Idempotent: if the
 * secondary site already exists we just reactivate it; if the tenant
 * already has two or more active sites we return without touching
 * anything.
 */
export function ensureSecondarySite(
  db: Database.Database,
  tenantId: string,
  companyId: string
): void {
  const activeSites = db
    .prepare(
      'select id, name from sites where tenant_id = ? and is_active = 1 order by created_at asc'
    )
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
  db.prepare(
    `
    insert into sites (
      id, tenant_id, company_id, name, address, phone, is_active, created_at, updated_at
    ) values (
      @id, @tenantId, @companyId, @name, @address, @phone, 1, @createdAt, @updatedAt
    )
  `
  ).run({
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

/**
 * Delete test artefacts (products, providers, sales, purchases, cash
 * sessions, quotations, audit rows, disposable users) created by prior
 * E2E runs so the shared ledger stays bounded. Template users and the
 * secondary site are preserved so `ensureUsers()` /
 * `ensureSecondarySite()` remain idempotent.
 */
export function cleanupPriorRunArtifacts(
  db: Database.Database,
  tenantId: string
): void {
  const keepUserPrefixes = [
    'e2e.admin@',
    'e2e.manager@',
    'e2e.cashier@',
    'e2e.viewer@',
  ];
  const keepUserClause = keepUserPrefixes
    .map(() => 'email not like ?')
    .join(' and ');
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

  // Device registration happens during login. Critical mutations then
  // reserve idempotency keys against those devices, so both must be
  // cleared before disposable E2E users can be removed.
  db.prepare(
    `delete from idempotency_keys
     where tenant_id = ?
       and device_id in (
         select id from devices
         where tenant_id = ?
           and registered_by_user_id in (
             select id from users
             where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
           )
       )`
  ).run(tenantId, tenantId, tenantId, ...keepUserArgs);
  db.prepare(
    `delete from devices
     where tenant_id = ?
       and registered_by_user_id in (
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

/**
 * Resolve the first tenant + its first company in the DB. Both E2E
 * runners assume a single tenant (seeded by `seedDefaultData` in
 * `packages/server/src/db/seed.ts`); throws if the DB is missing
 * either, which means the caller booted against an unmigrated DB.
 */
export function resolveTenantAndCompany(
  db: Database.Database
): { tenantId: string; companyId: string } {
  const tenant = db
    .prepare('select id from tenants order by created_at asc limit 1')
    .get() as { id: string } | undefined;
  const company = db
    .prepare(
      'select id from companies where tenant_id = ? order by created_at asc limit 1'
    )
    .get(tenant?.id ?? '') as { id: string } | undefined;

  if (!tenant?.id || !company?.id) {
    throw new Error(
      'Unable to prepare E2E baseline: tenant/company not found in DB. Did the embedded server migrate and seed against the expected path?'
    );
  }
  return { tenantId: tenant.id, companyId: company.id };
}

/**
 * Full prep sequence, orchestrated: cleanup → ensureSecondarySite →
 * ensureUsers. Transaction-wraps the cleanup so a partial failure does
 * not leave dangling children. Safe to call multiple times.
 */
export async function prepareBaseline(db: Database.Database): Promise<void> {
  const { tenantId, companyId } = resolveTenantAndCompany(db);

  db.transaction(() => {
    cleanupPriorRunArtifacts(db, tenantId);
  })();

  ensureSecondarySite(db, tenantId, companyId);
  await ensureUsers(db, tenantId);
}
