/**
 * Step 3 — shared E2E baseline preparation.
 *
 * Both the web Playwright suite (`e2e/web/global-setup.ts`) and the
 * Electron smoke runner (`e2e/electron/global-setup.ts`) need the same
 * tenant to end up with:
 *
 * - 4 template users with known credentials
 * (`e2e.admin@local.test`, `e2e.manager@local.test`,
 * `e2e.cashier@local.test`, `e2e.viewer@local.test`; shared password
 * `PuntovivoE2E!123`).
 * - At least 2 active sites so inventory transfers have somewhere to go.
 * - Sale, purchase, order, and quotation numbering for every active site.
 * - Artefacts from prior runs pruned so the catalog and history lists
 * stay bounded under parallel reruns.
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
export const COMPANION_E2E_MANAGER_EMAIL = 'e2e.companion.manager@local.test';
export const COMPANION_E2E_VIEWER_EMAIL = 'e2e.companion.viewer@local.test';
const COMPANION_E2E_TENANT_SLUG = 'e2e-companion';

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
const E2E_TEMPLATE_USER_PREFIXES = [
  'e2e.admin@',
  'e2e.manager@',
  'e2e.cashier@',
  'e2e.viewer@',
] as const;

/**
 * Remove unfinished synchronization state for one disposable E2E tenant.
 *
 * The shared baseline deliberately preserves template users and catalog
 * fixtures, but it does not preserve queued work or conflict-review evidence.
 * A queued write whose fixture was deleted can otherwise become a conflict
 * during the next journey and contaminate its readiness state and screenshot.
 */
export function resetTenantSyncState(db: Database.Database, tenantId: string): void {
  for (const table of ['sync_conflicts', 'sync_outbox'] as const) {
    const tableExists = db
      .prepare("select 1 from sqlite_master where type = 'table' and name = ?")
      .get(table);
    if (tableExists) {
      db.prepare(`delete from ${table} where tenant_id = ?`).run(tenantId);
    }
  }
}

/**
 * Remove promotion rules owned by a disposable E2E actor or scoped to an E2E
 * catalog fixture. Promotion targets and immutable sale-line snapshots use
 * restrictive foreign keys, so a failed checkout must prune those children
 * before the shared baseline can remove its customer, product, or actor.
 *
 * The schema probes keep historical/pre-0055 databases usable while operators
 * diagnose migrations. This helper is only used for the isolated E2E tenant;
 * production sale history is never rewritten by application code.
 */
export function cleanupPromotionArtifacts(db: Database.Database, tenantId: string): void {
  const tableExists = (name: string) =>
    Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name));
  if (!tableExists('promotions')) return;

  const keepUserClause = E2E_TEMPLATE_USER_PREFIXES.map(() => 'actor.email not like ?').join(
    ' and '
  );
  const keepUserArgs = E2E_TEMPLATE_USER_PREFIXES.map(prefix => `${prefix}%`);
  const promotionIds = (
    db
      .prepare(
        `select promotion.id
         from promotions as promotion
         where promotion.tenant_id = ?
           and (
             promotion.name like 'E2E %'
             or exists (
               select 1
               from users as actor
               where actor.tenant_id = promotion.tenant_id
                 and actor.id in (promotion.created_by, promotion.updated_by)
                 and actor.email like 'e2e.%@local.test'
                 and ${keepUserClause}
             )
             or exists (
               select 1
               from products as target_product
               where target_product.tenant_id = promotion.tenant_id
                 and target_product.id = promotion.product_id
                 and (
                   target_product.name like 'E2E %'
                   or target_product.sku like 'E2E-LANZAMIENTO-%'
                 )
             )
             or exists (
               select 1
               from customers as target_customer
               where target_customer.tenant_id = promotion.tenant_id
                 and target_customer.id = promotion.customer_id
                 and target_customer.name like 'E2E %'
             )
           )`
      )
      .all(tenantId, ...keepUserArgs) as Array<{ id: string }>
  ).map(row => row.id);
  if (promotionIds.length === 0) return;

  const placeholders = promotionIds.map(() => '?').join(', ');
  const tenantAndIds = [tenantId, ...promotionIds] as const;

  if (tableExists('sale_item_promotions')) {
    db.prepare(
      `delete from sale_item_promotions
       where tenant_id = ? and promotion_id in (${placeholders})`
    ).run(...tenantAndIds);
  }
  if (tableExists('price_suggestions')) {
    const hasPromotionId = (
      db.prepare("pragma table_info('price_suggestions')").all() as Array<{ name: string }>
    ).some(column => column.name === 'promotion_id');
    if (hasPromotionId) {
      db.prepare(
        `update price_suggestions
         set promotion_id = null
         where tenant_id = ? and promotion_id in (${placeholders})`
      ).run(...tenantAndIds);
    }
  }
  if (tableExists('sync_outbox')) {
    db.prepare(
      `delete from sync_outbox
       where tenant_id = ? and entity_type = 'promotions' and entity_id in (${placeholders})`
    ).run(...tenantAndIds);
  }
  if (tableExists('audit_logs')) {
    db.prepare(
      `delete from audit_logs
       where tenant_id = ? and resource_type = 'promotion' and resource_id in (${placeholders})`
    ).run(...tenantAndIds);
  }
  db.prepare(`delete from promotions where tenant_id = ? and id in (${placeholders})`).run(
    ...tenantAndIds
  );
}

function disposableE2EUsersCte(): { sql: string; args: string[] } {
  const keepClause = E2E_TEMPLATE_USER_PREFIXES.map(() => 'email not like ?').join(' and ');
  return {
    sql: `with disposable_e2e_users(id) as (
      select id from users
      where tenant_id = ? and email like 'e2e.%@local.test' and ${keepClause}
    )`,
    args: E2E_TEMPLATE_USER_PREFIXES.map(prefix => `${prefix}%`),
  };
}

/**
 * Remove restrictive financial and sale bridge rows owned by a disposable E2E
 * actor or attached to another disposable E2E parent. Parent ownership is
 * considered as well as each row's own actor so a partially completed run
 * cannot strand an operator-authored child on an E2E purchase, quote, return,
 * or sale. The tenant correlation on every parent lookup prevents cross-tenant
 * cleanup.
 */
export function cleanupRestrictiveBusinessLinks(db: Database.Database, tenantId: string): void {
  const { sql: disposableUsersCte, args: keepUserArgs } = disposableE2EUsersCte();
  const runForDisposableUsers = (statement: string) =>
    db.prepare(`${disposableUsersCte}\n${statement}`).run(tenantId, ...keepUserArgs, tenantId);
  const allForDisposableUsers = <T>(statement: string) =>
    db
      .prepare(`${disposableUsersCte}\n${statement}`)
      .all(tenantId, ...keepUserArgs, tenantId) as T[];
  const tableExists = (name: string) =>
    Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name));
  const placeholders = (ids: readonly string[]) => ids.map(() => '?').join(', ');
  const deleteTenantIds = (table: string, ids: readonly string[]) => {
    if (ids.length === 0) return;
    db.prepare(`delete from ${table} where tenant_id = ? and id in (${placeholders(ids)})`).run(
      tenantId,
      ...ids
    );
  };

  const payableTablesExist = Boolean(
    db
      .prepare(
        "select 1 from sqlite_master where type = 'table' and name = 'provider_payable_allocations'"
      )
      .get()
  );
  if (payableTablesExist) {
    const disposableInvoicePredicate = (invoiceAlias: string) => `
      ${invoiceAlias}.created_by in (select id from disposable_e2e_users)
      or ${invoiceAlias}.purchase_id in (
        select purchases.id
        from purchases
        where purchases.tenant_id = ${invoiceAlias}.tenant_id
          and purchases.created_by in (select id from disposable_e2e_users)
      )`;
    const disposableAllocationOriginPredicate = (allocationAlias: string) => `
      ${allocationAlias}.created_by in (select id from disposable_e2e_users)
      or ${allocationAlias}.invoice_id in (
        select invoice.id
        from provider_payable_invoices as invoice
        where invoice.tenant_id = ${allocationAlias}.tenant_id
          and (${disposableInvoicePredicate('invoice')})
      )`;
    const disposablePaymentPredicate = (paymentAlias: string) => `
      ${paymentAlias}.created_by in (select id from disposable_e2e_users)
      or exists (
        select 1
        from provider_payable_allocations as payment_allocation
        where payment_allocation.tenant_id = ${paymentAlias}.tenant_id
          and payment_allocation.payment_id = ${paymentAlias}.id
          and (${disposableAllocationOriginPredicate('payment_allocation')})
      )`;
    const disposableCreditPredicate = (creditAlias: string) => `
      ${creditAlias}.created_by in (select id from disposable_e2e_users)
      or exists (
        select 1
        from provider_payable_allocations as credit_allocation
        where credit_allocation.tenant_id = ${creditAlias}.tenant_id
          and credit_allocation.credit_id = ${creditAlias}.id
          and (${disposableAllocationOriginPredicate('credit_allocation')})
      )`;
    const disposableAllocationPredicate = (allocationAlias: string) => `
      ${disposableAllocationOriginPredicate(allocationAlias)}
      or ${allocationAlias}.payment_id in (
        select payment.id
        from provider_payable_payments as payment
        where payment.tenant_id = ${allocationAlias}.tenant_id
          and (${disposablePaymentPredicate('payment')})
      )
      or ${allocationAlias}.credit_id in (
        select credit.id
        from provider_payable_credits as credit
        where credit.tenant_id = ${allocationAlias}.tenant_id
          and (${disposableCreditPredicate('credit')})
      )`;

    // Payments and credits must stay fully allocated. Capture every affected
    // source before deleting any allocation; otherwise an operator-authored
    // source linked to a disposable invoice would survive as a partial ledger
    // entry after its child row disappears.
    const disposablePaymentIds = allForDisposableUsers<{ id: string }>(
      `select payment.id
       from provider_payable_payments as payment
       where payment.tenant_id = ? and (${disposablePaymentPredicate('payment')})`
    ).map(row => row.id);
    const disposableCreditIds = allForDisposableUsers<{ id: string }>(
      `select credit.id
       from provider_payable_credits as credit
       where credit.tenant_id = ? and (${disposableCreditPredicate('credit')})`
    ).map(row => row.id);

    // Durable sync rows have no FK, but retaining them would ask a later sync
    // worker to apply entities that this fixture cleanup is about to remove.
    const syncOutboxExists = Boolean(
      db.prepare("select 1 from sqlite_master where type = 'table' and name = 'sync_outbox'").get()
    );
    if (syncOutboxExists) {
      runForDisposableUsers(
        `delete from sync_outbox
         where tenant_id = ? and (
           (entity_type = 'provider_payable_allocations' and entity_id in (
             select id from provider_payable_allocations
             where provider_payable_allocations.tenant_id = sync_outbox.tenant_id
               and (${disposableAllocationPredicate('provider_payable_allocations')})
           ))
           or (entity_type = 'provider_payable_payments' and entity_id in (
             select payment.id from provider_payable_payments as payment
             where payment.tenant_id = sync_outbox.tenant_id
               and (${disposablePaymentPredicate('payment')})
           ))
           or (entity_type = 'provider_payable_credits' and entity_id in (
             select credit.id from provider_payable_credits as credit
             where credit.tenant_id = sync_outbox.tenant_id
               and (${disposableCreditPredicate('credit')})
           ))
           or (entity_type = 'provider_payable_invoices' and entity_id in (
             select id from provider_payable_invoices
             where provider_payable_invoices.tenant_id = sync_outbox.tenant_id
               and (${disposableInvoicePredicate('provider_payable_invoices')})
           ))
         )`
      );
    }

    runForDisposableUsers(
      `delete from provider_payable_allocations
       where tenant_id = ? and (${disposableAllocationPredicate('provider_payable_allocations')})`
    );
    const deletePayment = db.prepare(
      'delete from provider_payable_payments where tenant_id = ? and id = ?'
    );
    for (const paymentId of disposablePaymentIds) deletePayment.run(tenantId, paymentId);
    const deleteCredit = db.prepare(
      'delete from provider_payable_credits where tenant_id = ? and id = ?'
    );
    for (const creditId of disposableCreditIds) deleteCredit.run(tenantId, creditId);
    runForDisposableUsers(
      `delete from provider_payable_invoices
       where tenant_id = ? and (${disposableInvoicePredicate('provider_payable_invoices')})`
    );
  }

  const quotationSaleLinksExist = Boolean(
    db
      .prepare("select 1 from sqlite_master where type = 'table' and name = 'quotation_sale_links'")
      .get()
  );
  if (quotationSaleLinksExist) {
    runForDisposableUsers(
      `delete from quotation_sale_links
       where tenant_id = ? and (
         converted_by in (select id from disposable_e2e_users)
         or quotation_id in (
           select quotations.id from quotations
           where quotations.tenant_id = quotation_sale_links.tenant_id
             and quotations.created_by in (select id from disposable_e2e_users)
         )
         or sale_id in (
           select sales.id from sales
           where sales.tenant_id = quotation_sale_links.tenant_id
             and sales.created_by in (select id from disposable_e2e_users)
         )
      )`
    );
  }

  // Normalized return rows retain exact sale-line/payment provenance through
  // RESTRICT foreign keys. They must disappear before the generic sale_items
  // and sale_payments cleanup below. A return created by an operator on an E2E
  // sale is still disposable, as is a return created by an E2E actor on an
  // otherwise operator-owned sale.
  if (tableExists('sale_returns')) {
    const disposableReturnPredicate = (returnAlias: string) => `
      ${returnAlias}.created_by in (select id from disposable_e2e_users)
      or ${returnAlias}.sale_id in (
        select disposable_sale.id
        from sales as disposable_sale
        where disposable_sale.tenant_id = ${returnAlias}.tenant_id
          and disposable_sale.created_by in (select id from disposable_e2e_users)
      )`;
    const returnIds = allForDisposableUsers<{ id: string }>(
      `select sale_return.id
       from sale_returns as sale_return
       where sale_return.tenant_id = ?
         and (${disposableReturnPredicate('sale_return')})`
    ).map(row => row.id);
    if (tableExists('sale_exchanges')) {
      runForDisposableUsers(
        `delete from sale_exchanges
         where tenant_id = ? and (
           created_by in (select id from disposable_e2e_users)
           or sale_return_id in (
             select sale_return.id
             from sale_returns as sale_return
             where sale_return.tenant_id = sale_exchanges.tenant_id
               and (${disposableReturnPredicate('sale_return')})
           )
           or replacement_sale_id in (
             select disposable_sale.id
             from sales as disposable_sale
             where disposable_sale.tenant_id = sale_exchanges.tenant_id
               and disposable_sale.created_by in (select id from disposable_e2e_users)
           )
         )`
      );
    }

    // Store-credit accounts carry a materialized balance plus immutable
    // balanceAfter snapshots. Removing only one E2E movement would corrupt the
    // remaining account history, so a fixture-touched account is removed as an
    // indivisible ledger. This setup runs only against the isolated E2E tenant.
    if (tableExists('store_credit_movements') && tableExists('store_credit_accounts')) {
      const accountIds = allForDisposableUsers<{ id: string }>(
        `select distinct movement.account_id as id
         from store_credit_movements as movement
         where movement.tenant_id = ? and (
           movement.created_by in (select id from disposable_e2e_users)
           or movement.sale_id in (
             select disposable_sale.id
             from sales as disposable_sale
             where disposable_sale.tenant_id = movement.tenant_id
               and disposable_sale.created_by in (select id from disposable_e2e_users)
           )
           or movement.sale_return_id in (
             select sale_return.id
             from sale_returns as sale_return
             where sale_return.tenant_id = movement.tenant_id
               and (${disposableReturnPredicate('sale_return')})
           )
         )`
      ).map(row => row.id);

      if (accountIds.length > 0) {
        const movementIds = db
          .prepare(
            `select id from store_credit_movements
             where tenant_id = ? and account_id in (${placeholders(accountIds)})`
          )
          .all(tenantId, ...accountIds) as Array<{ id: string }>;
        if (tableExists('sync_outbox')) {
          const movementIdValues = movementIds.map(row => row.id);
          if (movementIdValues.length > 0) {
            db.prepare(
              `delete from sync_outbox
               where tenant_id = ? and entity_type = 'store_credit_movements'
                 and entity_id in (${placeholders(movementIdValues)})`
            ).run(tenantId, ...movementIdValues);
          }
          db.prepare(
            `delete from sync_outbox
             where tenant_id = ? and entity_type = 'store_credit_accounts'
               and entity_id in (${placeholders(accountIds)})`
          ).run(tenantId, ...accountIds);
        }
        db.prepare(
          `delete from store_credit_movements
           where tenant_id = ? and account_id in (${placeholders(accountIds)})`
        ).run(tenantId, ...accountIds);
        deleteTenantIds('store_credit_accounts', accountIds);
      }
    }

    // Loyalty has no balanceAfter snapshot, so preserve unrelated customer
    // history: delete only movements attached to the disposable sale/return or
    // actor, then derive the materialized point balance from the surviving
    // signed ledger.
    if (tableExists('loyalty_movements') && tableExists('loyalty_accounts')) {
      const loyaltyAccountIds = allForDisposableUsers<{ id: string }>(
        `select distinct movement.account_id as id
         from loyalty_movements as movement
         where movement.tenant_id = ? and (
           movement.created_by in (select id from disposable_e2e_users)
           or movement.sale_id in (
             select disposable_sale.id
             from sales as disposable_sale
             where disposable_sale.tenant_id = movement.tenant_id
               and disposable_sale.created_by in (select id from disposable_e2e_users)
           )
           or movement.sale_return_id in (
             select sale_return.id
             from sale_returns as sale_return
             where sale_return.tenant_id = movement.tenant_id
               and (${disposableReturnPredicate('sale_return')})
           )
         )`
      ).map(row => row.id);

      runForDisposableUsers(
        `delete from loyalty_movements
         where tenant_id = ? and (
           created_by in (select id from disposable_e2e_users)
           or sale_id in (
             select disposable_sale.id
             from sales as disposable_sale
             where disposable_sale.tenant_id = loyalty_movements.tenant_id
               and disposable_sale.created_by in (select id from disposable_e2e_users)
           )
           or sale_return_id in (
             select sale_return.id
             from sale_returns as sale_return
             where sale_return.tenant_id = loyalty_movements.tenant_id
               and (${disposableReturnPredicate('sale_return')})
           )
         )`
      );
      const updatePoints = db.prepare(
        `update loyalty_accounts
         set points = coalesce((
           select sum(movement.points)
           from loyalty_movements as movement
           where movement.account_id = loyalty_accounts.id
         ), 0),
         updated_at = ?
         where tenant_id = ? and id = ?`
      );
      const updatedAt = new Date().toISOString();
      for (const accountId of loyaltyAccountIds) {
        updatePoints.run(updatedAt, tenantId, accountId);
      }
    }

    if (tableExists('sync_outbox') && returnIds.length > 0) {
      db.prepare(
        `delete from sync_outbox
         where tenant_id = ? and entity_type = 'sale_returns'
           and entity_id in (${placeholders(returnIds)})`
      ).run(tenantId, ...returnIds);
    }

    // Child return snapshots and payment allocations cascade from the header;
    // deleting the header first releases their RESTRICT edges to the original
    // sale items, payments, lots, and serials.
    deleteTenantIds('sale_returns', returnIds);
  }
}

/**
 * signed day closes are immutable in production, including direct
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
  const hasSignoffs = Boolean(
    db.prepare('select 1 from day_close_signoffs where tenant_id = ? limit 1').get(tenantId)
  );
  const hasArtifacts =
    artifactTableExists &&
    Boolean(
      db.prepare('select 1 from day_close_artifacts where tenant_id = ? limit 1').get(tenantId)
    );

  // Most per-test baseline refreshes have no immutable day-close evidence.
  // Avoid global trigger DDL in that ordinary path: DROP TRIGGER needs a
  // schema write lock and can collide with an unrelated parallel journey
  // even though every row mutation below is tenant-scoped.
  if (!hasSignoffs && !hasArtifacts) {
    db.prepare(
      "delete from audit_logs where tenant_id = ? and resource_type = 'day_close_signoff'"
    ).run(tenantId);
    return;
  }

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

const E2E_SEQUENTIAL_TYPES = [
  { documentType: 'sale', code: 'VTA' },
  { documentType: 'purchase', code: 'COM' },
  { documentType: 'order', code: 'PED' },
  { documentType: 'quotation', code: 'COT' },
] as const;

/**
 * Make every active E2E site operationally complete without overwriting an
 * existing numbering choice. `ensureSecondarySite()` may create a branch
 * after the development seed has provisioned its original sites, so the
 * branch must receive its own prefixes before any sale, purchase, order, or
 * quotation journey can run. The site-derived suffix prevents document
 * number collisions across the tenant's site-scoped counters.
 */
export function ensureSiteSequentials(db: Database.Database, tenantId: string): void {
  const activeSites = db
    .prepare('select id from sites where tenant_id = ? and is_active = 1 order by created_at, id')
    .all(tenantId) as Array<{ id: string }>;
  const existing = db.prepare(
    'select 1 from sequentials where tenant_id = ? and site_id = ? and document_type = ? limit 1'
  );
  const insert = db.prepare(
    `insert into sequentials (
       id, tenant_id, site_id, document_type, prefix, current_value, created_at, updated_at
     ) values (?, ?, ?, ?, ?, 0, ?, ?)`
  );
  const now = new Date().toISOString();

  for (const [siteIndex, site] of activeSites.entries()) {
    const normalizedId = site.id.replace(/[^a-z0-9]/gi, '').toUpperCase();
    const siteSuffix = normalizedId.slice(-8) || String(siteIndex + 1).padStart(2, '0');
    for (const sequential of E2E_SEQUENTIAL_TYPES) {
      if (existing.get(tenantId, site.id, sequential.documentType)) continue;
      insert.run(
        nanoid(),
        tenantId,
        site.id,
        sequential.documentType,
        `E2E-${siteSuffix}-${sequential.code}-`,
        now,
        now
      );
    }
  }
}

/**
 * Delete test artefacts (products, providers, sales, purchases, cash
 * sessions, quotations, audit rows, disposable users) created by prior
 * E2E runs so the shared ledger stays bounded. Template users and the
 * secondary site are preserved so `ensureUsers()` /
 * `ensureSecondarySite()` remain idempotent.
 */
export function cleanupPriorRunArtifacts(db: Database.Database, tenantId: string): void {
  const keepUserClause = E2E_TEMPLATE_USER_PREFIXES.map(() => 'email not like ?').join(' and ');
  const keepUserArgs = E2E_TEMPLATE_USER_PREFIXES.map(prefix => `${prefix}%`);

  resetTenantSyncState(db, tenantId);
  resetDayCloseSignoffs(db, tenantId);

  // approval decisions reference both the requesting cashier and
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

  // attendance belongs to the shared template employees, so a
  // failed prior smoke could otherwise leave the next run already clocked
  // in. This is an isolated E2E tenant; clear both the rows and their soft
  // audit references before recreating the deterministic baseline.
  const employeeShiftCorrectionsTableExists = db
    .prepare(
      "select 1 from sqlite_master where type = 'table' and name = 'employee_shift_corrections'"
    )
    .get();
  if (employeeShiftCorrectionsTableExists) {
    // correction snapshots deliberately use NO ACTION foreign keys
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
  // cash sessions now retain nullable attendance evidence. The
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

  // published schedules reference template users/sites and keep
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

  // journal rows reference both users and devices. Clear the
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

  // The OCR preview smoke can close while upload persistence is still in
  // flight. Its completed upload owns a restrictive user FK even though no
  // purchase was created, so prune those transient payloads before deleting
  // the disposable actor on the next suite run.
  db.prepare(
    `delete from invoice_uploads
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
  const e2eTransferIds = `select id from transfer_orders
    where tenant_id = ? and (
      notes like 'E2E %'
      or created_by in (
        select id from users
        where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
      )
      or received_by in (
        select id from users
        where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
      )
    )`;
  const e2eTransferArgs = [tenantId, tenantId, ...keepUserArgs, tenantId, ...keepUserArgs];
  if (
    db
      .prepare(
        "select 1 from sqlite_master where type = 'table' and name = 'product_serial_transfers'"
      )
      .get()
  ) {
    db.prepare(
      `delete from product_serial_transfers
       where transfer_order_item_id in (
         select id from transfer_order_items
         where transfer_order_id in (
           ${e2eTransferIds}
         )
       )`
    ).run(...e2eTransferArgs);
  }
  db.prepare(
    `delete from transfer_order_items
     where transfer_order_id in (${e2eTransferIds})`
  ).run(...e2eTransferArgs);
  db.prepare(`delete from transfer_orders where id in (${e2eTransferIds})`).run(...e2eTransferArgs);

  cleanupRestrictiveBusinessLinks(db, tenantId);

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
  // procurement provenance uses a restrictive FK from each
  // received serial to its source purchase line. Remove exact identities
  // before pruning the disposable purchase_items parent rows.
  if (
    db
      .prepare("select 1 from sqlite_master where type = 'table' and name = 'product_serials'")
      .get()
  ) {
    db.prepare(
      `delete from product_serials
       where source_purchase_item_id in (
         select id from purchase_items where purchase_id in (
           select id from purchases where created_by in (
             select id from users
             where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
           )
         )
       )`
    ).run(tenantId, ...keepUserArgs);
  }
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

  // Product-import smokes create fixtures in both supported locales. Keep
  // one shared selector so every child cleanup covers the English E2E names
  // and the stable SKU prefix from the localized template without matching
  // arbitrary user-authored Spanish product names.
  const e2eProductIds = `select id from products
    where tenant_id = ?
      and (name like 'E2E %' or sku like 'E2E-LANZAMIENTO-%')`;

  // Transformation executions freeze restrictive product, lot, recipe, and
  // actor references. A focused journey can therefore leave enough durable
  // evidence to block the next full-suite product cleanup. This is the
  // isolated E2E tenant, so reset the aggregate in dependency order while
  // keeping the probes compatible with a database that has not reached 0056.
  const transformationsTableExists = db
    .prepare(
      "select 1 from sqlite_master where type = 'table' and name = 'inventory_transformations'"
    )
    .get();
  if (transformationsTableExists) {
    db.prepare(
      "delete from audit_logs where tenant_id = ? and resource_type = 'inventory_transformation'"
    ).run(tenantId);
    db.prepare('delete from inventory_transformations where tenant_id = ?').run(tenantId);
  }
  const transformationRecipesTableExists = db
    .prepare(
      "select 1 from sqlite_master where type = 'table' and name = 'inventory_transformation_recipes'"
    )
    .get();
  if (transformationRecipesTableExists) {
    db.prepare(
      "delete from audit_logs where tenant_id = ? and resource_type = 'inventory_transformation_recipe'"
    ).run(tenantId);
    db.prepare('delete from inventory_transformation_recipes where tenant_id = ?').run(tenantId);
  }

  // Blind-count sessions own restrictive product/user evidence through their
  // lines and actor columns. The baseline tenant is disposable, so clear the
  // whole count aggregate (children cascade) before pruning products or E2E
  // users. Keep the table probe for operators diagnosing a pre-0054 database.
  if (
    db
      .prepare(
        "select 1 from sqlite_master where type = 'table' and name = 'inventory_count_sessions'"
      )
      .get()
  ) {
    db.prepare(
      "delete from sync_outbox where tenant_id = ? and entity_type in ('inventory_count_sessions', 'inventory_count_lines')"
    ).run(tenantId);
    db.prepare(
      "delete from audit_logs where tenant_id = ? and resource_type = 'inventory_count_session'"
    ).run(tenantId);
    db.prepare('delete from inventory_count_sessions where tenant_id = ?').run(tenantId);
  }

  // Quotations lifecycle — clear before products so FK on
  // quotation_items.product_id does not block the product delete below.
  db.prepare(`delete from quotation_items where product_id in (${e2eProductIds})`).run(tenantId);
  db.prepare(
    `delete from quotations where tenant_id = ? and created_by in (
       select id from users where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
     )`
  ).run(tenantId, tenantId, ...keepUserArgs);

  // Inventory artefacts tied to the disposable products.
  db.prepare(`delete from inventory_movements where product_id in (${e2eProductIds})`).run(
    tenantId
  );
  db.prepare(`delete from inventory_balances where product_id in (${e2eProductIds})`).run(tenantId);
  db.prepare(`delete from initial_inventory where product_id in (${e2eProductIds})`).run(tenantId);
  db.prepare(`delete from unit_x_product where product_id in (${e2eProductIds})`).run(tenantId);
  db.prepare(`delete from product_x_provider where product_id in (${e2eProductIds})`).run(tenantId);

  // Order lines reference products; their parent orders may belong to
  // any actor, not only E2E users, so scope by product id.
  db.prepare(`delete from order_items where product_id in (${e2eProductIds})`).run(tenantId);
  // The full procurement journey now persists an order header before its
  // receipt. Its purchase children were removed by the actor-scoped cleanup
  // above; remove the disposable header as well so its provider FK cannot
  // poison the next suite's baseline.
  db.prepare(
    `delete from orders where tenant_id = ? and created_by in (
       select id from users
       where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}
     )`
  ).run(tenantId, tenantId, ...keepUserArgs);

  // Belt-and-braces: the actor-scoped deletes above only catch children
  // whose parent (sale, purchase, purchase_return, transfer_order) is
  // owned by an E2E user. If a prior run left orphaned line items that
  // reference an E2E product through a non-E2E parent, the upcoming
  // product delete would fail with a FOREIGN KEY constraint error. Scope
  // the same children by product id so the cleanup is idempotent against
  // any historical state.
  db.prepare(`delete from sale_items where product_id in (${e2eProductIds})`).run(tenantId);
  // sale_item_serials cascades with the sale lines above, then
  // the current serial registry must be removed before its product parent.
  if (
    db
      .prepare("select 1 from sqlite_master where type = 'table' and name = 'product_serials'")
      .get()
  ) {
    if (
      db
        .prepare(
          "select 1 from sqlite_master where type = 'table' and name = 'product_serial_transfers'"
        )
        .get()
    ) {
      db.prepare(
        `delete from product_serial_transfers
         where product_serial_id in (
           select id from product_serials where product_id in (${e2eProductIds})
         )`
      ).run(tenantId);
    }
    db.prepare(`delete from product_serials where product_id in (${e2eProductIds})`).run(tenantId);
  }
  db.prepare(`delete from purchase_items where product_id in (${e2eProductIds})`).run(tenantId);
  db.prepare(`delete from purchase_return_items where product_id in (${e2eProductIds})`).run(
    tenantId
  );
  db.prepare(`delete from transfer_order_items where product_id in (${e2eProductIds})`).run(
    tenantId
  );

  // Variant rows keep a restrictive self-reference to their matrix parent.
  // SQLite evaluates RESTRICT immediately, so deleting the parent and its
  // selected children in one statement still fails unless the edge is
  // detached first. Both sides are disposable E2E products here.
  db.prepare(
    `update products
        set variant_parent_id = null
      where variant_parent_id in (${e2eProductIds})`
  ).run(tenantId);

  // Launch-import and ledger journeys create durable E2E customers with
  // template actors. They are therefore not covered by the disposable-user
  // cleanup above and eventually push fresh fixtures past the first 50 rows
  // rendered by the customer list. Detach historical snapshot references,
  // remove the isolated ledger/audit/sync children, then prune the customer.
  const e2eCustomerIds = `select id from customers where tenant_id = ? and name like 'E2E %'`;
  cleanupPromotionArtifacts(db, tenantId);
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

  // Disposable products + providers. The Spanish import journey deliberately
  // uses localized fixture copy, so match both naming conventions. Leaving
  // those rows behind eventually pushes a freshly seeded purchase provider
  // past the first page returned to the checkout selector on repeated suites.
  db.prepare(`delete from products where id in (${e2eProductIds})`).run(tenantId);
  const e2eProviderIds = `select id
    from providers
    where tenant_id = ?
      and (name like 'E2E Provider %' or name like 'Proveedor E2E %')`;
  db.prepare(
    `delete from sync_outbox
     where tenant_id = ? and entity_type = 'providers' and entity_id in (${e2eProviderIds})`
  ).run(tenantId, tenantId);
  db.prepare(
    `delete from audit_logs
     where tenant_id = ? and resource_type = 'provider' and resource_id in (${e2eProviderIds})`
  ).run(tenantId, tenantId);
  db.prepare(`delete from providers where id in (${e2eProviderIds})`).run(tenantId);

  // Finally the disposable user accounts (template users are kept).
  db.prepare(
    `delete from users
     where tenant_id = ? and email like 'e2e.%@local.test' and ${keepUserClause}`
  ).run(tenantId, ...keepUserArgs);
}

/**
 * added a post-login redirect that sends admin users to
 * guided `/company` setup when `tenants.settings.setupAcknowledgedAt`
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
 * the module-gated surfaces (`/touch`, `/kds`, `/m`, `/delivery`) ship OFF by default on a
 * fresh retail tenant, so the Playwright a11y smoke could never reach
 * them (`SurfaceShellRoute` redirects to `/dashboard` when the module
 * is off). The baseline flips them on for the e2e tenant so the smoke
 * can axe-scan each surface. The ids match `CLIENT_MODULE_IDS` in
 * `apps/web/src/features/modules/manifest.ts`.
 */
export const E2E_ENABLED_MODULES: readonly string[] = [
  'pos-touch',
  'kds',
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
 * ensureSiteSequentials → ensureUsers. Transaction-wraps the cleanup so a partial failure does
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
  db.transaction(() => ensureSiteSequentials(db, tenantId))();
  await ensureUsers(db, tenantId);
}

/**
 * Reset the dedicated first-sale tenant to a true zero-product,
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

/**
 * Isolated Companion tenant: no sales or cash sessions, module enabled,
 * deterministic manager/viewer identities and no prior immutable close.
 * Keeping it separate prevents the live signed-close smoke from racing the
 * fully-parallel operational journeys on the shared baseline tenant.
 */
export async function prepareCompanionBaseline(db: Database.Database): Promise<void> {
  const now = new Date().toISOString();
  let tenant = db
    .prepare('select id from tenants where slug = ?')
    .get(COMPANION_E2E_TENANT_SLUG) as { id: string } | undefined;
  if (!tenant) {
    tenant = { id: nanoid() };
    db.prepare(
      `insert into tenants (id, name, slug, settings, default_currency_code, created_at, updated_at)
       values (?, 'E2E Companion Tenant', ?, '{}', 'COP', ?, ?)`
    ).run(tenant.id, COMPANION_E2E_TENANT_SLUG, now, now);
  }

  let company = db
    .prepare('select id from companies where tenant_id = ? order by created_at asc limit 1')
    .get(tenant.id) as { id: string } | undefined;
  if (!company) {
    company = { id: nanoid() };
    db.prepare(
      `insert into companies (id, tenant_id, name, created_at, updated_at)
       values (?, ?, 'E2E Companion Company', ?, ?)`
    ).run(company.id, tenant.id, now, now);
  }

  const site = db
    .prepare('select id from sites where tenant_id = ? order by created_at asc limit 1')
    .get(tenant.id) as { id: string } | undefined;
  if (!site) {
    db.prepare(
      `insert into sites (
         id, tenant_id, company_id, name, address, phone, is_active, created_at, updated_at
       ) values (?, ?, ?, 'E2E Companion Site', 'E2E Companion', '0000000303', 1, ?, ?)`
    ).run(nanoid(), tenant.id, company.id, now, now);
  }

  db.transaction(() => {
    resetTenantSyncState(db, tenant.id);
    resetDayCloseSignoffs(db, tenant.id);
    ensureSetupAcknowledged(db, tenant.id);
    ensureModulesEnabled(db, tenant.id, ['companion']);
    db.prepare(
      `insert into tenant_locale_settings (
         tenant_id, country_code, locale_override, timezone_override, updated_at
       ) values (?, 'CO', 'en-US', 'America/Bogota', ?)
       on conflict(tenant_id) do update set
         country_code = 'CO',
         locale_override = 'en-US',
         timezone_override = 'America/Bogota',
         updated_at = excluded.updated_at`
    ).run(tenant.id, now);
  })();

  const passwordHash = await argon2.hash(E2E_PASSWORD);
  const profiles = [
    {
      email: COMPANION_E2E_MANAGER_EMAIL,
      name: 'E2E Companion Manager',
      role: 'manager',
    },
    {
      email: COMPANION_E2E_VIEWER_EMAIL,
      name: 'E2E Companion Viewer',
      role: 'viewer',
    },
  ] as const;
  const existingUser = db.prepare(
    'select id, session_version as sessionVersion from users where email = ?'
  );
  for (const profile of profiles) {
    const existing = existingUser.get(profile.email) as
      { id: string; sessionVersion: number } | undefined;
    if (existing) {
      db.prepare(
        `update users set
           tenant_id = ?, name = ?, password_hash = ?, session_version = ?, role = ?,
           is_active = 1, updated_at = ?
         where id = ?`
      ).run(
        tenant.id,
        profile.name,
        passwordHash,
        (existing.sessionVersion ?? 1) + 1,
        profile.role,
        now,
        existing.id
      );
    } else {
      db.prepare(
        `insert into users (
           id, tenant_id, email, name, password_hash, session_version,
           role, is_active, created_at, updated_at
         ) values (?, ?, ?, ?, ?, 1, ?, 1, ?, ?)`
      ).run(nanoid(), tenant.id, profile.email, profile.name, passwordHash, profile.role, now, now);
    }
  }
}
