import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import { cleanupRestrictiveBusinessLinks } from '../e2e/shared/baseline.ts';

function listIds(db, table) {
  return db
    .prepare(`select id from ${table} order by id`)
    .all()
    .map(row => row.id);
}

test('E2E cleanup removes restrictive business links child-first and stays tenant-safe', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    create table users (
      id text primary key,
      tenant_id text not null,
      email text not null
    );
    create table purchases (
      id text primary key,
      tenant_id text not null,
      created_by text not null references users(id)
    );
    create table provider_payable_invoices (
      id text primary key,
      tenant_id text not null,
      purchase_id text references purchases(id),
      created_by text not null references users(id)
    );
    create table provider_payable_payments (
      id text primary key,
      tenant_id text not null,
      created_by text not null references users(id)
    );
    create table provider_payable_credits (
      id text primary key,
      tenant_id text not null,
      created_by text not null references users(id)
    );
    create table provider_payable_allocations (
      id text primary key,
      tenant_id text not null,
      invoice_id text not null references provider_payable_invoices(id),
      payment_id text references provider_payable_payments(id),
      credit_id text references provider_payable_credits(id),
      created_by text not null references users(id)
    );
    create table quotations (
      id text primary key,
      tenant_id text not null,
      created_by text not null references users(id)
    );
    create table sales (
      id text primary key,
      tenant_id text not null,
      created_by text not null references users(id)
    );
    create table quotation_sale_links (
      id text primary key,
      tenant_id text not null,
      quotation_id text not null references quotations(id),
      sale_id text not null references sales(id),
      converted_by text not null references users(id)
    );
    create table sale_returns (
      id text primary key,
      tenant_id text not null,
      sale_id text not null references sales(id) on delete cascade,
      created_by text not null references users(id)
    );
    create table sale_return_items (
      id text primary key,
      tenant_id text not null,
      sale_return_id text not null references sale_returns(id) on delete cascade
    );
    create table sale_exchanges (
      id text primary key,
      tenant_id text not null,
      sale_return_id text not null references sale_returns(id) on delete restrict,
      replacement_sale_id text not null references sales(id) on delete restrict,
      created_by text not null references users(id)
    );
    create table store_credit_accounts (
      id text primary key,
      tenant_id text not null,
      balance real not null
    );
    create table store_credit_movements (
      id text primary key,
      tenant_id text not null,
      account_id text not null references store_credit_accounts(id) on delete restrict,
      sale_return_id text references sale_returns(id) on delete restrict,
      sale_id text references sales(id) on delete restrict,
      created_by text not null references users(id)
    );
    create table loyalty_accounts (
      id text primary key,
      tenant_id text not null,
      points integer not null,
      updated_at text not null
    );
    create table loyalty_movements (
      id text primary key,
      tenant_id text not null,
      account_id text not null references loyalty_accounts(id) on delete cascade,
      sale_id text references sales(id),
      sale_return_id text,
      points integer not null,
      created_by text references users(id)
    );
    create table sync_outbox (
      id text primary key,
      tenant_id text not null,
      entity_type text not null,
      entity_id text not null
    );
  `);

  const insertUser = db.prepare('insert into users values (?, ?, ?)');
  insertUser.run('disposable', 'tenant-a', 'e2e.run-42@local.test');
  insertUser.run('template', 'tenant-a', 'e2e.manager@local.test');
  insertUser.run('operator', 'tenant-a', 'owner@local.test');
  insertUser.run('other-disposable', 'tenant-b', 'e2e.other@local.test');

  const insertPurchase = db.prepare('insert into purchases values (?, ?, ?)');
  insertPurchase.run('purchase-disposable', 'tenant-a', 'disposable');
  insertPurchase.run('purchase-operator', 'tenant-a', 'operator');
  insertPurchase.run('purchase-other', 'tenant-b', 'other-disposable');

  const insertInvoice = db.prepare('insert into provider_payable_invoices values (?, ?, ?, ?)');
  insertInvoice.run('invoice-by-disposable', 'tenant-a', null, 'disposable');
  insertInvoice.run(
    'invoice-on-disposable-purchase',
    'tenant-a',
    'purchase-disposable',
    'operator'
  );
  insertInvoice.run('invoice-operator', 'tenant-a', 'purchase-operator', 'operator');
  insertInvoice.run('invoice-template', 'tenant-a', null, 'template');
  insertInvoice.run('invoice-other', 'tenant-b', 'purchase-other', 'other-disposable');

  const insertPayment = db.prepare('insert into provider_payable_payments values (?, ?, ?)');
  insertPayment.run('payment-disposable', 'tenant-a', 'disposable');
  insertPayment.run('payment-operator', 'tenant-a', 'operator');
  insertPayment.run('payment-preserved', 'tenant-a', 'operator');
  insertPayment.run('payment-other', 'tenant-b', 'other-disposable');
  const insertCredit = db.prepare('insert into provider_payable_credits values (?, ?, ?)');
  insertCredit.run('credit-disposable', 'tenant-a', 'disposable');
  insertCredit.run('credit-mixed', 'tenant-a', 'operator');
  insertCredit.run('credit-operator', 'tenant-a', 'operator');
  insertCredit.run('credit-other', 'tenant-b', 'other-disposable');

  const insertAllocation = db.prepare(
    'insert into provider_payable_allocations values (?, ?, ?, ?, ?, ?)'
  );
  insertAllocation.run(
    'allocation-on-owned-invoice',
    'tenant-a',
    'invoice-by-disposable',
    'payment-operator',
    null,
    'operator'
  );
  insertAllocation.run(
    'allocation-on-linked-invoice',
    'tenant-a',
    'invoice-on-disposable-purchase',
    'payment-operator',
    null,
    'operator'
  );
  insertAllocation.run(
    'allocation-from-payment',
    'tenant-a',
    'invoice-operator',
    'payment-disposable',
    null,
    'operator'
  );
  insertAllocation.run(
    'allocation-from-credit',
    'tenant-a',
    'invoice-operator',
    null,
    'credit-disposable',
    'operator'
  );
  insertAllocation.run(
    'allocation-by-disposable',
    'tenant-a',
    'invoice-operator',
    'payment-operator',
    null,
    'disposable'
  );
  insertAllocation.run(
    'allocation-operator',
    'tenant-a',
    'invoice-operator',
    'payment-operator',
    null,
    'operator'
  );
  insertAllocation.run(
    'allocation-template',
    'tenant-a',
    'invoice-template',
    'payment-operator',
    null,
    'template'
  );
  insertAllocation.run(
    'allocation-preserved',
    'tenant-a',
    'invoice-operator',
    'payment-preserved',
    null,
    'operator'
  );
  insertAllocation.run(
    'allocation-credit-mixed-owned',
    'tenant-a',
    'invoice-by-disposable',
    null,
    'credit-mixed',
    'operator'
  );
  insertAllocation.run(
    'allocation-credit-mixed-operator',
    'tenant-a',
    'invoice-operator',
    null,
    'credit-mixed',
    'operator'
  );
  insertAllocation.run(
    'allocation-credit-operator',
    'tenant-a',
    'invoice-operator',
    null,
    'credit-operator',
    'operator'
  );
  insertAllocation.run(
    'allocation-other',
    'tenant-b',
    'invoice-other',
    'payment-other',
    null,
    'other-disposable'
  );

  const insertQuotation = db.prepare('insert into quotations values (?, ?, ?)');
  const insertSale = db.prepare('insert into sales values (?, ?, ?)');
  for (const [suffix, quotationActor, saleActor] of [
    ['quotation', 'disposable', 'operator'],
    ['sale', 'operator', 'disposable'],
    ['converter', 'operator', 'operator'],
    ['operator', 'operator', 'operator'],
    ['template', 'template', 'template'],
  ]) {
    insertQuotation.run(`quotation-${suffix}`, 'tenant-a', quotationActor);
    insertSale.run(`sale-${suffix}`, 'tenant-a', saleActor);
  }
  insertQuotation.run('quotation-other', 'tenant-b', 'other-disposable');
  insertSale.run('sale-other', 'tenant-b', 'other-disposable');

  const insertLink = db.prepare('insert into quotation_sale_links values (?, ?, ?, ?, ?)');
  insertLink.run('link-quotation', 'tenant-a', 'quotation-quotation', 'sale-quotation', 'operator');
  insertLink.run('link-sale', 'tenant-a', 'quotation-sale', 'sale-sale', 'operator');
  insertLink.run(
    'link-converter',
    'tenant-a',
    'quotation-converter',
    'sale-converter',
    'disposable'
  );
  insertLink.run('link-operator', 'tenant-a', 'quotation-operator', 'sale-operator', 'operator');
  insertLink.run('link-template', 'tenant-a', 'quotation-template', 'sale-template', 'template');
  insertLink.run('link-other', 'tenant-b', 'quotation-other', 'sale-other', 'other-disposable');

  const insertReturn = db.prepare('insert into sale_returns values (?, ?, ?, ?)');
  insertReturn.run('return-on-disposable-sale', 'tenant-a', 'sale-sale', 'operator');
  insertReturn.run('return-by-disposable', 'tenant-a', 'sale-operator', 'disposable');
  insertReturn.run('return-operator', 'tenant-a', 'sale-operator', 'operator');
  insertReturn.run('return-template', 'tenant-a', 'sale-template', 'template');
  insertReturn.run('return-other', 'tenant-b', 'sale-other', 'other-disposable');

  const insertReturnItem = db.prepare('insert into sale_return_items values (?, ?, ?)');
  for (const returnId of [
    'return-on-disposable-sale',
    'return-by-disposable',
    'return-operator',
    'return-template',
  ]) {
    insertReturnItem.run(`item-${returnId}`, 'tenant-a', returnId);
  }
  insertReturnItem.run('item-return-other', 'tenant-b', 'return-other');

  const insertExchange = db.prepare('insert into sale_exchanges values (?, ?, ?, ?, ?)');
  insertExchange.run(
    'exchange-return-owned',
    'tenant-a',
    'return-on-disposable-sale',
    'sale-operator',
    'operator'
  );
  insertExchange.run(
    'exchange-replacement-owned',
    'tenant-a',
    'return-operator',
    'sale-sale',
    'operator'
  );
  insertExchange.run(
    'exchange-template',
    'tenant-a',
    'return-template',
    'sale-template',
    'template'
  );
  insertExchange.run(
    'exchange-other',
    'tenant-b',
    'return-other',
    'sale-other',
    'other-disposable'
  );

  const insertStoreCreditAccount = db.prepare('insert into store_credit_accounts values (?, ?, ?)');
  insertStoreCreditAccount.run('store-account-touched', 'tenant-a', 12);
  insertStoreCreditAccount.run('store-account-preserved', 'tenant-a', 7);
  insertStoreCreditAccount.run('store-account-other', 'tenant-b', 5);
  const insertStoreCreditMovement = db.prepare(
    'insert into store_credit_movements values (?, ?, ?, ?, ?, ?)'
  );
  insertStoreCreditMovement.run(
    'store-movement-return',
    'tenant-a',
    'store-account-touched',
    'return-on-disposable-sale',
    null,
    'operator'
  );
  insertStoreCreditMovement.run(
    'store-movement-adjustment',
    'tenant-a',
    'store-account-touched',
    null,
    null,
    'operator'
  );
  insertStoreCreditMovement.run(
    'store-movement-preserved',
    'tenant-a',
    'store-account-preserved',
    null,
    'sale-operator',
    'operator'
  );
  insertStoreCreditMovement.run(
    'store-movement-other',
    'tenant-b',
    'store-account-other',
    'return-other',
    'sale-other',
    'other-disposable'
  );

  const insertLoyaltyAccount = db.prepare('insert into loyalty_accounts values (?, ?, ?, ?)');
  insertLoyaltyAccount.run('loyalty-account-mixed', 'tenant-a', 8, 'before');
  insertLoyaltyAccount.run('loyalty-account-preserved', 'tenant-a', 5, 'before');
  insertLoyaltyAccount.run('loyalty-account-other', 'tenant-b', 3, 'before');
  const insertLoyaltyMovement = db.prepare(
    'insert into loyalty_movements values (?, ?, ?, ?, ?, ?, ?)'
  );
  insertLoyaltyMovement.run(
    'loyalty-movement-keep',
    'tenant-a',
    'loyalty-account-mixed',
    'sale-operator',
    null,
    10,
    'operator'
  );
  insertLoyaltyMovement.run(
    'loyalty-movement-return',
    'tenant-a',
    'loyalty-account-mixed',
    'sale-sale',
    'return-on-disposable-sale',
    -2,
    'operator'
  );
  insertLoyaltyMovement.run(
    'loyalty-movement-preserved',
    'tenant-a',
    'loyalty-account-preserved',
    'sale-operator',
    null,
    5,
    'operator'
  );
  insertLoyaltyMovement.run(
    'loyalty-movement-other',
    'tenant-b',
    'loyalty-account-other',
    'sale-other',
    'return-other',
    3,
    'other-disposable'
  );

  const insertOutbox = db.prepare('insert into sync_outbox values (?, ?, ?, ?)');
  for (const [entityType, entityId] of [
    ['provider_payable_invoices', 'invoice-by-disposable'],
    ['provider_payable_invoices', 'invoice-on-disposable-purchase'],
    ['provider_payable_payments', 'payment-disposable'],
    ['provider_payable_payments', 'payment-operator'],
    ['provider_payable_payments', 'payment-preserved'],
    ['provider_payable_credits', 'credit-disposable'],
    ['provider_payable_credits', 'credit-mixed'],
    ['provider_payable_allocations', 'allocation-from-payment'],
    ['provider_payable_invoices', 'invoice-operator'],
  ]) {
    insertOutbox.run(`outbox-${entityId}`, 'tenant-a', entityType, entityId);
  }
  insertOutbox.run(
    'outbox-invoice-other',
    'tenant-b',
    'provider_payable_invoices',
    'invoice-other'
  );
  for (const [entityType, entityId] of [
    ['sale_returns', 'return-on-disposable-sale'],
    ['sale_returns', 'return-operator'],
    ['store_credit_accounts', 'store-account-touched'],
    ['store_credit_accounts', 'store-account-preserved'],
    ['store_credit_movements', 'store-movement-return'],
    ['store_credit_movements', 'store-movement-adjustment'],
    ['store_credit_movements', 'store-movement-preserved'],
  ]) {
    insertOutbox.run(`outbox-${entityId}`, 'tenant-a', entityType, entityId);
  }

  cleanupRestrictiveBusinessLinks(db, 'tenant-a');
  cleanupRestrictiveBusinessLinks(db, 'tenant-a');

  assert.deepEqual(listIds(db, 'provider_payable_allocations'), [
    'allocation-credit-operator',
    'allocation-other',
    'allocation-preserved',
  ]);
  assert.deepEqual(listIds(db, 'provider_payable_invoices'), [
    'invoice-operator',
    'invoice-other',
    'invoice-template',
  ]);
  assert.deepEqual(listIds(db, 'provider_payable_payments'), [
    'payment-other',
    'payment-preserved',
  ]);
  assert.deepEqual(listIds(db, 'provider_payable_credits'), ['credit-operator', 'credit-other']);
  assert.deepEqual(listIds(db, 'quotation_sale_links'), [
    'link-operator',
    'link-other',
    'link-template',
  ]);
  assert.deepEqual(listIds(db, 'sale_returns'), [
    'return-operator',
    'return-other',
    'return-template',
  ]);
  assert.deepEqual(listIds(db, 'sale_return_items'), [
    'item-return-operator',
    'item-return-other',
    'item-return-template',
  ]);
  assert.deepEqual(listIds(db, 'sale_exchanges'), ['exchange-other', 'exchange-template']);
  assert.deepEqual(listIds(db, 'store_credit_accounts'), [
    'store-account-other',
    'store-account-preserved',
  ]);
  assert.deepEqual(listIds(db, 'store_credit_movements'), [
    'store-movement-other',
    'store-movement-preserved',
  ]);
  assert.deepEqual(listIds(db, 'loyalty_movements'), [
    'loyalty-movement-keep',
    'loyalty-movement-other',
    'loyalty-movement-preserved',
  ]);
  assert.equal(
    db.prepare("select points from loyalty_accounts where id = 'loyalty-account-mixed'").get()
      .points,
    10
  );
  assert.deepEqual(listIds(db, 'sync_outbox'), [
    'outbox-invoice-operator',
    'outbox-invoice-other',
    'outbox-payment-preserved',
    'outbox-return-operator',
    'outbox-store-account-preserved',
    'outbox-store-movement-preserved',
  ]);

  assert.doesNotThrow(() => {
    db.prepare(
      "delete from quotations where tenant_id = 'tenant-a' and created_by = 'disposable'"
    ).run();
    db.prepare(
      "delete from sales where tenant_id = 'tenant-a' and created_by = 'disposable'"
    ).run();
    db.prepare(
      "delete from purchases where tenant_id = 'tenant-a' and created_by = 'disposable'"
    ).run();
    db.prepare("delete from users where tenant_id = 'tenant-a' and id = 'disposable'").run();
  });
  assert.equal(
    db.prepare("select count(*) as count from users where tenant_id = 'tenant-b'").get().count,
    1
  );

  db.close();
});
