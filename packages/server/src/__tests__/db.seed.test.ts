import { afterEach, describe, expect, it } from 'vitest';
import { count } from 'drizzle-orm';
import { closeDatabase, initDatabase } from '../db/index.js';
import { companies, sequentials, sites, tenants, units, users, vatRates } from '../db/schema.js';

describe('database foundation seed', () => {
  afterEach(() => {
    closeDatabase();
  });

  it('seeds the phase 0 foundation data into a fresh database', async () => {
    const db = await initDatabase({
      dbPath: ':memory:',
      runMigrations: true,
      seedData: true,
    });

    const tenantCount = await db.select({ value: count() }).from(tenants).get();
    const userCount = await db.select({ value: count() }).from(users).get();
    const companyCount = await db.select({ value: count() }).from(companies).get();
    const siteCount = await db.select({ value: count() }).from(sites).get();
    const vatRateCount = await db.select({ value: count() }).from(vatRates).get();
    const unitCount = await db.select({ value: count() }).from(units).get();
    const sequentialCount = await db.select({ value: count() }).from(sequentials).get();

    expect(tenantCount?.value).toBe(1);
    expect(userCount?.value).toBe(1);
    expect(companyCount?.value).toBe(1);
    expect(siteCount?.value).toBe(1);
    expect(vatRateCount?.value).toBeGreaterThanOrEqual(3);
    expect(unitCount?.value).toBeGreaterThanOrEqual(5);
    expect(sequentialCount?.value).toBeGreaterThanOrEqual(3);
  });
});
