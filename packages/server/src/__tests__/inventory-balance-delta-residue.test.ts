/**
 * Sub-epsilon residue is canonicalised at the balance mutation boundary.
 *
 * Every stock guard in the application accepts a debit that overshoots the
 * recorded balance by up to QUANTITY_EPSILON, because a balance that has
 * crossed SQLite and repeated unit arithmetic carries IEEE-754 residue. The
 * debit that follows subtracts the FULL requested amount, so a balance of
 * 0.9999995 debited by 1 lands on -0.0000005. Site balances carry no
 * non-negative constraint, so that value stuck and every later read, transfer
 * and report inherited it.
 *
 * Four separate callers reproduced that defect independently - both
 * transformation reversals, the purchase void and the purchase return - each
 * having to remember to derive its delta from settleDebitedBalance. This pins
 * the rule at the one place all seventeen writers pass through, so a new
 * caller cannot reintroduce it.
 *
 * @module __tests__/inventory-balance-delta-residue.test
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { companies, inventoryBalances, products, sites, tenants } from '../db/schema.js';
import { applyInventoryBalanceDelta } from '../services/inventory-balances/apply-delta.js';
import { QUANTITY_EPSILON } from '../lib/quantity.js';

let server: PuntovivoServer;
let tenantId: string;
let siteId: string;

async function seedProductWithBalance(onHand: number): Promise<string> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const productId = nanoid();
  await db.insert(products).values({
    id: productId,
    tenantId,
    name: `Residue ${nanoid(5)}`,
    sku: `RES-${nanoid(6)}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(inventoryBalances).values({
    id: nanoid(),
    tenantId,
    siteId,
    productId,
    onHand,
    reserved: 0,
    createdAt: now,
    updatedAt: now,
  });
  return productId;
}

function storedOnHand(productId: string): number | undefined {
  return getDatabase()
    .select({ onHand: inventoryBalances.onHand })
    .from(inventoryBalances)
    .where(
      and(
        eq(inventoryBalances.tenantId, tenantId),
        eq(inventoryBalances.siteId, siteId),
        eq(inventoryBalances.productId, productId)
      )
    )
    .get()?.onHand;
}

describe('applyInventoryBalanceDelta residue canonicalisation', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const now = new Date().toISOString();
    tenantId = nanoid();
    const companyId = nanoid();
    siteId = nanoid();
    await db.insert(tenants).values({
      id: tenantId,
      name: 'Residue Tenant',
      slug: `residue-${nanoid(6)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: companyId,
      tenantId,
      name: 'Residue Company',
      taxId: '900000003-0',
      address: 'Addr',
      phone: '0000000000',
      email: 'company@residue.test',
      logoUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: siteId,
      tenantId,
      companyId,
      name: 'Residue Site',
      address: 'Addr',
      phone: '0',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('settles a debit that overshoots the balance by less than the tolerance', async () => {
    const productId = await seedProductWithBalance(0.9999995);
    const result = applyInventoryBalanceDelta(getDatabase(), {
      tenantId,
      siteId,
      productId,
      delta: -1,
    });
    expect(result).toBe(0);
    expect(storedOnHand(productId)).toBe(0);
  });

  it('settles a credit that lands a hair above zero', async () => {
    const productId = await seedProductWithBalance(-0.0000005);
    applyInventoryBalanceDelta(getDatabase(), { tenantId, siteId, productId, delta: 0.0000005 });
    expect(storedOnHand(productId)).toBe(0);
  });

  it('leaves a genuine shortfall negative and visible', async () => {
    // The tolerance canonicalises float noise, it does not clamp missing
    // stock. A shortfall larger than the tolerance is real and must stay
    // readable, because this function deliberately does not police stock.
    const productId = await seedProductWithBalance(1);
    const result = applyInventoryBalanceDelta(getDatabase(), {
      tenantId,
      siteId,
      productId,
      delta: -1.5,
    });
    expect(result).toBe(-0.5);
    expect(storedOnHand(productId)).toBe(-0.5);
  });

  it('does not swallow the smallest quantity the forms expose', async () => {
    // The tolerance sits three orders of magnitude below 0.001, so an
    // operational unit can never be canonicalised away.
    expect(QUANTITY_EPSILON).toBeLessThan(0.001 / 100);
    const productId = await seedProductWithBalance(0.002);
    const result = applyInventoryBalanceDelta(getDatabase(), {
      tenantId,
      siteId,
      productId,
      delta: -0.001,
    });
    expect(result).toBe(0.001);
    expect(storedOnHand(productId)).toBe(0.001);
  });
});
