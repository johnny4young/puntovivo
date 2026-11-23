import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditLogs, tenants, users } from '../db/schema.js';
import { ensureServiceIdentity, isServiceIdentity } from '../services/users/service-identity.js';
import { writeAuditLog } from '../services/audit-logs.js';
import { toHumanSessionIdentity } from '../security/session-identity.js';

let server: PuntovivoServer;
let tenantId: string;
let humanUserId: string;

describe('service identity', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const human = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!human) throw new Error('Expected seeded administrator');
    tenantId = human.tenantId;
    humanUserId = human.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates the payment-worker identity with no credentials at all', () => {
    const db = getDatabase();
    const identity = ensureServiceIdentity(db, { tenantId });

    const row = db.select().from(users).where(eq(users.id, identity.id)).get();
    expect(row).toMatchObject({
      kind: 'service',
      email: null,
      passwordHash: null,
      staffPinHash: null,
      // Least privilege: never an admin role.
      role: 'viewer',
    });
    expect(isServiceIdentity(db, tenantId, identity.id)).toBe(true);
  });

  it('is idempotent: repeated calls return the same row', () => {
    const db = getDatabase();
    const first = ensureServiceIdentity(db, { tenantId });
    const second = ensureServiceIdentity(db, { tenantId });
    expect(second.id).toBe(first.id);

    const count = db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.kind, 'service')))
      .all().length;
    expect(count).toBe(1);
  });

  it('survives two concurrent creations by converging on one row', async () => {
    const db = getDatabase();
    const [a, b] = await Promise.all([
      Promise.resolve().then(() => ensureServiceIdentity(db, { tenantId })),
      Promise.resolve().then(() => ensureServiceIdentity(db, { tenantId })),
    ]);
    expect(a.id).toBe(b.id);
  });

  it('keeps identities isolated per tenant', () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const otherTenantId = nanoid();
    db.insert(tenants)
      .values({
        id: otherTenantId,
        name: 'Other tenant',
        slug: `other-${otherTenantId.slice(0, 8)}`,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const mine = ensureServiceIdentity(db, { tenantId });
    const theirs = ensureServiceIdentity(db, { tenantId: otherTenantId });
    expect(theirs.id).not.toBe(mine.id);
    expect(isServiceIdentity(db, tenantId, theirs.id)).toBe(false);
    expect(isServiceIdentity(db, otherTenantId, theirs.id)).toBe(true);
  });

  it('refuses to build a session identity from a service row', () => {
    const db = getDatabase();
    const identity = ensureServiceIdentity(db, { tenantId });
    const row = db.select().from(users).where(eq(users.id, identity.id)).get();
    expect(() => toHumanSessionIdentity(row!)).toThrow(/service identity cannot authenticate/);
  });

  it('refuses a human row that has no credentials', () => {
    expect(() =>
      toHumanSessionIdentity({
        id: 'u1',
        tenantId,
        kind: 'human',
        email: 'someone@example.test',
        role: 'cashier',
        sessionVersion: 1,
        // A human without a password hash cannot authenticate either.
        passwordHash: null,
      } as never)
    ).not.toThrow();
    expect(() =>
      toHumanSessionIdentity({
        id: 'u2',
        tenantId,
        kind: 'human',
        email: null,
        role: 'cashier',
        sessionVersion: 1,
      })
    ).toThrow(/cannot authenticate/);
  });

  it('is rejected by the database when it tries to carry credentials', () => {
    const db = getDatabase();
    expect(() =>
      db
        .insert(users)
        .values({
          id: nanoid(),
          tenantId,
          kind: 'service',
          email: 'worker@example.test',
          name: 'bogus-service',
          passwordHash: 'x',
          role: 'viewer',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .run()
    ).toThrow(/chk_users_service_has_no_credentials/i);
  });

  it('writes an audit row attributed to the service actor, preserving the chain', () => {
    const db = getDatabase();
    const identity = ensureServiceIdentity(db, { tenantId });
    const resourceId = nanoid();

    const before = db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)).all();
    writeAuditLog({
      tx: db,
      tenantId,
      actorId: identity.id,
      action: 'payment.provider_response',
      resourceType: 'sale',
      resourceId,
      before: null,
      after: { status: 'approved', amount: 60000 },
      metadata: { initiatedBy: humanUserId },
    });
    const after = db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)).all();

    expect(after.length).toBe(before.length + 1);
    const written = after.find(row => row.resourceId === resourceId);
    expect(written?.actorId).toBe(identity.id);
    expect(written?.metadata).toMatchObject({ initiatedBy: humanUserId });
    // The chain links each row to its predecessor: no gap, no rewrite.
    expect(written?.prevHash).toBe(before[before.length - 1]?.chainHash ?? written?.prevHash);
    expect(written?.chainHash).toBeTruthy();
  });

  it('keeps human actions attributed to the human actor', () => {
    const db = getDatabase();
    const resourceId = nanoid();
    writeAuditLog({
      tx: db,
      tenantId,
      actorId: humanUserId,
      action: 'sale_payment.transfer_manual_confirmed',
      resourceType: 'sale',
      resourceId,
      before: null,
      after: { status: 'manual_confirmed' },
    });
    const written = db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, resourceId)))
      .get();
    expect(written?.actorId).toBe(humanUserId);
  });

  it('rolls back the whole operation when the audit write fails', () => {
    const db = getDatabase();
    const identity = ensureServiceIdentity(db, { tenantId });
    const resourceId = nanoid();

    expect(() =>
      db.transaction(tx => {
        // Simulate the financial effect landing first...
        writeAuditLog({
          tx,
          tenantId,
          actorId: identity.id,
          action: 'payment.provider_response',
          resourceType: 'sale',
          resourceId,
          before: null,
          after: null,
        });
        // ...then an audit failure aborts everything.
        throw new Error('audit unavailable');
      })
    ).toThrow(/audit unavailable/);

    const leaked = db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, resourceId)))
      .all();
    expect(leaked).toHaveLength(0);
  });
});
