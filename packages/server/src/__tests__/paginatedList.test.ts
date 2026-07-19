/**
 * A-22 — the paginated-list primitive.
 *
 * The one guarantee worth a test: the total count reflects the SAME `where`
 * the items page uses. That is the subtle bug the helper exists to make
 * impossible — a count that ignores the filter would make totalPages lie and
 * offer empty pages. Driven against a real in-memory DB over the `units`
 * table (a plain tenant-scoped CRUD table).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, like } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { units, users } from '../db/schema.js';
import { paginatedList } from '../trpc/lib/paginatedList.js';

let server: PuntovivoServer;
let tenantId: string;

async function seedUnit(name: string, abbreviation: string) {
  const now = new Date().toISOString();
  await getDatabase()
    .insert(units)
    .values({
      id: nanoid(),
      tenantId,
      name,
      abbreviation,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe('paginatedList', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const admin = await getDatabase()
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    tenantId = admin!.tenantId;
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(async () => {
    await getDatabase().delete(units).where(eq(units.tenantId, tenantId)).run();
  });

  it('returns the filtered page and a total that matches the filter', async () => {
    // 60 units, of which 5 match "Especial".
    for (let i = 0; i < 55; i += 1) await seedUnit(`Unidad ${i}`, `U${i}`);
    for (let i = 0; i < 5; i += 1) await seedUnit(`Especial ${i}`, `E${i}`);

    const where = and(eq(units.tenantId, tenantId), like(units.name, '%Especial%'));
    const result = await paginatedList({
      db: getDatabase(),
      table: units,
      where,
      page: 1,
      perPage: 50,
    });

    // The count reflects the SAME predicate — 5, not 60. If the helper ever
    // counted without the where, this would read 60 and totalPages would lie.
    expect(result.totalItems).toBe(5);
    expect(result.totalPages).toBe(1);
    expect(result.items).toHaveLength(5);
    expect(result.items.every(u => u.name.startsWith('Especial'))).toBe(true);
  });

  it('pages a large unfiltered set with an honest totalPages', async () => {
    for (let i = 0; i < 120; i += 1) await seedUnit(`Unidad ${i}`, `U${i}`);

    const where = eq(units.tenantId, tenantId);
    const page1 = await paginatedList({
      db: getDatabase(),
      table: units,
      where,
      page: 1,
      perPage: 50,
    });
    expect(page1.totalItems).toBe(120);
    expect(page1.totalPages).toBe(3);
    expect(page1.items).toHaveLength(50);

    const page3 = await paginatedList({
      db: getDatabase(),
      table: units,
      where,
      page: 3,
      perPage: 50,
    });
    expect(page3.items).toHaveLength(20); // the tail page
  });

  it('reports zero cleanly when nothing matches', async () => {
    await seedUnit('Solo una', 'S1');
    const where = and(eq(units.tenantId, tenantId), like(units.name, '%nada-coincide%'));
    const result = await paginatedList({
      db: getDatabase(),
      table: units,
      where,
      page: 1,
      perPage: 50,
    });
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(0);
    expect(result.items).toEqual([]);
  });
});
