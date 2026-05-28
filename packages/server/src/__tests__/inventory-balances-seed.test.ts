/**
 * ENG-177a — `ensureInventoryBalancesForSite` chunked-insert tests.
 *
 * The seeding loop was converted from one INSERT per product to a chunked
 * multi-row insert (90 rows/chunk, under SQLITE_MAX_VARIABLE_NUMBER). These
 * tests pin the behavior across the chunk boundary and confirm the
 * seed-only `onConflictDoNothing` contract still holds (re-running never
 * clobbers existing balance rows).
 *
 * @module __tests__/inventory-balances-seed.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { ensureInventoryBalancesForSite } from '../services/inventory-balances.js';
import { companies, inventoryBalances, products, sites, tenants } from '../db/schema.js';

let server: PuntovivoServer;
let tenantId: string;
let primarySiteId: string;
let secondarySiteId: string;

// Two full chunks plus a partial one (90 + 90 + 5) to exercise the boundary.
const PRODUCT_COUNT = 185;

describe('ensureInventoryBalancesForSite (ENG-177a chunked insert)', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const now = new Date().toISOString();
    tenantId = nanoid();
    const companyId = nanoid();
    primarySiteId = nanoid();
    secondarySiteId = nanoid();

    await db.insert(tenants).values({
      id: tenantId,
      name: 'Balances Tenant',
      slug: `balances-${nanoid(6)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(companies).values({
      id: companyId,
      tenantId,
      name: 'Balances Company',
      taxId: '900000002-0',
      address: 'Addr',
      phone: '0000000000',
      email: 'company@balances.test',
      logoUrl: null,
      createdAt: now,
      updatedAt: now,
    });
    // Primary site is created first (earliest createdAt wins the primary slot).
    await db.insert(sites).values({
      id: primarySiteId,
      tenantId,
      companyId,
      name: 'Primary',
      address: 'Addr',
      phone: '0',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: secondarySiteId,
      tenantId,
      companyId,
      name: 'Secondary',
      address: 'Addr',
      phone: '0',
      isActive: true,
      createdAt: new Date(Date.now() + 1000).toISOString(),
      updatedAt: now,
    });

    for (let i = 0; i < PRODUCT_COUNT; i += 1) {
      await db.insert(products).values({
        id: nanoid(),
        tenantId,
        name: `Product ${i}`,
        sku: `SKU-${i}-${nanoid(4)}`,
        stock: 7,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  });

  afterAll(async () => {
    await server.close();
  });

  function countBalances(siteId: string): number {
    const db = getDatabase();
    return db
      .select({ id: inventoryBalances.id })
      .from(inventoryBalances)
      .where(
        and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.siteId, siteId))
      )
      .all().length;
  }

  it('seeds one balance row per product across the chunk boundary', () => {
    const db = getDatabase();
    ensureInventoryBalancesForSite(db, tenantId, primarySiteId);
    expect(countBalances(primarySiteId)).toBe(PRODUCT_COUNT);

    // Primary site inherits products.stock as the opening on_hand.
    const sample = db
      .select({ onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, primarySiteId)
        )
      )
      .all();
    expect(sample.every(row => row.onHand === 7)).toBe(true);
  });

  it('opens non-primary sites at zero on_hand', () => {
    const db = getDatabase();
    ensureInventoryBalancesForSite(db, tenantId, secondarySiteId);
    expect(countBalances(secondarySiteId)).toBe(PRODUCT_COUNT);
    const rows = db
      .select({ onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, tenantId),
          eq(inventoryBalances.siteId, secondarySiteId)
        )
      )
      .all();
    expect(rows.every(row => row.onHand === 0)).toBe(true);
  });

  it('is idempotent — re-seeding never clobbers or duplicates rows', () => {
    const db = getDatabase();
    // Mutate one balance to prove onConflictDoNothing preserves it.
    const target = db
      .select({ id: inventoryBalances.id })
      .from(inventoryBalances)
      .where(eq(inventoryBalances.siteId, primarySiteId))
      .limit(1)
      .get();
    expect(target).toBeDefined();
    db.update(inventoryBalances)
      .set({ onHand: 999 })
      .where(eq(inventoryBalances.id, target!.id))
      .run();

    ensureInventoryBalancesForSite(db, tenantId, primarySiteId);

    expect(countBalances(primarySiteId)).toBe(PRODUCT_COUNT);
    const preserved = db
      .select({ onHand: inventoryBalances.onHand })
      .from(inventoryBalances)
      .where(eq(inventoryBalances.id, target!.id))
      .get();
    expect(preserved?.onHand).toBe(999);
  });
});
