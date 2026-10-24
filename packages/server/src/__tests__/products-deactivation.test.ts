import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import type { Context } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';

// File-backed, synthetic-only fixture. Never listen: background delivery workers
// remain stopped, and no physical/fiscal integration is invoked.
describe('Product deactivation transaction and edit version', () => {
  let server: PuntovivoServer;
  let directory: string;
  let dbPath: string;
  let context: Context;

  function caller() {
    return appRouter.createCaller({ ...context, db: getDatabase() });
  }

  function snapshot(id: string) {
    const db = new Database(dbPath, { readonly: true });
    try {
      return {
        row: db.prepare('SELECT * FROM products WHERE id = ?').get(id),
        outbox: db.prepare('SELECT * FROM sync_outbox WHERE entity_id = ? ORDER BY id').all(id),
      };
    } finally {
      db.close();
    }
  }

  async function reopen() {
    await server.close();
    server = await createServer({ dbPath, verbose: false, seedData: false });
    context.req = { ...context.req, server: server.app } as Context['req'];
  }

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'product-deactivation-'));
    dbPath = join(directory, 'synthetic.db');
    server = await createServer({ dbPath, verbose: false });
    const admin = getDatabase()
      .select()
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!admin) throw new Error('Expected synthetic seeded admin');
    context = {
      req: { server: server.app, headers: {} } as Context['req'],
      res: {} as Context['res'],
      db: getDatabase(),
      user: { id: admin.id, email: admin.email, role: 'admin', tenantId: admin.tenantId },
      tenantId: admin.tenantId,
      siteId: null,
    };
  });

  afterEach(async () => {
    await server?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('rolls back the entire row and outbox on rejected enqueue, including after reopen', async () => {
    const product = await caller().products.create({
      name: 'Synthetic rollback',
      sku: 'ROLLBACK',
      price: 10,
      cost: 5,
      stock: 0,
    });
    const before = snapshot(product.id);
    const client = (getDatabase() as unknown as { $client: Database.Database }).$client;
    // A scoped SQLite failure exercises the real authoritative writer, not a mock.
    client.exec(`CREATE TRIGGER reject_product_sync BEFORE INSERT ON sync_outbox
      WHEN NEW.entity_type = 'products' AND NEW.operation = 'update'
      AND NEW.entity_id = '${product.id}'
      BEGIN SELECT RAISE(ABORT, 'Synthetic outbox rejection'); END`);
    try {
      await expect(caller().products.delete({ id: product.id })).rejects.toThrow(
        'Synthetic outbox rejection'
      );
      expect(snapshot(product.id)).toEqual(before);
    } finally {
      client.exec('DROP TRIGGER reject_product_sync');
    }
    await reopen();
    expect(snapshot(product.id)).toEqual(before);
  });

  it('commits deactivation and one matching outbox row with an advanced edit version', async () => {
    const product = await caller().products.create({
      name: 'Synthetic success',
      sku: 'SUCCESS',
      price: 10,
      cost: 5,
      stock: 0,
    });
    const before = await caller().products.getById({ id: product.id });
    await expect(caller().products.delete({ id: product.id })).resolves.toEqual({
      success: true,
      id: product.id,
    });
    await reopen();
    const after = await caller().products.getById({ id: product.id });
    expect(after).toMatchObject({
      isActive: false,
      version: before.version + 1,
      syncVersion: (before.syncVersion ?? 0) + 1,
    });
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = db
        .prepare("SELECT payload FROM sync_outbox WHERE entity_id = ? AND operation = 'update'")
        .all(product.id) as { payload: string }[];
      expect(rows).toHaveLength(1);
      expect(JSON.parse(rows[0]!.payload)).toMatchObject({
        id: product.id,
        isActive: false,
        version: after.version,
        updatedAt: after.updatedAt,
      });
      expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('rejects a stale active form after delete/reopen and allows deliberate fresh reactivation', async () => {
    const product = await caller().products.create({
      name: 'Synthetic stale form',
      sku: 'STALE',
      price: 10,
      cost: 5,
      stock: 0,
    });
    await caller().products.delete({ id: product.id });
    await reopen();
    const deleted = snapshot(product.id);
    await expect(
      caller().products.update({
        id: product.id,
        version: product.version,
        name: 'Old tab save',
        isActive: true,
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(snapshot(product.id)).toEqual(deleted);
    await reopen();
    expect(snapshot(product.id)).toEqual(deleted);
    const fresh = await caller().products.getById({ id: product.id });
    const reactivated = await caller().products.update({
      id: product.id,
      version: fresh.version,
      name: 'Deliberately reactivated',
      isActive: true,
    });
    expect(reactivated).toMatchObject({ isActive: true, version: fresh.version + 1 });
  });
});
