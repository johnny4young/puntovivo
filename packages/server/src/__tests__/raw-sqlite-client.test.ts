import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { rawSqliteClient } from '../db/raw-client.js';

let server: PuntovivoServer;

describe('rawSqliteClient', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
  });

  afterAll(async () => {
    await server.close();
  });

  it('resolves the same connection from the root handle and inside a transaction', () => {
    const db = getDatabase();
    const root = rawSqliteClient(db);
    expect(root).not.toBeNull();
    const inTx = db.transaction(tx => rawSqliteClient(tx));
    expect(inTx).toBe(root);
  });
});
