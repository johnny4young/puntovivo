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

type Caller = ReturnType<typeof appRouter.createCaller>;
type Scenario = {
  name: string;
  entityType: 'categories' | 'providers' | 'units' | 'category_x_provider';
  operation: 'create' | 'update' | 'delete';
  intents?: number;
  prepare: (api: Caller) => Promise<() => Promise<unknown>>;
};

const scenarios: Scenario[] = [
  {
    name: 'category create',
    entityType: 'categories',
    operation: 'create',
    prepare: async api => () => api.categories.create({ name: 'Synthetic new category' }),
  },
  {
    name: 'category update',
    entityType: 'categories',
    operation: 'update',
    prepare: async api => {
      const row = await api.categories.create({ name: 'Synthetic category' });
      return () =>
        api.categories.update({
          id: row.id,
          version: row.version,
          name: 'Synthetic changed category',
        });
    },
  },
  {
    name: 'category delete',
    entityType: 'categories',
    operation: 'delete',
    prepare: async api => {
      const row = await api.categories.create({ name: 'Synthetic category' });
      return () => api.categories.delete({ id: row.id });
    },
  },
  {
    name: 'provider create',
    entityType: 'providers',
    operation: 'create',
    prepare: async api => () => api.providers.create({ name: 'Synthetic provider' }),
  },
  {
    name: 'provider update',
    entityType: 'providers',
    operation: 'update',
    prepare: async api => {
      const row = await api.providers.create({ name: 'Synthetic provider' });
      return () =>
        api.providers.update({
          id: row.id,
          version: row.version,
          name: 'Synthetic changed provider',
        });
    },
  },
  {
    name: 'provider delete',
    entityType: 'providers',
    operation: 'delete',
    prepare: async api => {
      const row = await api.providers.create({ name: 'Synthetic provider' });
      return () => api.providers.delete({ id: row.id });
    },
  },
  {
    name: 'unit create',
    entityType: 'units',
    operation: 'create',
    prepare: async api => () =>
      api.units.create({ name: 'Synthetic unit', abbreviation: 'QAUNIT' }),
  },
  {
    name: 'unit update',
    entityType: 'units',
    operation: 'update',
    prepare: async api => {
      const row = await api.units.create({ name: 'Synthetic unit', abbreviation: 'QAUNIT' });
      return () => api.units.update({ id: row.id, name: 'Synthetic changed unit' });
    },
  },
  {
    name: 'unit delete',
    entityType: 'units',
    operation: 'delete',
    prepare: async api => {
      const row = await api.units.create({ name: 'Synthetic unit', abbreviation: 'QAUNIT' });
      return () => api.units.delete({ id: row.id });
    },
  },
  {
    name: 'provider category replacement',
    entityType: 'category_x_provider',
    operation: 'create',
    intents: 2,
    prepare: async api => {
      const provider = await api.providers.create({ name: 'Synthetic assigned provider' });
      const previous = await api.categories.create({ name: 'Synthetic previous category' });
      const next = await api.categories.create({ name: 'Synthetic next category' });
      await api.providers.replaceCategoryAssignments({
        providerId: provider.id,
        categoryIds: [previous.id],
      });
      return () =>
        api.providers.replaceCategoryAssignments({
          providerId: provider.id,
          categoryIds: [next.id],
        });
    },
  },
];

// A new owned SQLite file per test. No listener, delivery worker or fiscal/printer call.
describe('Catalog row and authoritative outbox atomicity', () => {
  let server: PuntovivoServer;
  let directory: string;
  let dbPath: string;
  let context: Context;

  function caller() {
    return appRouter.createCaller({ ...context, db: getDatabase() });
  }
  function snapshot() {
    const db = new Database(dbPath, { readonly: true });
    try {
      const rows = (
        table: 'categories' | 'providers' | 'units' | 'category_x_provider' | 'sync_outbox'
      ) =>
        db.prepare(`SELECT * FROM ${table} WHERE tenant_id = ? ORDER BY id`).all(context.tenantId);
      return {
        categories: rows('categories'),
        providers: rows('providers'),
        units: rows('units'),
        category_x_provider: rows('category_x_provider'),
        sync_outbox: rows('sync_outbox'),
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
    directory = mkdtempSync(join(tmpdir(), 'catalog-outbox-'));
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

  for (const scenario of scenarios) {
    it(`${scenario.name} rolls back all rows/intents on enqueue failure and after reopen`, async () => {
      const action = await scenario.prepare(caller());
      const before = snapshot();
      const client = (getDatabase() as unknown as { $client: Database.Database }).$client;
      const tenant = context.tenantId!.replaceAll("'", "''");
      client.exec(`CREATE TRIGGER reject_catalog_outbox BEFORE INSERT ON sync_outbox
        WHEN NEW.tenant_id = '${tenant}' AND NEW.entity_type = '${scenario.entityType}' AND NEW.operation = '${scenario.operation}'
        BEGIN SELECT RAISE(ABORT, 'Synthetic catalog outbox rejection'); END`);
      try {
        await expect(action()).rejects.toThrow('Synthetic catalog outbox rejection');
        expect(snapshot()).toEqual(before);
      } finally {
        client.exec('DROP TRIGGER reject_catalog_outbox');
      }
      await reopen();
      expect(snapshot()).toEqual(before);
    });

    it(`${scenario.name} commits the change with exactly its intents and survives reopen`, async () => {
      const action = await scenario.prepare(caller());
      const before = snapshot();
      await action();
      const after = snapshot();
      expect(after).not.toEqual(before);
      expect(after.sync_outbox).toHaveLength(before.sync_outbox.length + (scenario.intents ?? 1));
      const db = new Database(dbPath, { readonly: true });
      try {
        expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
        expect(db.pragma('foreign_key_check')).toEqual([]);
      } finally {
        db.close();
      }
      await reopen();
      expect(snapshot()).toEqual(after);
    });
  }
});
