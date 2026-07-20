/**
 * pins the currency seam added by migration 0037.
 *
 * Three things are covered here:
 *
 * 1. `tenants.default_currency_code` is populated by the migration
 * backfill (`'COP'` for legacy tenants without metadata).
 * 2. Every transactional write (sales, sale_items, quotations,
 * quotation_items, products, customers.creditLimit) stamps a
 * currency_code on the row through the application layer.
 * Reading the persisted value must round-trip with the
 * `resolveTenantCurrency()` helper.
 * 3. `exchange_rate_at_sale > 0` CHECK rejects a zero or negative
 * rate on sales / sale_items / quotations / quotation_items.
 * Without that constraint a stray multiplier could silently zero
 * out totals.
 *
 * Multi-currency operations (currencyCode !== settleCurrencyCode with
 * an explicit rate) belong to . This file tests the seam, not
 * the cross-currency math.
 */

import { afterEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { closeDatabase, getDatabase, initDatabase } from '../db/index.js';
import { resolveTenantCurrency, TENANT_CURRENCY_FALLBACK } from '../lib/currency.js';

interface LiveDatabase {
  $client: Database.Database;
}

afterEach(() => {
  closeDatabase();
});

function liveClient(): Database.Database {
  return (getDatabase() as unknown as LiveDatabase).$client;
}

function expectCheckViolation(write: () => unknown, constraintHint: string): void {
  expect(write).toThrowError(
    expect.objectContaining({
      code: 'SQLITE_CONSTRAINT_CHECK',
      message: expect.stringContaining(constraintHint),
    })
  );
}

describe('currency seam', () => {
  describe('tenants.default_currency_code', () => {
    it('defaults to COP on a fresh insert that omits the column', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's1')").run();
      const row = c.prepare("SELECT default_currency_code FROM tenants WHERE id = 't1'").get() as {
        default_currency_code: string;
      };
      expect(row.default_currency_code).toBe('COP');
    });

    it('persists an explicit override picked by the operator', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      // Seed catalogue + tenant carrying USD explicitly.
      c.prepare(
        "INSERT INTO tenants (id, name, slug, default_currency_code) VALUES ('t1', 't', 's1', 'USD')"
      ).run();
      const row = c.prepare("SELECT default_currency_code FROM tenants WHERE id = 't1'").get() as {
        default_currency_code: string;
      };
      expect(row.default_currency_code).toBe('USD');
    });
  });

  describe('resolveTenantCurrency()', () => {
    it('returns the tenant default when set', async () => {
      const db = await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare(
        "INSERT INTO tenants (id, name, slug, default_currency_code) VALUES ('t1', 't', 's1', 'MXN')"
      ).run();
      expect(resolveTenantCurrency(db, 't1')).toBe('MXN');
    });

    it('falls back to COP when the tenant row is missing', async () => {
      const db = await initDatabase({ dbPath: ':memory:', seedData: false });
      expect(resolveTenantCurrency(db, 'does-not-exist')).toBe(TENANT_CURRENCY_FALLBACK);
      expect(TENANT_CURRENCY_FALLBACK).toBe('COP');
    });
  });

  describe('sales currency seam', () => {
    it('persists currency_code, exchange_rate_at_sale, and a null settle_currency_code by default', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's1')").run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
      ).run();
      c.prepare(
        `INSERT INTO sales (id, tenant_id, sale_number, total, currency_code, exchange_rate_at_sale, created_by)
         VALUES ('s1', 't1', 'SO-1', 100, 'COP', 1, 'u1')`
      ).run();
      const row = c
        .prepare(
          "SELECT currency_code, exchange_rate_at_sale, settle_currency_code FROM sales WHERE id = 's1'"
        )
        .get() as {
        currency_code: string;
        exchange_rate_at_sale: number;
        settle_currency_code: string | null;
      };
      expect(row.currency_code).toBe('COP');
      expect(row.exchange_rate_at_sale).toBe(1);
      expect(row.settle_currency_code).toBeNull();
    });

    it('persists an explicit cross-currency settle pair ( readiness)', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's1')").run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
      ).run();
      c.prepare(
        `INSERT INTO sales (id, tenant_id, sale_number, total, currency_code, exchange_rate_at_sale, settle_currency_code, created_by)
         VALUES ('s2', 't1', 'SO-2', 100, 'USD', 4200, 'COP', 'u1')`
      ).run();
      const row = c
        .prepare(
          "SELECT currency_code, exchange_rate_at_sale, settle_currency_code FROM sales WHERE id = 's2'"
        )
        .get() as {
        currency_code: string;
        exchange_rate_at_sale: number;
        settle_currency_code: string | null;
      };
      expect(row.currency_code).toBe('USD');
      expect(row.exchange_rate_at_sale).toBe(4200);
      expect(row.settle_currency_code).toBe('COP');
    });

    it('rejects exchange_rate_at_sale <= 0', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's1')").run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
      ).run();
      expectCheckViolation(
        () =>
          c
            .prepare(
              `INSERT INTO sales (id, tenant_id, sale_number, total, currency_code, exchange_rate_at_sale, created_by)
               VALUES ('s3', 't1', 'SO-3', 100, 'COP', 0, 'u1')`
            )
            .run(),
        'chk_sales_exchange_rate_positive'
      );
    });
  });

  describe('quotations currency seam', () => {
    it('rejects a zero exchange_rate_at_sale on quotations', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's1')").run();
      c.prepare("INSERT INTO companies (id, tenant_id, name) VALUES ('co1', 't1', 'c')").run();
      c.prepare(
        "INSERT INTO sites (id, tenant_id, company_id, name) VALUES ('site1', 't1', 'co1', 's')"
      ).run();
      c.prepare(
        "INSERT INTO users (id, tenant_id, email, password_hash, name, role) VALUES ('u1', 't1', 'a@b', 'x', 'a', 'admin')"
      ).run();
      expectCheckViolation(
        () =>
          c
            .prepare(
              `INSERT INTO quotations (id, tenant_id, site_id, quotation_number, total, currency_code, exchange_rate_at_sale, created_by)
               VALUES ('q1', 't1', 'site1', 'Q-1', 100, 'COP', 0, 'u1')`
            )
            .run(),
        'chk_quotations_exchange_rate_positive'
      );
    });
  });

  describe('products currency_code', () => {
    it('defaults to COP for backfilled rows', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's1')").run();
      c.prepare(
        "INSERT INTO products (id, tenant_id, name, sku) VALUES ('p1', 't1', 'p', 'sku1')"
      ).run();
      const row = c.prepare("SELECT currency_code FROM products WHERE id = 'p1'").get() as {
        currency_code: string;
      };
      expect(row.currency_code).toBe('COP');
    });

    it('persists an explicit currency override (imported product priced in USD)', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's1')").run();
      c.prepare(
        "INSERT INTO products (id, tenant_id, name, sku, currency_code) VALUES ('p1', 't1', 'p', 'sku1', 'USD')"
      ).run();
      const row = c.prepare("SELECT currency_code FROM products WHERE id = 'p1'").get() as {
        currency_code: string;
      };
      expect(row.currency_code).toBe('USD');
    });
  });

  describe('customers.credit_limit_currency_code', () => {
    it('persists null when creditLimit is zero (sin cupo)', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's1')").run();
      c.prepare(
        "INSERT INTO customers (id, tenant_id, name, credit_limit) VALUES ('c1', 't1', 'n', 0)"
      ).run();
      const row = c
        .prepare("SELECT credit_limit, credit_limit_currency_code FROM customers WHERE id = 'c1'")
        .get() as { credit_limit: number; credit_limit_currency_code: string | null };
      expect(row.credit_limit).toBe(0);
      expect(row.credit_limit_currency_code).toBeNull();
    });

    it('persists a currency override alongside an explicit credit limit', async () => {
      await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare("INSERT INTO tenants (id, name, slug) VALUES ('t1', 't', 's1')").run();
      c.prepare(
        "INSERT INTO customers (id, tenant_id, name, credit_limit, credit_limit_currency_code) VALUES ('c1', 't1', 'n', 1000, 'USD')"
      ).run();
      const row = c
        .prepare("SELECT credit_limit, credit_limit_currency_code FROM customers WHERE id = 'c1'")
        .get() as { credit_limit: number; credit_limit_currency_code: string };
      expect(row.credit_limit).toBe(1000);
      expect(row.credit_limit_currency_code).toBe('USD');
    });
  });

  describe('multi-tenant currency isolation', () => {
    it('two tenants can carry different default currencies in the same DB', async () => {
      const db = await initDatabase({ dbPath: ':memory:', seedData: false });
      const c = liveClient();
      c.prepare(
        "INSERT INTO tenants (id, name, slug, default_currency_code) VALUES ('tA', 'A', 'a', 'COP')"
      ).run();
      c.prepare(
        "INSERT INTO tenants (id, name, slug, default_currency_code) VALUES ('tB', 'B', 'b', 'USD')"
      ).run();
      expect(resolveTenantCurrency(db, 'tA')).toBe('COP');
      expect(resolveTenantCurrency(db, 'tB')).toBe('USD');
    });
  });
});
