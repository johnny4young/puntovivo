/**
 * pins the CHECK invariants added by migrations 0035 and
 * 0036 across 17 monetary tables.
 *
 * Step-a ships the `>= 0` invariant on "always positive" columns
 * (totals, subtotals, taxes, costs, prices, tips, service charges,
 * opening floats, credit limits, refund amounts). Step-b adds the
 * two-decimal precision invariant after the application roundMoney
 * sweep. Signed columns (discounts, cash-movement amounts,
 * sale-payment reverses, cash-session over/short variance) carry the
 * precision CHECK but not the non-negative CHECK.
 *
 * The tests assert SQLite rejects every violation with
 * `SQLITE_CONSTRAINT_CHECK` so a future refactor that accidentally
 * drops a constraint surfaces at the test suite, not in production.
 *
 * (migration 0037) reinstates both invariants on the three
 * tables the snapshot chain had skipped (fiscal_documents,
 * fiscal_document_items, payment_outbox) while adding the
 * currency_code seam to transactional tables. New cases below cover
 * those three tables; the schema-level sentinel keeps the signed-only
 * list intact since none of the newly covered columns are signed.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type Database from 'better-sqlite3';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';

interface LiveDatabase {
  $client: Database.Database;
}

afterEach(() => {
  closeDatabase();
});

function liveClient(): Database.Database {
  return (getDatabase() as unknown as LiveDatabase).$client;
}

/**
 * Asserts that the given write throws a SQLite CHECK violation.
 * Wraps the raw error inspection so individual cases stay terse.
 */
function expectCheckViolation(write: () => unknown, constraintHint: string): void {
  expect(write).toThrowError(
    expect.objectContaining({
      code: 'SQLITE_CONSTRAINT_CHECK',
      message: expect.stringContaining(constraintHint),
    })
  );
}

describe('money CHECK invariants', () => {
  describe('"always positive" category — rejects negative writes', () => {
    it('products.price rejects a negative write', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      expectCheckViolation(
        () =>
          c
            .prepare(
              "INSERT INTO products (id, tenant_id, name, sku, price) VALUES ('p1', 't1', 'n', 's', -1)"
            )
            .run(),
        'chk_products_price_nonneg'
      );
    });

    it('sales.total rejects a negative write', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      // Seed the FKs first.
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
      ).run();
      expectCheckViolation(
        () =>
          c
            .prepare(
              "INSERT INTO sales (id, tenant_id, sale_number, total, created_by) VALUES ('s1', 't1', 'SO-1', -50, 'u1')"
            )
            .run(),
        'chk_sales_total_nonneg'
      );
    });

    it('customers.credit_limit rejects negative', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      expectCheckViolation(
        () =>
          c
            .prepare(
              "INSERT INTO customers (id, tenant_id, name, credit_limit) VALUES ('c1', 't1', 'n', -100)"
            )
            .run(),
        'chk_customers_credit_limit_nonneg'
      );
    });
  });

  describe('"signed" category — precision CHECK enforced, sign permitted', () => {
    it('sales.discount_amount rejects > 2-decimal precision (signed column gets _2dec CHECK)', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
      ).run();
      expectCheckViolation(
        () =>
          c
            .prepare(
              "INSERT INTO sales (id, tenant_id, sale_number, total, discount_amount, created_by) VALUES ('sb1', 't1', 'SO-1', 100, -25.005, 'u1')"
            )
            .run(),
        'chk_sales_discount_2dec'
      );
    });

    it('products.price rejects > 2-decimal precision', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      expectCheckViolation(
        () =>
          c
            .prepare(
              "INSERT INTO products (id, tenant_id, name, sku, price) VALUES ('p-dec', 't1', 'n', 's', 100.005)"
            )
            .run(),
        'chk_products_price_2dec'
      );
    });

    it('sales.discount_amount accepts a negative value (signed column, precision still enforced)', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
      ).run();
      c.prepare(
        "INSERT INTO sales (id, tenant_id, sale_number, total, discount_amount, created_by) VALUES ('s1', 't1', 'SO-1', 100, -25, 'u1')"
      ).run();
      const row = c.prepare("SELECT discount_amount FROM sales WHERE id = 's1'").get() as {
        discount_amount: number;
      };
      expect(row.discount_amount).toBe(-25);
    });

    it('cash_movements.amount accepts a negative paid_out flow', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      c.prepare("INSERT INTO companies (id, tenant_id, name) VALUES ('co1', 't1', 'c')").run();
      c.prepare(
        "INSERT INTO sites (id, tenant_id, company_id, name) VALUES ('site1', 't1', 'co1', 's')"
      ).run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'cashier')"
      ).run();
      c.prepare(
        "INSERT INTO cash_sessions (id, tenant_id, site_id, cashier_id, register_name, opening_float, opening_count_denominations, expected_balance, status, opened_at) VALUES ('cs1', 't1', 'site1', 'u1', 'r1', 100, '[]', 100, 'open', '2026-05-25T00:00:00Z')"
      ).run();
      c.prepare(
        "INSERT INTO cash_movements (id, tenant_id, session_id, type, amount, created_by, created_at) VALUES ('cm1', 't1', 'cs1', 'paid_out', -50, 'u1', '2026-05-25T00:00:00Z')"
      ).run();
      const row = c.prepare("SELECT amount FROM cash_movements WHERE id = 'cm1'").get() as {
        amount: number;
      };
      expect(row.amount).toBe(-50);
    });

    it('cash_sessions.over_short accepts a negative variance', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      c.prepare("INSERT INTO companies (id, tenant_id, name) VALUES ('co1', 't1', 'c')").run();
      c.prepare(
        "INSERT INTO sites (id, tenant_id, company_id, name) VALUES ('site1', 't1', 'co1', 's')"
      ).run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'cashier')"
      ).run();
      c.prepare(
        "INSERT INTO cash_sessions (id, tenant_id, site_id, cashier_id, register_name, opening_float, opening_count_denominations, expected_balance, over_short, status, opened_at) VALUES ('cs1', 't1', 'site1', 'u1', 'r1', 100, '[]', 90, -10, 'closed', '2026-05-25T00:00:00Z')"
      ).run();
      const row = c.prepare("SELECT over_short FROM cash_sessions WHERE id = 'cs1'").get() as {
        over_short: number;
      };
      expect(row.over_short).toBe(-10);
    });
  });

  describe('happy path — legitimate writes pass every CHECK', () => {
    it('full sale row with positive amounts + signed discount + tip + service charge passes', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'cashier')"
      ).run();
      c.prepare(
        `INSERT INTO sales (id, tenant_id, sale_number, subtotal, tax_amount, discount_amount, total, tip_amount, service_charge_amount, created_by)
         VALUES ('s1', 't1', 'SO-1', 100.00, 19.00, 5.50, 113.50, 5.00, 10.00, 'u1')`
      ).run();
      const row = c
        .prepare(
          "SELECT subtotal, tax_amount, discount_amount, total, tip_amount, service_charge_amount FROM sales WHERE id = 's1'"
        )
        .get() as Record<string, number>;
      expect(row.subtotal).toBe(100);
      expect(row.total).toBe(113.5);
      expect(row.discount_amount).toBe(5.5);
    });

    it('integer-typed money round-trips cleanly (SQLite real affinity)', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      c.prepare(
        "INSERT INTO customers (id, tenant_id, name, credit_limit) VALUES ('c1', 't1', 'n', 500000)"
      ).run();
      const row = c.prepare("SELECT credit_limit FROM customers WHERE id = 'c1'").get() as {
        credit_limit: number;
      };
      // SQLite stores integers fed into REAL columns as 500000.0 — both
      // round(x, 2) and x equal 500000.0 so the precision CHECK passes.
      expect(row.credit_limit).toBe(500000);
    });
  });

  describe('fiscal tables —  retro-fitted CHECKs', () => {
    // The migration-0037 recreation finally attaches both invariants to
    // the three tables the Drizzle snapshot chain had skipped. These
    // cases pin SQLite rejects negative + sub-cent writes on each
    // column category so a future feature cannot silently drop them.

    it('fiscal_documents.subtotal rejects a negative write', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      // Minimal FK skeleton — fiscal_documents needs tenants + user +
      // resolution + identification type. Skip resolution by passing
      // an arbitrary id with FK enforcement deferred.
      c.pragma('foreign_keys = OFF');
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
      ).run();
      expectCheckViolation(
        () =>
          c
            .prepare(
              `INSERT INTO fiscal_documents (id, tenant_id, source, source_id, kind, resolution_id, consecutive, document_number, cufe, buyer_tax_id, buyer_tax_id_type_code, buyer_name, subtotal, tax_amount, discount_amount, total_amount, currency_code, locale_code, provider_id, emitted_by_user_id)
               VALUES ('fd1', 't1', 'sale', 's1', 'invoice', 'r1', 1, 'F-001', 'cufe', '900', '13', 'Buyer', -10, 0, 0, 0, 'COP', 'es-CO', 'mock', 'u1')`
            )
            .run(),
        'chk_fiscal_documents_subtotal_nonneg'
      );
    });

    it('fiscal_documents.subtotal rejects > 2-decimal precision', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.pragma('foreign_keys = OFF');
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
      ).run();
      expectCheckViolation(
        () =>
          c
            .prepare(
              `INSERT INTO fiscal_documents (id, tenant_id, source, source_id, kind, resolution_id, consecutive, document_number, cufe, buyer_tax_id, buyer_tax_id_type_code, buyer_name, subtotal, tax_amount, discount_amount, total_amount, currency_code, locale_code, provider_id, emitted_by_user_id)
               VALUES ('fd2', 't1', 'sale', 's2', 'invoice', 'r1', 1, 'F-002', 'cufe2', '900', '13', 'Buyer', 100.005, 0, 0, 0, 'COP', 'es-CO', 'mock', 'u1')`
            )
            .run(),
        'chk_fiscal_documents_subtotal_2dec'
      );
    });

    it('fiscal_document_items.unit_price rejects a negative write', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.pragma('foreign_keys = OFF');
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
      ).run();
      c.prepare(
        `INSERT INTO fiscal_documents (id, tenant_id, source, source_id, kind, resolution_id, consecutive, document_number, cufe, buyer_tax_id, buyer_tax_id_type_code, buyer_name, currency_code, locale_code, provider_id, emitted_by_user_id)
         VALUES ('fd3', 't1', 'sale', 's3', 'invoice', 'r1', 1, 'F-003', 'cufe3', '900', '13', 'Buyer', 'COP', 'es-CO', 'mock', 'u1')`
      ).run();
      expectCheckViolation(
        () =>
          c
            .prepare(
              "INSERT INTO fiscal_document_items (id, fiscal_document_id, line_number, product_name, quantity, unit_price, line_total) VALUES ('fdi1', 'fd3', 1, 'p', 1, -10, 0)"
            )
            .run(),
        'chk_fiscal_document_items_unit_price_nonneg'
      );
    });

    it('payment_outbox.amount rejects a negative write', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      const now = '2026-05-26T00:00:00Z';
      expectCheckViolation(
        () =>
          c
            .prepare(
              `INSERT INTO payment_outbox (id, tenant_id, rail_id, kind, status, amount, reference, payload, created_at, updated_at)
               VALUES ('po1', 't1', 'card', 'charge', 'queued', -50, 'ref', '{}', '${now}', '${now}')`
            )
            .run(),
        'chk_payment_outbox_amount_nonneg'
      );
    });

    it('payment_outbox.amount rejects > 2-decimal precision', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's')").run();
      const now = '2026-05-26T00:00:00Z';
      expectCheckViolation(
        () =>
          c
            .prepare(
              `INSERT INTO payment_outbox (id, tenant_id, rail_id, kind, status, amount, reference, payload, created_at, updated_at)
               VALUES ('po2', 't1', 'card', 'charge', 'queued', 12.345, 'ref', '{}', '${now}', '${now}')`
            )
            .run(),
        'chk_payment_outbox_amount_2dec'
      );
    });
  });

  describe('schema-level CHECK declarations', () => {
    // Parameterized constraint-presence audit. Each row in the table
    // below is one expected `chk_<prefix>_nonneg` constraint that
    // migration 0035 must wire onto its table. A future drizzle-kit
    // regeneration that silently drops a constraint surfaces here
    // INSTEAD of requiring every column to have its own behavioural
    // test fixture (which would balloon the file ~5x).
    const expectedConstraints: ReadonlyArray<{
      table: string;
      constraint: string;
    }> = [
      // products
      { table: 'products', constraint: 'chk_products_price_nonneg' },
      { table: 'products', constraint: 'chk_products_price2_nonneg' },
      { table: 'products', constraint: 'chk_products_price3_nonneg' },
      { table: 'products', constraint: 'chk_products_cost_nonneg' },
      { table: 'products', constraint: 'chk_products_margin1_nonneg' },
      { table: 'products', constraint: 'chk_products_margin2_nonneg' },
      { table: 'products', constraint: 'chk_products_margin3_nonneg' },
      { table: 'products', constraint: 'chk_products_init_cost_nonneg' },
      // customers
      { table: 'customers', constraint: 'chk_customers_credit_limit_nonneg' },
      // sales (subtotal/tax/total/tip/service; NOT discount)
      { table: 'sales', constraint: 'chk_sales_subtotal_nonneg' },
      { table: 'sales', constraint: 'chk_sales_tax_nonneg' },
      { table: 'sales', constraint: 'chk_sales_total_nonneg' },
      { table: 'sales', constraint: 'chk_sales_tip_nonneg' },
      { table: 'sales', constraint: 'chk_sales_service_nonneg' },
      // sale_items (unit_price/tax/cost/total; NOT discount)
      { table: 'sale_items', constraint: 'chk_sale_items_unit_price_nonneg' },
      { table: 'sale_items', constraint: 'chk_sale_items_tax_nonneg' },
      { table: 'sale_items', constraint: 'chk_sale_items_cost_nonneg' },
      { table: 'sale_items', constraint: 'chk_sale_items_total_nonneg' },
      // quotations + quotation_items
      { table: 'quotations', constraint: 'chk_quotations_subtotal_nonneg' },
      { table: 'quotations', constraint: 'chk_quotations_tax_nonneg' },
      { table: 'quotations', constraint: 'chk_quotations_total_nonneg' },
      {
        table: 'quotation_items',
        constraint: 'chk_quotation_items_unit_price_nonneg',
      },
      {
        table: 'quotation_items',
        constraint: 'chk_quotation_items_tax_nonneg',
      },
      {
        table: 'quotation_items',
        constraint: 'chk_quotation_items_total_nonneg',
      },
      // cash_sessions + denomination_templates
      {
        table: 'cash_sessions',
        constraint: 'chk_cash_sessions_opening_nonneg',
      },
      {
        table: 'cash_sessions',
        constraint: 'chk_cash_sessions_expected_nonneg',
      },
      {
        table: 'denomination_templates',
        constraint: 'chk_denomination_templates_opening_nonneg',
      },
      // sale_returns
      {
        table: 'sale_returns',
        constraint: 'chk_sale_returns_refund_nonneg',
      },
      // purchases + items + returns
      { table: 'purchases', constraint: 'chk_purchases_subtotal_nonneg' },
      { table: 'purchases', constraint: 'chk_purchases_total_nonneg' },
      {
        table: 'purchase_items',
        constraint: 'chk_purchase_items_cost_per_unit_nonneg',
      },
      {
        table: 'purchase_items',
        constraint: 'chk_purchase_items_base_cost_nonneg',
      },
      {
        table: 'purchase_items',
        constraint: 'chk_purchase_items_total_nonneg',
      },
      {
        table: 'purchase_returns',
        constraint: 'chk_purchase_returns_amount_nonneg',
      },
      // orders + items
      { table: 'orders', constraint: 'chk_orders_subtotal_nonneg' },
      { table: 'orders', constraint: 'chk_orders_total_nonneg' },
      {
        table: 'order_items',
        constraint: 'chk_order_items_cost_per_unit_nonneg',
      },
      {
        table: 'order_items',
        constraint: 'chk_order_items_base_cost_nonneg',
      },
      { table: 'order_items', constraint: 'chk_order_items_total_nonneg' },
      // initial_inventory
      {
        table: 'initial_inventory',
        constraint: 'chk_initial_inventory_cost_nonneg',
      },
      // fiscal tables + payment_outbox CHECKs landed in 0037.
      {
        table: 'fiscal_documents',
        constraint: 'chk_fiscal_documents_subtotal_nonneg',
      },
      {
        table: 'fiscal_documents',
        constraint: 'chk_fiscal_documents_tax_nonneg',
      },
      {
        table: 'fiscal_documents',
        constraint: 'chk_fiscal_documents_discount_nonneg',
      },
      {
        table: 'fiscal_documents',
        constraint: 'chk_fiscal_documents_total_nonneg',
      },
      {
        table: 'fiscal_document_items',
        constraint: 'chk_fiscal_document_items_unit_price_nonneg',
      },
      {
        table: 'fiscal_document_items',
        constraint: 'chk_fiscal_document_items_discount_nonneg',
      },
      {
        table: 'fiscal_document_items',
        constraint: 'chk_fiscal_document_items_tax_nonneg',
      },
      {
        table: 'fiscal_document_items',
        constraint: 'chk_fiscal_document_items_total_nonneg',
      },
      {
        table: 'payment_outbox',
        constraint: 'chk_payment_outbox_amount_nonneg',
      },
    ];

    it('every always-positive monetary column carries its chk_*_nonneg constraint after migration 0035', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      const grouped = new Map<string, string>();
      for (const { table, constraint } of expectedConstraints) {
        if (!grouped.has(table)) {
          const row = c
            .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`)
            .get(table) as { sql: string } | undefined;
          if (!row) {
            throw new Error(`expected table ${table} to exist post-migration`);
          }
          grouped.set(table, row.sql);
        }
        const sql = grouped.get(table)!;
        expect(sql, `${constraint} missing from ${table} table DDL`).toContain(constraint);
      }
    });

    it('signed columns carry the precision CHECK but NOT the non-negative CHECK', async () => {
      // Sentinel set — these columns are signed (Step-b reinstated
      // the precision invariant via migration 0036 but never adds a
      // non-negative invariant for them).
      const signedColumns: ReadonlyArray<{ table: string; column: string }> = [
        { table: 'sales', column: 'sales_discount' },
        { table: 'sale_items', column: 'sale_items_discount' },
        { table: 'quotations', column: 'quotations_discount' },
        { table: 'quotation_items', column: 'quotation_items_discount' },
        { table: 'cash_movements', column: 'cash_movements_amount' },
        { table: 'sale_payments', column: 'sale_payments_amount' },
        { table: 'cash_sessions', column: 'cash_sessions_over_short' },
      ];
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      for (const { table, column } of signedColumns) {
        const row = c
          .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name = ?`)
          .get(table) as { sql: string } | undefined;
        if (!row) {
          throw new Error(`expected table ${table} to exist post-migration`);
        }
        expect(row.sql, `chk_${column}_2dec must exist — precision invariant`).toContain(
          `chk_${column}_2dec`
        );
        expect(
          row.sql,
          `chk_${column}_nonneg must NOT exist — column is intentionally signed`
        ).not.toContain(`chk_${column}_nonneg`);
      }
    });
  });
});

// `sql` is imported to keep the drizzle-orm dependency live in the
// import graph even if no helper uses it directly here; tooling at the
// test boundary expects every migration touch test to import drizzle.
void sql;
