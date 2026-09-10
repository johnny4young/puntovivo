import Database from 'better-sqlite3';
import { expect } from '@playwright/test';

/** Independent read-only SQLite oracle after the full UI journey, including encrypted desktop. */
export function assertFirstOwnerRetailEvidence(databasePath: string, encryptionKey?: string) {
  const db = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    if (encryptionKey) {
      if (!/^[a-f0-9]{64}$/i.test(encryptionKey)) throw new Error('Invalid test database key');
      db.pragma("cipher='sqlcipher'");
      db.pragma('legacy = 4');
      db.pragma(`key = "x'${encryptionKey}'"`);
    }
    expect(db.prepare('SELECT name FROM tenants').all()).toEqual([
      { name: 'Owner-operated Retail' },
    ]);
    expect(db.prepare('SELECT email, role FROM users').all()).toEqual([
      { email: 'retail-owner@example.com', role: 'admin' },
    ]);
    expect(db.prepare('SELECT name FROM sites').all()).toEqual([{ name: 'Owner Store' }]);
    expect(db.prepare('SELECT completion_kind FROM installation_setup').get()).toEqual({
      completion_kind: 'owner_claim',
    });
    expect(db.prepare('SELECT sku, price, cost FROM products').all()).toEqual([
      { sku: 'OWNER-NOTEBOOK', price: 11900, cost: 6000 },
    ]);
    expect(db.prepare('SELECT on_hand FROM inventory_balances').all()).toEqual([{ on_hand: 4 }]);
    expect(db.prepare('SELECT total FROM product_stock_totals').all()).toEqual([{ total: 4 }]);
    expect(
      db
        .prepare(
          'SELECT sale_number, subtotal, tax_amount, total, status, payment_status FROM sales'
        )
        .all()
    ).toEqual([
      {
        sale_number: 'OWN-000001',
        subtotal: 10000,
        tax_amount: 1900,
        total: 11900,
        status: 'completed',
        payment_status: 'paid',
      },
    ]);
    expect(
      db.prepare('SELECT quantity, cost_at_sale, tax_rate, tax_amount FROM sale_items').all()
    ).toEqual([{ quantity: 1, cost_at_sale: 6000, tax_rate: 19, tax_amount: 1900 }]);
    expect(
      db
        .prepare(
          'SELECT tax_kind, tax_rate, taxable_amount, tax_amount FROM sale_item_tax_components'
        )
        .all()
    ).toEqual([{ tax_kind: 'iva', tax_rate: 19, taxable_amount: 10000, tax_amount: 1900 }]);
    expect(
      db.prepare('SELECT current_value FROM sequentials WHERE document_type = ?').all('sale')
    ).toEqual([{ current_value: 1 }]);
    expect(
      db
        .prepare(
          'SELECT opening_float, expected_balance, actual_count, over_short, status FROM cash_sessions'
        )
        .all()
    ).toEqual([
      {
        opening_float: 0,
        expected_balance: 11900,
        actual_count: 11900,
        over_short: 0,
        status: 'closed',
      },
    ]);
    expect(db.prepare('SELECT SUM(amount) AS signed_total FROM cash_movements').get()).toEqual({
      signed_total: 11900,
    });
    expect(
      db
        .prepare("SELECT COUNT(*) AS n FROM audit_logs WHERE action = 'installation.owner_created'")
        .get()
    ).toEqual({ n: 1 });
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    return {
      saleNumber: 'OWN-000001',
      total: 11900,
      tax: 1900,
      remainingStock: 4,
      cashDifference: 0,
    };
  } finally {
    db.close();
  }
}
