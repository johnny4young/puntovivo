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
export const FIRST_SALE_E2E_EMAIL = 'e2e.first-sale@local.test';
const FIRST_SALE_TENANT_SLUG = 'e2e-first-sale';

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
 * ENG-141b — signed day closes are immutable in production, including direct
 * SQL writes. The shared E2E database must still start each suite from a
 * repeatable baseline, so fixture setup temporarily removes the sign-off and
 * PDF guards, deletes only the isolated E2E tenant's artifacts before their
 * parent evidence, and immediately restores the exact production triggers.
 * Domain tests separately pin that ordinary writes remain rejected.
 */
function resetDayCloseSignoffs(db: Database.Database, tenantId: string): void {
  const tableExists = db
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'day_close_signoffs'")
    .get();
  if (!tableExists) return;
  const artifactTableExists = Boolean(
    db
      .prepare("select 1 from sqlite_master where type = 'table' and name = 'day_close_artifacts'")
      .get()
  );

  db.exec(`
    DROP TRIGGER IF EXISTS trg_day_close_signoffs_no_update;
    DROP TRIGGER IF EXISTS trg_day_close_signoffs_no_delete;
    DROP TRIGGER IF EXISTS day_close_artifacts_immutable_update;
    DROP TRIGGER IF EXISTS day_close_artifacts_immutable_delete;
  `);
  try {
    db.prepare(
      "delete from audit_logs where tenant_id = ? and resource_type = 'day_close_signoff'"
    ).run(tenantId);
    if (artifactTableExists) {
      db.prepare('delete from day_close_artifacts where tenant_id = ?').run(tenantId);
    }
    db.prepare('delete from day_close_signoffs where tenant_id = ?').run(tenantId);
  } finally {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_day_close_signoffs_no_update
      BEFORE UPDATE ON day_close_signoffs
      BEGIN
        SELECT RAISE(ABORT, 'day_close_signoffs are immutable');
      END;
      CREATE TRIGGER IF NOT EXISTS trg_day_close_signoffs_no_delete
      BEFORE DELETE ON day_close_signoffs
      BEGIN
        SELECT RAISE(ABORT, 'day_close_signoffs are immutable');
      END;
    `);
    if (artifactTableExists) {
      db.exec(`
        CREATE TRIGGER IF NOT EXISTS day_close_artifacts_immutable_update
        BEFORE UPDATE ON day_close_artifacts
        BEGIN
          SELECT RAISE(ABORT, 'day_close_artifacts are immutable');
        END;
        CREATE TRIGGER IF NOT EXISTS day_close_artifacts_immutable_delete
        BEFORE DELETE ON day_close_artifacts
        BEGIN
          SELECT RAISE(ABORT, 'day_close_artifacts are immutable');
        END;
      `);
    }
  }
}

/**
 * Upsert the 4 template users (`E2E_USERS`) with a fresh argon2 password
 * hash and bumped `session_version` so any stale JWT from a previous run
 * is invalidated. Idempotent: safe to call twice.
 */
export async function ensureUsers(db: Database.Database, tenantId: string): Promise<void> {
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
        staff_pin_hash = null,
        session_version = @sessionVersion,
        role = @role,
        is_active = 1,
        updated_at = @updatedAt
    where id = @id
  `);

  for (const user of E2E_USERS) {
    const existing = selectUser.get(user.email) as
      { id: string; sessionVersion: number } | undefined;

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
export function cleanupPriorRunArtifacts(db: Database.Database, tenantId: string): void {
  const keepUserPrefixes = ['e2e.admin@', 'e2e.manager@', 'e2e.cashier@', 'e2e.viewer@'];
  const keepUserClause = keepUserPrefixes.map(() => 'email not like ?').join(' and ');
  const keepUserArgs = keepUserPrefixes.map(prefix => `${prefix}%`);

  resetDayCloseSignoffs(db, tenantId);

  // ENG-106c1 — approval decisions reference both the requesting cashier and
  // approving manager. Clear the sync/audit children first so a failed smoke
  // never strands a request that blocks user cleanup or appears in the next
  // manager queue.
  db.prepare(
    "delete from sync_outbox where tenant_id = ? and entity_type = 'manager_approval_requests'"
  ).run(tenantId);
  db.prepare(
    "delete from audit_logs where tenant_id = ? and resource_type = 'manager_approval'"
  ).run(tenantId);
  db.prepare('delete from manager_approval_requests where tenant_id = ?').run(tenantId);

  // ENG-106b — attendance belongs to the shared template employees, so a
  // failed prior smoke could otherwise leave the next run already clocked
  // in. This is an isolated E2E tenant; clear both the rows and their soft
  // audit references before recreating the deterministic baseline.
  const employeeShiftCorrectionsTableExists = db
    .prepare(
      "select 1 from sqlite_master where type = 'table' and name = 'employee_shift_corrections'"
    )
    .get();
  if (employeeShiftCorrectionsTableExists) {
    // ENG-140e correction snapshots deliberately use NO ACTION foreign keys
    // and immutable triggers. E2E owns this isolated tenant, so drop the
    // append-only children before their raw attendance parents.
    db.prepare('delete from employee_shift_corrections where tenant_id = ?').run(tenantId);
  }
  const employeeShiftBreaksTableExists = db
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'employee_shift_breaks'")
    .get();
  if (employeeShiftBreaksTableExists) {
    db.prepare(
      "delete from audit_logs where tenant_id = ? and resource_type = 'employee_shift_break'"
    ).run(tenantId);
    db.prepare('delete from employee_shift_breaks where tenant_id = ?').run(tenantId);
  }
  // ENG-140d — cash sessions now retain nullable attendance evidence. The
  // isolated baseline deliberately resets every shift while preserving the
  // template drawers, so detach those historical/session rows before deleting
  // the labor parent. The column check keeps this cleanup compatible with a
  // pre-0019 database during migration troubleshooting.
  const cashSessionHasEmployeeShift = (
    db.prepare("pragma table_info('cash_sessions')").all() as Array<{ name: string }>
  ).some(column => column.name === 'employee_shift_id');
  if (cashSessionHasEmployeeShift) {
    db.prepare('update cash_sessions set employee_shift_id = null where tenant_id = ?').run(
      tenantId
    );
  }
  db.prepare("delete from audit_logs where tenant_id = ? and resource_type = 'employee_shift'").run(
    tenantId
  );
  db.prepare('delete from employee_shifts where tenant_id = ?').run(tenantId);

  // ENG-140a — published schedules reference template users/sites and keep
  // their own audit chain. Clear the isolated tenant before user cleanup so
  // repeat E2E runs never retain a foreign-key or overlap from a prior smoke.
  const scheduledShiftsTableExists = db
    .prepare("select 1 from sqlite_master where type = 'table' and name = 'scheduled_shifts'")
    .get();
  if (scheduledShiftsTableExists) {
    db.prepare(
      "delete from audit_logs where tenant_id = ? and resource_type = 'scheduled_shift'"
    ).run(tenantId);
    db.prepare('delete from scheduled_shifts where tenant_id = ?').run(tenantId);
  }

  // Delete audit_logs referencing the soon-to-disappear actors.
  db.prepare(
    `delete from audit_logs
     where tenant_id = ?
       and actor_id in (
         select id from users
         where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
       )`
  ).run(tenantId, tenantId, ...keepUserArgs);

  // ENG-053 journal rows reference both users and devices. Clear the
  // children explicitly so older DBs without FK cascades stay cleanup-safe.
  db.prepare(
    `delete from operation_errors
     where operation_event_id in (
       select id from operation_events
       where tenant_id = ?
         and user_id in (
           select id from users
           where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
         )
     )`
  ).run(tenantId, tenantId, ...keepUserArgs);
  db.prepare(
    `delete from operation_effects
     where operation_event_id in (
       select id from operation_events
       where tenant_id = ?
         and user_id in (
           select id from users
           where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
         )
     )`
  ).run(tenantId, tenantId, ...keepUserArgs);
  db.prepare(
    `delete from operation_events
     where tenant_id = ?
       and user_id in (
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

  // Login creates a refresh-token family for every disposable account.
  // The family has a restrictive user FK, so clear it before deleting the
  // account on the next run. Keeping this explicit also supports databases
  // created before refresh-family cleanup was part of the E2E baseline.
  db.prepare(
    `delete from auth_refresh_families
     where tenant_id = ?
       and user_id in (
         select id from users
         where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
       )`
  ).run(tenantId, tenantId, ...keepUserArgs);
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
  db.prepare(`delete from transfer_orders where tenant_id = ? and notes like 'E2E %'`).run(
    tenantId
  );

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
    `delete from initial_inventory where product_id in (
       select id from products where tenant_id = ? and name like 'E2E %'
     )`
  ).run(tenantId);
  db.prepare(
    `delete from unit_x_product where product_id in (
       select id from products where tenant_id = ? and name like 'E2E %'
     )`
  ).run(tenantId);
  db.prepare(
    `delete from product_x_provider where product_id in (
       select id from products where tenant_id = ? and name like 'E2E %'
     )`
  ).run(tenantId);

  // Order lines reference products; their parent orders may belong to
  // any actor, not only E2E users, so scope by product id.
  db.prepare(
    `delete from order_items where product_id in (
       select id from products where tenant_id = ? and name like 'E2E %'
     )`
  ).run(tenantId);

  // Belt-and-braces: the actor-scoped deletes above only catch children
  // whose parent (sale, purchase, purchase_return, transfer_order) is
  // owned by an E2E user. If a prior run left orphaned line items that
  // reference an E2E product through a non-E2E parent, the upcoming
  // product delete would fail with a FOREIGN KEY constraint error. Scope
  // the same children by product id so the cleanup is idempotent against
  // any historical state.
  db.prepare(
    `delete from sale_items where product_id in (
       select id from products where tenant_id = ? and name like 'E2E %'
     )`
  ).run(tenantId);
  db.prepare(
    `delete from purchase_items where product_id in (
       select id from products where tenant_id = ? and name like 'E2E %'
     )`
  ).run(tenantId);
  db.prepare(
    `delete from purchase_return_items where product_id in (
       select id from products where tenant_id = ? and name like 'E2E %'
     )`
  ).run(tenantId);
  db.prepare(
    `delete from transfer_order_items where product_id in (
       select id from products where tenant_id = ? and name like 'E2E %'
     )`
  ).run(tenantId);

  // Launch-import and ledger journeys create durable E2E customers with
  // template actors. They are therefore not covered by the disposable-user
  // cleanup above and eventually push fresh fixtures past the first 50 rows
  // rendered by the customer list. Detach historical snapshot references,
  // remove the isolated ledger/audit/sync children, then prune the customer.
  const e2eCustomerIds = `select id from customers where tenant_id = ? and name like 'E2E %'`;
  db.prepare(
    `delete from customer_ledger_entries where tenant_id = ? and customer_id in (${e2eCustomerIds})`
  ).run(tenantId, tenantId);
  for (const table of ['sales', 'fiscal_documents', 'quotations', 'delivery_orders']) {
    db.prepare(
      `update ${table} set customer_id = null where tenant_id = ? and customer_id in (${e2eCustomerIds})`
    ).run(tenantId, tenantId);
  }
  db.prepare(
    `delete from sync_outbox where tenant_id = ? and entity_type = 'customers' and entity_id in (${e2eCustomerIds})`
  ).run(tenantId, tenantId);
  db.prepare(
    `delete from audit_logs where tenant_id = ? and resource_type = 'customer' and resource_id in (${e2eCustomerIds})`
  ).run(tenantId, tenantId);
  db.prepare(`delete from customers where tenant_id = ? and name like 'E2E %'`).run(tenantId);

  // Disposable products + providers.
  db.prepare(`delete from products where tenant_id = ? and name like 'E2E %'`).run(tenantId);
  db.prepare(`delete from providers where tenant_id = ? and name like 'E2E Provider %'`).run(
    tenantId
  );

  // Finally the disposable user accounts (template users are kept).
  db.prepare(
    `delete from users
     where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}`
  ).run(tenantId, ...keepUserArgs);
}

/**
 * ENG-104 added a post-login redirect that sends admin users to
 * `/company?tab=readiness` when `tenants.settings.setupAcknowledgedAt`
 * is null and the readiness aggregate reports blockers. E2E tests
 * expect the admin to land on `/dashboard` (and every other test that
 * navigates after login assumes the redirect is not active), so the
 * baseline emulates an operator who has already acknowledged the
 * readiness checklist. The flag stays set across runs; the upsert is
 * idempotent.
 */
export function ensureSetupAcknowledged(db: Database.Database, tenantId: string): void {
  db.prepare(
    `update tenants
        set settings = json_set(
              coalesce(settings, '{}'),
              '$.setupAcknowledgedAt',
              ?
            ),
            updated_at = datetime('now')
      where id = ?
        and json_extract(coalesce(settings, '{}'), '$.setupAcknowledgedAt') is null`
  ).run(new Date().toISOString(), tenantId);
}

/**
 * ENG-134g — the module-gated surfaces (`/touch`, `/kds`,
 * `/customer-display`, `/m`, `/delivery`) ship OFF by default on a
 * fresh retail tenant, so the Playwright a11y smoke could never reach
 * them (`SurfaceShellRoute` redirects to `/dashboard` when the module
 * is off). The baseline flips them on for the e2e tenant so the smoke
 * can axe-scan each surface. The ids match `CLIENT_MODULE_IDS` in
 * `apps/web/src/features/modules/manifest.ts`.
 */
export const E2E_ENABLED_MODULES: readonly string[] = [
  'pos-touch',
  'kds',
  'customer-display',
  'mobile-waiter',
  'delivery',
] as const;

/**
 * Force-enable the given tenant modules by writing an explicit `true`
 * override into `tenants.settings.modules.<id>`. This is the exact
 * write the `modules.setActive` tRPC mutation performs
 * (`json_set` of `$.modules.<id>` to a real JSON boolean —
 * `packages/server/src/trpc/routers/modules.ts`), so the server's
 * `resolveModulesState` reads it back as effectively-enabled and the
 * renderer's `modules.getEffective` gate lets the surface render.
 * Idempotent: re-running overwrites the same `true` value. The hyphen
 * in ids like `pos-touch` is valid in an unquoted SQLite JSON path
 * (the production mutation relies on the same shape).
 */
export function ensureModulesEnabled(
  db: Database.Database,
  tenantId: string,
  moduleIds: readonly string[] = E2E_ENABLED_MODULES
): void {
  const stmt = db.prepare(
    `update tenants
        set settings = json_set(
              coalesce(settings, '{}'),
              ?,
              json('true')
            ),
            updated_at = datetime('now')
      where id = ?`
  );
  for (const moduleId of moduleIds) {
    stmt.run(`$.modules.${moduleId}`, tenantId);
  }
}

/**
 * Resolve the first tenant + its first company in the DB. Both E2E
 * runners assume a single tenant (seeded by `seedDefaultData` in
 * `packages/server/src/db/seed.ts`); throws if the DB is missing
 * either, which means the caller booted against an unmigrated DB.
 */
export function resolveTenantAndCompany(db: Database.Database): {
  tenantId: string;
  companyId: string;
} {
  const tenant = db.prepare('select id from tenants order by created_at asc limit 1').get() as
    { id: string } | undefined;
  const company = db
    .prepare('select id from companies where tenant_id = ? order by created_at asc limit 1')
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
    ensureSetupAcknowledged(db, tenantId);
    ensureModulesEnabled(db, tenantId);
  })();

  ensureSecondarySite(db, tenantId, companyId);
  await ensureUsers(db, tenantId);
}

/**
 * ENG-202 — Reset the dedicated first-sale tenant to a true zero-product,
 * zero-drawer, zero-sale state. Reuses the baseline's disposal choreography
 * so reruns remove the prior sale's children, inventory rows, device/session
 * records, and disposable actor before recreating the known admin account.
 */
export async function prepareFirstSaleBaseline(db: Database.Database): Promise<void> {
  const now = new Date().toISOString();
  let tenant = db.prepare('select id from tenants where slug = ?').get(FIRST_SALE_TENANT_SLUG) as
    { id: string } | undefined;

  if (!tenant) {
    tenant = { id: nanoid() };
    db.prepare(
      `insert into tenants (id, name, slug, settings, created_at, updated_at)
       values (?, 'E2E First Sale Tenant', ?, '{}', ?, ?)`
    ).run(tenant.id, FIRST_SALE_TENANT_SLUG, now, now);
  }

  let company = db
    .prepare('select id from companies where tenant_id = ? order by created_at asc limit 1')
    .get(tenant.id) as { id: string } | undefined;
  if (!company) {
    company = { id: nanoid() };
    db.prepare(
      `insert into companies (id, tenant_id, name, created_at, updated_at)
       values (?, ?, 'E2E First Sale Company', ?, ?)`
    ).run(company.id, tenant.id, now, now);
  }

  let site = db
    .prepare('select id from sites where tenant_id = ? order by created_at asc limit 1')
    .get(tenant.id) as { id: string } | undefined;
  if (!site) {
    site = { id: nanoid() };
    db.prepare(
      `insert into sites (
         id, tenant_id, company_id, name, address, phone, is_active, created_at, updated_at
       ) values (?, ?, ?, 'E2E First Sale Site', 'E2E onboarding', '0000000202', 1, ?, ?)`
    ).run(site.id, tenant.id, company.id, now, now);
  }

  db.transaction(() => {
    cleanupPriorRunArtifacts(db, tenant.id);
    db.prepare('delete from sync_conflicts where tenant_id = ?').run(tenant.id);
    db.prepare('delete from sync_outbox where tenant_id = ?').run(tenant.id);
    ensureSetupAcknowledged(db, tenant.id);
    db.prepare(
      `insert into tenant_locale_settings (tenant_id, country_code, updated_at)
       values (?, 'CO', ?)
       on conflict(tenant_id) do update set country_code = 'CO', updated_at = excluded.updated_at`
    ).run(tenant.id, now);
    db.prepare(
      `insert into units (
         id, tenant_id, name, abbreviation, dimension, standard_code,
         reference_factor, is_active, created_at, updated_at
       ) values (?, ?, 'Unit', 'UND', 'count', 'H87', 1, 1, ?, ?)
       on conflict(tenant_id, abbreviation) do update set
         name = excluded.name,
         is_active = 1,
         updated_at = excluded.updated_at`
    ).run(nanoid(), tenant.id, now, now);
    db.prepare(
      `insert into sequentials (
         id, tenant_id, site_id, document_type, prefix, current_value,
         created_at, updated_at
       ) values (?, ?, ?, 'sale', 'E2E-FS-', 0, ?, ?)
       on conflict(tenant_id, site_id, document_type) do update set
         prefix = excluded.prefix,
         current_value = 0,
         updated_at = excluded.updated_at`
    ).run(nanoid(), tenant.id, site.id, now, now);
  })();

  const passwordHash = await argon2.hash(E2E_PASSWORD);
  db.prepare(
    `insert into users (
       id, tenant_id, email, name, password_hash, session_version,
       role, is_active, created_at, updated_at
     ) values (?, ?, ?, 'E2E First Sale Admin', ?, 1, 'admin', 1, ?, ?)`
  ).run(nanoid(), tenant.id, FIRST_SALE_E2E_EMAIL, passwordHash, now, now);
}
