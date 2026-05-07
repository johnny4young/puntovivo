/**
 * ENG-036b — CAF allocator tests.
 *
 * Pin the contract every fiscal-CL emission relies on:
 *   - Folio allocation advances cursor atomically.
 *   - CAF_NOT_AVAILABLE when no active row matches.
 *   - CAF_EXHAUSTED when cursor would exceed folio_hasta + status flips.
 *   - Cross-tenant isolation: tenant A's CAF doesn't satisfy tenant B.
 *   - Atomicity: a failing transaction rolls back the cursor.
 *   - peekActiveCaf is read-only (no cursor mutation).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../../../../../index.js';
import { getDatabase } from '../../../../../db/index.js';
import { fiscalCafs, tenants } from '../../../../../db/schema.js';
import { ServerErrorWithCode } from '../../../../../lib/errorCodes.js';
import {
  allocateNextFolio,
  peekActiveCaf,
} from '../caf-allocator.js';

let server: PuntovivoServer;

async function seedTenant(suffix: string): Promise<string> {
  const db = getDatabase();
  const id = `caf-tenant-${suffix}`;
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id,
    name: `CAF Tenant ${suffix}`,
    slug: `caf-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function seedCaf(args: {
  tenantId: string;
  tipoDte: string;
  folioDesde: number;
  folioHasta: number;
  currentFolio?: number;
  status?: 'active' | 'exhausted' | 'revoked';
}): Promise<string> {
  const db = getDatabase();
  const id = `caf-${args.tenantId}-${args.tipoDte}`;
  const now = new Date().toISOString();
  await db.insert(fiscalCafs).values({
    id,
    tenantId: args.tenantId,
    tipoDte: args.tipoDte,
    rutEmisor: '76123456-0',
    folioDesde: args.folioDesde,
    folioHasta: args.folioHasta,
    currentFolio: args.currentFolio ?? args.folioDesde,
    fechaAutorizacion: '2026-01-01',
    rawXml: '<AUTORIZACION><CAF version="1.0"><DA></DA></CAF></AUTORIZACION>',
    status: args.status ?? 'active',
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  // Clean fiscal_cafs + tenants between tests so the partial unique
  // idx doesn't bleed state across cases.
  const db = getDatabase();
  await db.delete(fiscalCafs).run();
});

describe('allocateNextFolio (ENG-036b)', () => {
  it('allocates folio_desde on the first call and advances the cursor', async () => {
    const tenantId = await seedTenant('first');
    await seedCaf({ tenantId, tipoDte: '39', folioDesde: 1, folioHasta: 100 });

    const db = getDatabase();
    const result = db.transaction(tx =>
      allocateNextFolio(tx, { tenantId, tipoDte: '39' })
    );

    expect(result.folio).toBe(1);
    expect(result.tipoDte).toBe('39');
    expect(result.rangeRemaining).toBe(99);

    // Cursor advanced.
    const row = await db.select().from(fiscalCafs).where(eq(fiscalCafs.tenantId, tenantId)).get();
    expect(row?.currentFolio).toBe(2);
    expect(row?.status).toBe('active');
  });

  it('increments the cursor across multiple allocations', async () => {
    const tenantId = await seedTenant('multi');
    await seedCaf({ tenantId, tipoDte: '39', folioDesde: 1, folioHasta: 100 });

    const db = getDatabase();
    const folios = [1, 2, 3, 4, 5].map(() =>
      db.transaction(tx => allocateNextFolio(tx, { tenantId, tipoDte: '39' }).folio)
    );

    expect(folios).toEqual([1, 2, 3, 4, 5]);
    const row = await db.select().from(fiscalCafs).where(eq(fiscalCafs.tenantId, tenantId)).get();
    expect(row?.currentFolio).toBe(6);
  });

  it('flips status to exhausted when allocating the LAST folio in the range', async () => {
    const tenantId = await seedTenant('last');
    await seedCaf({
      tenantId,
      tipoDte: '39',
      folioDesde: 1,
      folioHasta: 2,
      currentFolio: 2,
    });

    const db = getDatabase();
    const result = db.transaction(tx =>
      allocateNextFolio(tx, { tenantId, tipoDte: '39' })
    );
    expect(result.folio).toBe(2);
    expect(result.rangeRemaining).toBe(0);

    const row = await db.select().from(fiscalCafs).where(eq(fiscalCafs.tenantId, tenantId)).get();
    expect(row?.currentFolio).toBe(3);
    expect(row?.status).toBe('exhausted');
  });

  it('throws CAF_NOT_AVAILABLE when no active CAF exists', async () => {
    const tenantId = await seedTenant('empty');
    // No CAF seeded.
    const db = getDatabase();
    expect(() =>
      db.transaction(tx => allocateNextFolio(tx, { tenantId, tipoDte: '39' }))
    ).toThrow(ServerErrorWithCode);

    try {
      db.transaction(tx => allocateNextFolio(tx, { tenantId, tipoDte: '39' }));
    } catch (err) {
      expect(err).toBeInstanceOf(ServerErrorWithCode);
      const swe = err as ServerErrorWithCode;
      expect(swe.errorCode).toBe('CAF_NOT_AVAILABLE');
      expect(swe.details).toMatchObject({ tenantId, tipoDte: '39' });
    }
  });

  it('throws CAF_NOT_AVAILABLE when the only CAF is exhausted', async () => {
    const tenantId = await seedTenant('exhausted-only');
    await seedCaf({
      tenantId,
      tipoDte: '39',
      folioDesde: 1,
      folioHasta: 2,
      currentFolio: 3,
      status: 'exhausted',
    });

    const db = getDatabase();
    try {
      db.transaction(tx => allocateNextFolio(tx, { tenantId, tipoDte: '39' }));
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ServerErrorWithCode);
      expect((err as ServerErrorWithCode).errorCode).toBe('CAF_NOT_AVAILABLE');
    }
  });

  it('throws CAF_EXHAUSTED when current_folio already exceeds folio_hasta on entry', async () => {
    const tenantId = await seedTenant('over');
    const cafId = await seedCaf({
      tenantId,
      tipoDte: '39',
      folioDesde: 1,
      folioHasta: 2,
      currentFolio: 3,
      status: 'active',
    });

    const db = getDatabase();
    try {
      db.transaction(tx => allocateNextFolio(tx, { tenantId, tipoDte: '39' }));
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ServerErrorWithCode);
      const swe = err as ServerErrorWithCode;
      expect(swe.errorCode).toBe('CAF_EXHAUSTED');
      expect(swe.details).toMatchObject({ cafId, folioHasta: 2 });
    }

    // Status NOT flipped: the throw rolls back any same-tx side
    // effect, so the row stays as we found it. Documented as a
    // defensive case — under normal flow the "last folio in range"
    // path on the previous allocation already flipped to exhausted.
    const row = await db.select().from(fiscalCafs).where(eq(fiscalCafs.id, cafId)).get();
    expect(row?.status).toBe('active');
  });

  it('isolates tenants — A allocates without affecting B', async () => {
    const tenantA = await seedTenant('iso-a');
    const tenantB = await seedTenant('iso-b');
    await seedCaf({ tenantId: tenantA, tipoDte: '39', folioDesde: 1, folioHasta: 100 });
    await seedCaf({ tenantId: tenantB, tipoDte: '39', folioDesde: 200, folioHasta: 300 });

    const db = getDatabase();
    db.transaction(tx => allocateNextFolio(tx, { tenantId: tenantA, tipoDte: '39' }));

    const aRow = await db.select().from(fiscalCafs).where(eq(fiscalCafs.tenantId, tenantA)).get();
    const bRow = await db.select().from(fiscalCafs).where(eq(fiscalCafs.tenantId, tenantB)).get();
    expect(aRow?.currentFolio).toBe(2);
    expect(bRow?.currentFolio).toBe(200);
  });

  it('rolls back the cursor when the surrounding transaction throws after allocation', async () => {
    const tenantId = await seedTenant('rollback');
    await seedCaf({ tenantId, tipoDte: '39', folioDesde: 1, folioHasta: 100 });

    const db = getDatabase();
    expect(() =>
      db.transaction(tx => {
        allocateNextFolio(tx, { tenantId, tipoDte: '39' });
        throw new Error('downstream insert failed');
      })
    ).toThrow(/downstream insert failed/);

    // Cursor untouched.
    const row = await db.select().from(fiscalCafs).where(eq(fiscalCafs.tenantId, tenantId)).get();
    expect(row?.currentFolio).toBe(1);
    expect(row?.status).toBe('active');
  });
});

describe('peekActiveCaf (ENG-036b)', () => {
  it('returns null when no active CAF exists', async () => {
    const tenantId = await seedTenant('peek-empty');
    const db = getDatabase();
    expect(peekActiveCaf(db, tenantId, '39')).toBeNull();
  });

  it('returns the active CAF metadata without mutating state', async () => {
    const tenantId = await seedTenant('peek-active');
    await seedCaf({
      tenantId,
      tipoDte: '39',
      folioDesde: 1,
      folioHasta: 100,
      currentFolio: 42,
    });

    const db = getDatabase();
    const result = peekActiveCaf(db, tenantId, '39');
    expect(result).not.toBeNull();
    expect(result?.currentFolio).toBe(42);
    expect(result?.rangeRemaining).toBe(59); // 100 - 42 + 1
    expect(result?.folioDesde).toBe(1);
    expect(result?.folioHasta).toBe(100);

    // Cursor untouched after the read.
    const row = await db.select().from(fiscalCafs).where(eq(fiscalCafs.tenantId, tenantId)).get();
    expect(row?.currentFolio).toBe(42);
    expect(row?.status).toBe('active');
  });

  it('returns null when the only CAF is exhausted (partial unique idx skipped)', async () => {
    const tenantId = await seedTenant('peek-exhausted');
    await seedCaf({
      tenantId,
      tipoDte: '39',
      folioDesde: 1,
      folioHasta: 2,
      currentFolio: 3,
      status: 'exhausted',
    });

    const db = getDatabase();
    expect(peekActiveCaf(db, tenantId, '39')).toBeNull();
  });
});
