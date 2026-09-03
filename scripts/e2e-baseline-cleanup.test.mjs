import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';

import {
  cleanupRestaurantArtifacts,
  cleanupKitchenArtifacts,
  cleanupRestaurantTableCatalog,
  cleanupPromotionArtifacts,
  cleanupRestrictiveBusinessLinks,
  resetTenantSyncState,
} from '../e2e/shared/baseline.ts';

function listIds(db, table) {
  return db
    .prepare(`select id from ${table} order by id`)
    .all()
    .map(row => row.id);
}

test('E2E baseline clears stale sync state only for its disposable tenant', () => {
  const db = new Database(':memory:');
  db.exec(`
    create table sync_conflicts (
      id text primary key,
      tenant_id text not null,
      entity_type text not null,
      entity_id text not null
    );
    insert into sync_conflicts values
      ('conflict-a-1', 'tenant-a', 'sales', 'sale-a-1'),
      ('conflict-a-2', 'tenant-a', 'products', 'product-a-1'),
      ('conflict-b-1', 'tenant-b', 'sales', 'sale-b-1');
    create table sync_outbox (
      id text primary key,
      tenant_id text not null,
      entity_type text not null,
      entity_id text not null
    );
    insert into sync_outbox values
      ('outbox-a-1', 'tenant-a', 'sales', 'missing-sale-a-1'),
      ('outbox-b-1', 'tenant-b', 'sales', 'sale-b-1');
  `);

  resetTenantSyncState(db, 'tenant-a');
  resetTenantSyncState(db, 'tenant-a');

  assert.deepEqual(listIds(db, 'sync_conflicts'), ['conflict-b-1']);
  assert.deepEqual(listIds(db, 'sync_outbox'), ['outbox-b-1']);
  db.close();
});

test('E2E baseline sync cleanup supports a pre-sync schema', () => {
  const db = new Database(':memory:');
  assert.doesNotThrow(() => resetTenantSyncState(db, 'tenant-a'));
  db.close();
});

test('E2E restaurant cleanup unwinds restrictive projections tenant-first', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    create table restaurant_services (
      id text primary key,
      tenant_id text not null
    );
    create table sales (
      id text primary key,
      tenant_id text not null
    );
    create table sale_items (
      id text primary key,
      tenant_id text not null,
      sale_id text not null references sales(id) on delete restrict
    );
    create table restaurant_checks (
      id text primary key,
      tenant_id text not null,
      service_id text not null references restaurant_services(id) on delete restrict,
      sale_id text not null references sales(id) on delete restrict
    );
    create table restaurant_diners (
      id text primary key,
      tenant_id text not null,
      service_id text not null references restaurant_services(id) on delete restrict
    );
    create table restaurant_courses (
      id text primary key,
      tenant_id text not null,
      check_id text not null references restaurant_checks(id) on delete restrict
    );
    create table restaurant_rounds (
      id text primary key,
      tenant_id text not null,
      check_id text not null references restaurant_checks(id) on delete restrict
    );
    create table restaurant_check_lines (
      id text primary key,
      tenant_id text not null,
      check_id text not null references restaurant_checks(id) on delete restrict,
      sale_item_id text not null references sale_items(id) on delete restrict
    );
    create table restaurant_line_modifiers (
      id text primary key,
      tenant_id text not null,
      check_line_id text not null references restaurant_check_lines(id) on delete restrict
    );

    insert into restaurant_services values ('service-a', 'tenant-a'), ('service-b', 'tenant-b');
    insert into sales values ('sale-a', 'tenant-a'), ('sale-b', 'tenant-b');
    insert into sale_items values ('item-a', 'tenant-a', 'sale-a'), ('item-b', 'tenant-b', 'sale-b');
    insert into restaurant_checks values
      ('check-a', 'tenant-a', 'service-a', 'sale-a'),
      ('check-b', 'tenant-b', 'service-b', 'sale-b');
    insert into restaurant_diners values
      ('diner-a', 'tenant-a', 'service-a'),
      ('diner-b', 'tenant-b', 'service-b');
    insert into restaurant_courses values
      ('course-a', 'tenant-a', 'check-a'),
      ('course-b', 'tenant-b', 'check-b');
    insert into restaurant_rounds values
      ('round-a', 'tenant-a', 'check-a'),
      ('round-b', 'tenant-b', 'check-b');
    insert into restaurant_check_lines values
      ('line-a', 'tenant-a', 'check-a', 'item-a'),
      ('line-b', 'tenant-b', 'check-b', 'item-b');
    insert into restaurant_line_modifiers values
      ('modifier-a', 'tenant-a', 'line-a'),
      ('modifier-b', 'tenant-b', 'line-b');
  `);

  cleanupRestaurantArtifacts(db, 'tenant-a');
  cleanupRestaurantArtifacts(db, 'tenant-a');

  for (const [table, survivor] of [
    ['restaurant_services', 'service-b'],
    ['restaurant_checks', 'check-b'],
    ['restaurant_diners', 'diner-b'],
    ['restaurant_courses', 'course-b'],
    ['restaurant_rounds', 'round-b'],
    ['restaurant_check_lines', 'line-b'],
    ['restaurant_line_modifiers', 'modifier-b'],
  ]) {
    assert.deepEqual(listIds(db, table), [survivor]);
  }
  assert.doesNotThrow(() => db.prepare("delete from sale_items where id = 'item-a'").run());
  assert.doesNotThrow(() => db.prepare("delete from sales where id = 'sale-a'").run());
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.close();
});

test('E2E restaurant cleanup supports a pre-restaurant schema', () => {
  const db = new Database(':memory:');
  assert.doesNotThrow(() => cleanupRestaurantArtifacts(db, 'tenant-a'));
  db.close();
});

test('E2E promotion cleanup releases restrictive targets and preserves other tenants', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    create table users (
      id text primary key,
      tenant_id text not null,
      email text not null
    );
    create table products (
      id text primary key,
      tenant_id text not null,
      name text not null,
      sku text
    );
    create table customers (
      id text primary key,
      tenant_id text not null,
      name text not null
    );
    create table promotions (
      id text primary key,
      tenant_id text not null,
      name text not null,
      product_id text references products(id) on delete restrict,
      customer_id text references customers(id) on delete restrict,
      created_by text not null references users(id),
      updated_by text not null references users(id)
    );
    create table sale_item_promotions (
      id text primary key,
      tenant_id text not null,
      promotion_id text not null references promotions(id) on delete restrict
    );
    create table price_suggestions (
      id text primary key,
      tenant_id text not null,
      promotion_id text
    );
    create table sync_outbox (
      id text primary key,
      tenant_id text not null,
      entity_type text not null,
      entity_id text not null
    );
    create table audit_logs (
      id text primary key,
      tenant_id text not null,
      resource_type text not null,
      resource_id text not null
    );

    insert into users values
      ('actor-a', 'tenant-a', 'e2e.run-42@local.test'),
      ('template-a', 'tenant-a', 'e2e.admin@local.test'),
      ('operator-a', 'tenant-a', 'owner@local.test'),
      ('actor-b', 'tenant-b', 'e2e.run-42@local.test');
    insert into products values
      ('product-a', 'tenant-a', 'E2E Product A', 'E2E-A'),
      ('product-preserved', 'tenant-a', 'Permanent Product', 'PERM-A'),
      ('product-b', 'tenant-b', 'E2E Product B', 'E2E-B');
    insert into customers values
      ('customer-a', 'tenant-a', 'E2E Customer A'),
      ('customer-preserved', 'tenant-a', 'Permanent Customer'),
      ('customer-b', 'tenant-b', 'E2E Customer B');
    insert into promotions values
      ('promotion-actor', 'tenant-a', 'Temporary actor rule', null, null, 'actor-a', 'actor-a'),
      ('promotion-product', 'tenant-a', 'Temporary product rule', 'product-a', null, 'operator-a', 'operator-a'),
      ('promotion-customer', 'tenant-a', 'Temporary customer rule', null, 'customer-a', 'operator-a', 'operator-a'),
      ('promotion-name', 'tenant-a', 'E2E tenant rule', null, null, 'template-a', 'template-a'),
      ('promotion-preserved', 'tenant-a', 'Permanent rule', 'product-preserved', 'customer-preserved', 'template-a', 'template-a'),
      ('promotion-other', 'tenant-b', 'E2E other tenant rule', 'product-b', 'customer-b', 'actor-b', 'actor-b');
    insert into sale_item_promotions values
      ('snapshot-a', 'tenant-a', 'promotion-actor'),
      ('snapshot-preserved', 'tenant-a', 'promotion-preserved'),
      ('snapshot-other', 'tenant-b', 'promotion-other');
    insert into price_suggestions values
      ('suggestion-a', 'tenant-a', 'promotion-product'),
      ('suggestion-preserved', 'tenant-a', 'promotion-preserved'),
      ('suggestion-other', 'tenant-b', 'promotion-other');
    insert into sync_outbox values
      ('outbox-a', 'tenant-a', 'promotions', 'promotion-customer'),
      ('outbox-preserved', 'tenant-a', 'promotions', 'promotion-preserved'),
      ('outbox-other', 'tenant-b', 'promotions', 'promotion-other');
    insert into audit_logs values
      ('audit-a', 'tenant-a', 'promotion', 'promotion-name'),
      ('audit-preserved', 'tenant-a', 'promotion', 'promotion-preserved'),
      ('audit-other', 'tenant-b', 'promotion', 'promotion-other');
  `);

  cleanupPromotionArtifacts(db, 'tenant-a');
  cleanupPromotionArtifacts(db, 'tenant-a');

  assert.deepEqual(listIds(db, 'promotions'), ['promotion-other', 'promotion-preserved']);
  assert.deepEqual(listIds(db, 'sale_item_promotions'), ['snapshot-other', 'snapshot-preserved']);
  assert.deepEqual(listIds(db, 'sync_outbox'), ['outbox-other', 'outbox-preserved']);
  assert.deepEqual(listIds(db, 'audit_logs'), ['audit-other', 'audit-preserved']);
  assert.deepEqual(
    db.prepare('select id, promotion_id as promotionId from price_suggestions order by id').all(),
    [
      { id: 'suggestion-a', promotionId: null },
      { id: 'suggestion-other', promotionId: 'promotion-other' },
      { id: 'suggestion-preserved', promotionId: 'promotion-preserved' },
    ]
  );
  assert.doesNotThrow(() => {
    db.prepare("delete from products where id = 'product-a'").run();
    db.prepare("delete from customers where id = 'customer-a'").run();
    db.prepare("delete from users where id = 'actor-a'").run();
  });
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.close();
});

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
    create table fiscal_emission_intents (
      id text primary key,
      tenant_id text not null,
      requested_by_user_id text not null references users(id)
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
  const insertIntent = db.prepare('insert into fiscal_emission_intents values (?, ?, ?)');
  insertIntent.run('intent-disposable', 'tenant-a', 'disposable');
  insertIntent.run('intent-template', 'tenant-a', 'template');
  insertIntent.run('intent-operator', 'tenant-a', 'operator');
  insertIntent.run('intent-other', 'tenant-b', 'other-disposable');

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
  assert.deepEqual(listIds(db, 'fiscal_emission_intents'), [
    'intent-operator',
    'intent-other',
    'intent-template',
  ]);

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

test('E2E kitchen cleanup respects restrictive children, tenant scope and retained actors', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    create table users (id text primary key, tenant_id text, email text);
    create table sales (id text primary key, tenant_id text, created_by text references users(id));
    create table sale_items (id text primary key, sale_id text references sales(id));
    create table kds_orders (id text primary key, tenant_id text, sale_id text references sales(id), ready_by_user_id text references users(id));
    create table kds_order_lines (id text primary key, tenant_id text, order_id text references kds_orders(id), ready_by_user_id text references users(id));
    create table kds_line_dispatches (id text primary key, tenant_id text, order_line_id text references kds_order_lines(id), source_sale_item_id text);
    create table kds_order_events (id text primary key, tenant_id text, order_id text references kds_orders(id), actor_id text references users(id));
    create table kds_outbox (id text primary key, tenant_id text, event_id text references kds_order_events(id));
    insert into users values ('a', 'tenant-a', 'e2e.temp@local.test'), ('b', 'tenant-b', 'e2e.temp@local.test'), ('keep', 'tenant-a', 'e2e.admin@local.test');
    insert into sales values ('sale-a', 'tenant-a', 'a'), ('sale-b', 'tenant-b', 'b'), ('sale-keep', 'tenant-a', 'keep');
    insert into sale_items values ('item-a', 'sale-a'), ('item-b', 'sale-b');
    insert into kds_orders values ('order-a', 'tenant-a', 'sale-a', 'a'), ('order-b', 'tenant-b', 'sale-b', 'b'), ('order-keep', 'tenant-a', 'sale-keep', 'a');
    insert into kds_order_lines values ('line-a', 'tenant-a', 'order-a', 'a'), ('line-b', 'tenant-b', 'order-b', 'b'), ('line-keep', 'tenant-a', 'order-keep', 'a');
    insert into kds_order_events values ('event-a', 'tenant-a', 'order-a', 'a'), ('event-b', 'tenant-b', 'order-b', 'b'), ('event-keep', 'tenant-a', 'order-keep', 'a');
    insert into kds_outbox values ('outbox-a', 'tenant-a', 'event-a'), ('outbox-b', 'tenant-b', 'event-b');
    insert into kds_line_dispatches values ('dispatch-a', 'tenant-a', 'line-a', 'item-a'), ('dispatch-b', 'tenant-b', 'line-b', 'item-b'), ('excluded-a', 'tenant-a', null, 'item-a');
  `);
  cleanupKitchenArtifacts(db, 'tenant-a');
  cleanupKitchenArtifacts(db, 'tenant-a');
  assert.deepEqual(listIds(db, 'kds_orders'), ['order-b', 'order-keep']);
  assert.deepEqual(listIds(db, 'kds_line_dispatches'), ['dispatch-b']);
  assert.deepEqual(listIds(db, 'kds_outbox'), ['outbox-b']);
  assert.equal(
    db.prepare("select actor_id from kds_order_events where id='event-keep'").get().actor_id,
    null
  );
  db.exec(
    "delete from sale_items where id='item-a'; delete from sales where id='sale-a'; delete from users where id='a'"
  );
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.close();
});
test('E2E kitchen cleanup supports a pre-kitchen schema', () => {
  const db = new Database(':memory:');
  assert.doesNotThrow(() => cleanupKitchenArtifacts(db, 'tenant-a'));
  db.close();
});

test('E2E table cleanup preserves retained kitchen original and relocated destinations', () => {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
 create table restaurant_tables (id text primary key, tenant_id text, name text);
 create table sales (id text primary key, tenant_id text, table_id text references restaurant_tables(id));
 create table kds_orders (id text primary key, tenant_id text, table_id text references restaurant_tables(id));
 create table kds_order_lines (id text primary key, tenant_id text, current_table_id text);
 insert into restaurant_tables values ('original', 'a', 'E2E Original'), ('relocated', 'a', 'E2E Relocated'), ('discard', 'a', 'E2E Unused'), ('foreign', 'b', 'E2E Foreign');
 insert into sales values ('kept', 'a', 'original'), ('moved', 'a', 'relocated'), ('deleted', 'a', 'discard');
 insert into kds_orders values ('order', 'a', 'original');
 insert into kds_order_lines values ('line', 'a', 'relocated');
 `);
  cleanupRestaurantTableCatalog(db, 'a');
  cleanupRestaurantTableCatalog(db, 'a');
  assert.deepEqual(listIds(db, 'restaurant_tables'), ['foreign', 'original', 'relocated']);
  assert.equal(db.prepare("select table_id from sales where id='kept'").get().table_id, 'original');
  assert.equal(
    db.prepare("select table_id from sales where id='moved'").get().table_id,
    'relocated'
  );
  assert.equal(db.prepare("select table_id from sales where id='deleted'").get().table_id, null);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  db.close();
});
