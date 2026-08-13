import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface PackagedRecoveryProfile {
  id: string;
  products: number;
  customers: number;
  cashSessions: number;
  sales: number;
  itemsPerSale: number;
}

export interface PackagedRecoveryDatasetCounts {
  products: number;
  customers: number;
  cashSessions: number;
  sales: number;
  saleItems: number;
  salePayments: number;
}

/**
 * A bounded annual workload for one active retail location. Fifty thousand
 * receipts is roughly 137 sales per day; three lines per receipt and a broad
 * customer/catalog history keep the backup representative without turning the
 * manual release matrix into a benchmark suite.
 */
export const PACKAGED_RECOVERY_PROFILE: PackagedRecoveryProfile = {
  id: 'retail-annual-medium-v1',
  products: 2_500,
  customers: 10_000,
  cashSessions: 365,
  sales: 50_000,
  itemsPerSale: 3,
};

const PROFILE_START_MS = Date.parse('2025-01-01T00:00:00.000Z');
const DAY_MS = 86_400_000;

function requiredRow<T extends Record<string, unknown>>(
  sqlite: Database.Database,
  query: string,
  label: string,
  values: unknown[] = []
): T {
  const row = sqlite.prepare(query).get(...values) as T | undefined;
  if (!row) throw new Error(`packaged recovery seed is missing ${label}`);
  return row;
}

export function expectedDatasetCounts(
  profile: PackagedRecoveryProfile
): PackagedRecoveryDatasetCounts {
  return {
    products: profile.products,
    customers: profile.customers,
    cashSessions: profile.cashSessions,
    sales: profile.sales,
    saleItems: profile.sales * profile.itemsPerSale,
    salePayments: profile.sales,
  };
}

export function inspectPackagedRecoveryDataset(
  sqlite: Database.Database
): PackagedRecoveryDatasetCounts {
  const count = (table: string): number => {
    const row = sqlite.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    };
    return row.count;
  };
  return {
    products: count('products'),
    customers: count('customers'),
    cashSessions: count('cash_sessions'),
    sales: count('sales'),
    saleItems: count('sale_items'),
    salePayments: count('sale_payments'),
  };
}

export function assertDatasetCounts(
  actual: PackagedRecoveryDatasetCounts,
  expected: PackagedRecoveryDatasetCounts
): void {
  for (const key of Object.keys(expected) as Array<keyof PackagedRecoveryDatasetCounts>) {
    if (actual[key] !== expected[key]) {
      throw new Error(`packaged recovery ${key} count mismatch (${actual[key]}/${expected[key]})`);
    }
  }
}

export function seedPackagedRecoveryDataset(
  sqlite: Database.Database,
  profile: PackagedRecoveryProfile
): PackagedRecoveryDatasetCounts {
  const tenant = requiredRow<{ id: string }>(
    sqlite,
    'SELECT id FROM tenants ORDER BY id LIMIT 1',
    'tenant'
  );
  const site = requiredRow<{ id: string }>(
    sqlite,
    'SELECT id FROM sites WHERE tenant_id = ? ORDER BY id LIMIT 1',
    'site',
    [tenant.id]
  );
  const user = requiredRow<{ id: string }>(
    sqlite,
    'SELECT id FROM users WHERE tenant_id = ? ORDER BY id LIMIT 1',
    'user',
    [tenant.id]
  );

  const insertProduct = sqlite.prepare(`
    INSERT INTO products
      (id, tenant_id, name, sku, price, cost, tax_rate, currency_code, is_active,
       sync_status, sync_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 'COP', 1, 'synced', 1, ?, ?)
  `);
  const insertCustomer = sqlite.prepare(`
    INSERT INTO customers
      (id, tenant_id, name, tax_id, country, is_active, privacy_status,
       sync_status, sync_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'CO', 1, 'active', 'synced', 1, ?, ?)
  `);
  const insertCashSession = sqlite.prepare(`
    INSERT INTO cash_sessions
      (id, tenant_id, site_id, cashier_id, register_name, opening_float,
       opening_count_denominations, expected_balance, actual_count,
       actual_count_denominations, over_short, status, opened_at, closed_at,
       created_at, updated_at)
    VALUES (?, ?, ?, ?, 'Recovery register', 200000, '[]', ?, ?, '[]', 0,
            'closed', ?, ?, ?, ?)
  `);
  const insertSale = sqlite.prepare(`
    INSERT INTO sales
      (id, tenant_id, sale_number, customer_id, subtotal, tax_amount,
       discount_amount, total, currency_code, exchange_rate_at_sale,
       payment_method, payment_status, status, cash_session_id, created_by,
       sync_status, sync_version, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 0, 0, ?, 'COP', 1, 'cash', 'paid', 'completed', ?, ?,
            'synced', 1, ?, ?)
  `);
  const insertSaleItem = sqlite.prepare(`
    INSERT INTO sale_items
      (id, sale_id, product_id, product_name_snapshot, product_sku_snapshot,
       quantity, unit_price, unit_equivalence, discount, tax_rate, tax_amount,
       cost_at_sale, total, currency_code, exchange_rate_at_sale)
    VALUES (?, ?, ?, ?, ?, 1, ?, 1, 0, 0, 0, ?, ?, 'COP', 1)
  `);
  const insertPayment = sqlite.prepare(`
    INSERT INTO sale_payments
      (id, tenant_id, sale_id, method, amount, reference, sync_status,
       sync_version, created_at)
    VALUES (?, ?, ?, 'cash', ?, ?, 'synced', 1, ?)
  `);

  sqlite.transaction(() => {
    for (let index = 0; index < profile.products; index += 1) {
      const id = `recovery-product-${index.toString().padStart(6, '0')}`;
      const sku = `REC-${index.toString().padStart(6, '0')}`;
      const timestamp = new Date(PROFILE_START_MS + (index % 365) * DAY_MS).toISOString();
      const price = 1_000 + (index % 100) * 10;
      insertProduct.run(
        id,
        tenant.id,
        `Recovery product ${index.toString().padStart(6, '0')}`,
        sku,
        price,
        Math.round(price * 0.62),
        timestamp,
        timestamp
      );
    }

    for (let index = 0; index < profile.customers; index += 1) {
      const timestamp = new Date(PROFILE_START_MS + (index % 365) * DAY_MS).toISOString();
      insertCustomer.run(
        `recovery-customer-${index.toString().padStart(6, '0')}`,
        tenant.id,
        `Recovery customer ${index.toString().padStart(6, '0')}`,
        `REC-TAX-${index.toString().padStart(8, '0')}`,
        timestamp,
        timestamp
      );
    }

    for (let index = 0; index < profile.cashSessions; index += 1) {
      const openedAt = new Date(PROFILE_START_MS + index * DAY_MS + 8 * 3_600_000).toISOString();
      const closedAt = new Date(PROFILE_START_MS + index * DAY_MS + 20 * 3_600_000).toISOString();
      insertCashSession.run(
        `recovery-cash-session-${index.toString().padStart(4, '0')}`,
        tenant.id,
        site.id,
        user.id,
        20_000_000,
        20_000_000,
        openedAt,
        closedAt,
        openedAt,
        closedAt
      );
    }

    for (let index = 0; index < profile.sales; index += 1) {
      const saleId = `recovery-sale-${index.toString().padStart(7, '0')}`;
      const customerId = `recovery-customer-${(index % profile.customers).toString().padStart(6, '0')}`;
      const cashSessionId = `recovery-cash-session-${(index % profile.cashSessions).toString().padStart(4, '0')}`;
      const soldAt = new Date(
        PROFILE_START_MS + (index % 365) * DAY_MS + (index % 720) * 60_000
      ).toISOString();
      let total = 0;
      const lines: Array<{ productIndex: number; unitPrice: number }> = [];
      for (let line = 0; line < profile.itemsPerSale; line += 1) {
        const productIndex = (index * profile.itemsPerSale + line) % profile.products;
        const unitPrice = 1_000 + (productIndex % 100) * 10;
        total += unitPrice;
        lines.push({ productIndex, unitPrice });
      }
      insertSale.run(
        saleId,
        tenant.id,
        `REC-${(index + 1).toString().padStart(8, '0')}`,
        customerId,
        total,
        total,
        cashSessionId,
        user.id,
        soldAt,
        soldAt
      );
      for (let line = 0; line < lines.length; line += 1) {
        const lineData = lines[line]!;
        const productId = `recovery-product-${lineData.productIndex.toString().padStart(6, '0')}`;
        const sku = `REC-${lineData.productIndex.toString().padStart(6, '0')}`;
        insertSaleItem.run(
          `${saleId}-item-${line.toString().padStart(2, '0')}`,
          saleId,
          productId,
          `Recovery product ${lineData.productIndex.toString().padStart(6, '0')}`,
          sku,
          lineData.unitPrice,
          Math.round(lineData.unitPrice * 0.62),
          lineData.unitPrice
        );
      }
      insertPayment.run(
        `${saleId}-payment`,
        tenant.id,
        saleId,
        total,
        `REC-PAY-${(index + 1).toString().padStart(8, '0')}`,
        soldAt
      );
    }
  })();

  const expected = expectedDatasetCounts(profile);
  const actual = inspectPackagedRecoveryDataset(sqlite);
  assertDatasetCounts(actual, expected);
  const foreignKeyViolations = sqlite.pragma('foreign_key_check') as unknown[];
  if (foreignKeyViolations.length > 0) {
    throw new Error(
      `packaged recovery dataset has ${foreignKeyViolations.length} foreign-key violations`
    );
  }
  return actual;
}

const FINGERPRINT_TABLES = [
  'products',
  'customers',
  'cash_sessions',
  'sales',
  'sale_items',
  'sale_payments',
] as const;

/** Hash every representative business row, not only aggregate counts. */
export function fingerprintPackagedRecoveryDataset(sqlite: Database.Database): string {
  const hash = createHash('sha256');
  for (const table of FINGERPRINT_TABLES) {
    hash.update(`${table}\n`);
    const statement = sqlite.prepare(`SELECT * FROM ${table} ORDER BY id`);
    for (const row of statement.iterate() as Iterable<Record<string, unknown>>) {
      hash.update(JSON.stringify(row));
      hash.update('\n');
    }
  }
  return hash.digest('hex');
}
