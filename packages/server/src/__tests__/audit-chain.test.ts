/**
 * Append-only audit hash chain (H3.2a).
 *
 * Every row written through writeAuditLog links to the previous one via
 * SHA-256; the verifier walks the chain from the per-tenant head. These
 * tests pin the contract: growth, tamper detection (edit AND delete),
 * legal redaction surviving verification, per-tenant independence, and
 * the deterministic-id dedup that replaced INSERT OR IGNORE.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { auditChainHeads, auditLogs, tenants, users } from '../db/schema.js';
import {
  AUDIT_CHAIN_GENESIS,
  redactAuditLogPayloads,
  verifyAuditChain,
  writeAuditLog,
} from '../services/audit-logs.js';
import { computeAuditHeadMac, configureAuditAnchorKey } from '../services/audit-anchor.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;

function writeOne(metadata: Record<string, unknown> = {}, id?: string): string {
  const db = getDatabase();
  return db.transaction(tx =>
    writeAuditLog({
      tx,
      ...(id !== undefined ? { id } : {}),
      tenantId,
      actorId: userId,
      action: 'module.toggle',
      resourceType: 'tenant',
      resourceId: tenantId,
      before: null,
      after: { flag: true },
      metadata,
    })
  );
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
  if (!seededUser) throw new Error('Expected seeded admin user');
  tenantId = seededUser.tenantId;
  userId = seededUser.id;
});

afterAll(async () => {
  await server.close();
});

describe('audit hash chain', () => {
  it('links rows from genesis and verifies', async () => {
    const firstId = writeOne({ n: 1 });
    const secondId = writeOne({ n: 2 });

    const db = getDatabase();
    const first = await db.select().from(auditLogs).where(eq(auditLogs.id, firstId)).get();
    const second = await db.select().from(auditLogs).where(eq(auditLogs.id, secondId)).get();
    expect(first?.prevHash).toBe(AUDIT_CHAIN_GENESIS);
    expect(second?.prevHash).toBe(first?.chainHash);

    const head = await db
      .select()
      .from(auditChainHeads)
      .where(eq(auditChainHeads.tenantId, tenantId))
      .get();
    expect(head?.headHash).toBe(second?.chainHash);

    const result = verifyAuditChain(db, tenantId);
    expect(result.valid).toBe(true);
    expect(result.checkedCount).toBeGreaterThanOrEqual(2);
  });

  it('detects an edited row', async () => {
    const victimId = writeOne({ v: 'original' });
    const db = getDatabase();
    await db
      .update(auditLogs)
      .set({ after: { flag: false } })
      .where(eq(auditLogs.id, victimId));

    const result = verifyAuditChain(db, tenantId);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('content-mismatch');
    expect(result.brokenAtId).toBe(victimId);

    // Restore so later tests see an intact chain.
    await db
      .update(auditLogs)
      .set({ after: { flag: true } })
      .where(eq(auditLogs.id, victimId));
    expect(verifyAuditChain(db, tenantId).valid).toBe(true);
  });

  it('detects a deleted row', async () => {
    const middleId = writeOne({ mark: 'middle' });
    writeOne({ mark: 'tail' });
    const db = getDatabase();
    const middle = await db.select().from(auditLogs).where(eq(auditLogs.id, middleId)).get();
    await db.delete(auditLogs).where(eq(auditLogs.id, middleId));

    const result = verifyAuditChain(db, tenantId);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing-link');

    // Restore the row verbatim so later tests see an intact chain.
    await db.insert(auditLogs).values(middle!);
    expect(verifyAuditChain(db, tenantId).valid).toBe(true);
  });

  it('keeps verifying after a legal redaction', async () => {
    const redactedId = writeOne({ pii: 'sensitive' });
    const db = getDatabase();
    const headBefore = await db
      .select()
      .from(auditChainHeads)
      .where(eq(auditChainHeads.tenantId, tenantId))
      .get();
    db.transaction(tx =>
      redactAuditLogPayloads({
        tx,
        tenantId,
        ids: [redactedId],
        redactedAt: new Date().toISOString(),
      })
    );

    const result = verifyAuditChain(db, tenantId);
    expect(result.valid).toBe(true);
    const redacted = await db.select().from(auditLogs).where(eq(auditLogs.id, redactedId)).get();
    const headAfter = await db
      .select()
      .from(auditChainHeads)
      .where(eq(auditChainHeads.tenantId, tenantId))
      .get();
    expect(redacted).toMatchObject({ before: null, after: null, metadata: null });
    expect(redacted?.contentHash).not.toBeNull();
    expect(headAfter?.headHash).not.toBe(headBefore?.headHash);
  });

  it('rejects payload stripping disguised as a legal redaction', async () => {
    const forgedId = writeOne({ pii: 'remove-me' });
    const db = getDatabase();
    await db
      .update(auditLogs)
      .set({ before: null, after: null, metadata: null, redactedAt: new Date().toISOString() })
      .where(eq(auditLogs.id, forgedId));

    const result = verifyAuditChain(db, tenantId);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('content-mismatch');
    expect(result.brokenAtId).toBe(forgedId);

    // Restore the row so the shared chain stays valid for later cases.
    await db
      .update(auditLogs)
      .set({ after: { flag: true }, metadata: { pii: 'remove-me' }, redactedAt: null })
      .where(eq(auditLogs.id, forgedId));
    expect(verifyAuditChain(db, tenantId).valid).toBe(true);
  });

  it('dedups deterministic ids without burning chain links', async () => {
    const detId = `anomaly:test:${nanoid(6)}`;
    const a = writeOne({ det: 1 }, detId);
    const headAfterFirst = (await getDatabase()
      .select()
      .from(auditChainHeads)
      .where(eq(auditChainHeads.tenantId, tenantId))
      .get())!.headHash;
    const b = writeOne({ det: 2 }, detId);
    expect(a).toBe(detId);
    expect(b).toBe(detId);
    const headAfterSecond = (await getDatabase()
      .select()
      .from(auditChainHeads)
      .where(eq(auditChainHeads.tenantId, tenantId))
      .get())!.headHash;
    // The duplicate write advanced nothing.
    expect(headAfterSecond).toBe(headAfterFirst);
    expect(verifyAuditChain(getDatabase(), tenantId).valid).toBe(true);
  });

  it('keeps tenant chains independent', async () => {
    const db = getDatabase();
    const foreignTenant = `chain-${nanoid(8)}`;
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: foreignTenant,
      name: 'Chain Tenant',
      slug: foreignTenant,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const foreignUser = nanoid();
    await db.insert(users).values({
      id: foreignUser,
      tenantId: foreignTenant,
      email: `chain-${nanoid(6)}@local`,
      name: 'Chain User',
      passwordHash: 'x',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    db.transaction(tx =>
      writeAuditLog({
        tx,
        tenantId: foreignTenant,
        actorId: foreignUser,
        action: 'module.toggle',
        resourceType: 'tenant',
        resourceId: foreignTenant,
      })
    );

    const foreignRow = await db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, foreignTenant), eq(auditLogs.action, 'module.toggle')))
      .get();
    // The other tenant's chain starts at ITS genesis, not ours.
    expect(foreignRow?.prevHash).toBe(AUDIT_CHAIN_GENESIS);
    expect(verifyAuditChain(db, foreignTenant).valid).toBe(true);
    expect(verifyAuditChain(db, tenantId).valid).toBe(true);
  });

  it('rejects a redaction marker over non-null content', async () => {
    const forgedId = writeOne({ target: 'forge' });
    const db = getDatabase();
    // The one-column attack: stamp redacted_at, keep (or rewrite) the
    // payload, touch no hashes. Must NOT pass as a legal redaction.
    await db
      .update(auditLogs)
      .set({ redactedAt: new Date().toISOString() })
      .where(eq(auditLogs.id, forgedId));

    const result = verifyAuditChain(db, tenantId);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('redaction-invalid');
    expect(result.brokenAtId).toBe(forgedId);

    await db.update(auditLogs).set({ redactedAt: null }).where(eq(auditLogs.id, forgedId));
    expect(verifyAuditChain(db, tenantId).valid).toBe(true);
  });

  it('reports a rewritten link as link-mismatch, not content-mismatch', async () => {
    const victimId = writeOne({ target: 'link' });
    const tailId = writeOne({ target: 'tail-after-link' });
    const db = getDatabase();
    const victim = await db.select().from(auditLogs).where(eq(auditLogs.id, victimId)).get();
    // Rewrite the stored prev pointer only — content digest stays intact.
    await db.update(auditLogs).set({ prevHash: 'deadbeef' }).where(eq(auditLogs.id, victimId));

    const result = verifyAuditChain(db, tenantId);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('link-mismatch');
    expect(result.brokenAtId).toBe(victimId);

    await db
      .update(auditLogs)
      .set({ prevHash: victim!.prevHash })
      .where(eq(auditLogs.id, victimId));
    expect(verifyAuditChain(db, tenantId).valid).toBe(true);
    expect(tailId).toBeTruthy();
  });

  it('fails a stale head whose rows are gone instead of reporting intact', async () => {
    const db = getDatabase();
    const loneTenant = `stale-${nanoid(8)}`;
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: loneTenant,
      name: 'Stale Head Tenant',
      slug: loneTenant,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const loneUser = nanoid();
    await db.insert(users).values({
      id: loneUser,
      tenantId: loneTenant,
      email: `stale-${nanoid(6)}@local`,
      name: 'Stale User',
      passwordHash: 'x',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    db.transaction(tx =>
      writeAuditLog({
        tx,
        tenantId: loneTenant,
        actorId: loneUser,
        action: 'module.toggle',
        resourceType: 'tenant',
        resourceId: loneTenant,
      })
    );
    // Wipe every chained row but leave the head row behind — the head
    // now promises a row that no longer exists.
    await db.delete(auditLogs).where(eq(auditLogs.tenantId, loneTenant));

    const result = verifyAuditChain(db, loneTenant);
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('missing-link');
  });

  it('absorbs a cross-tenant deterministic-id collision without throwing', async () => {
    const db = getDatabase();
    const otherTenant = `coll-${nanoid(8)}`;
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: otherTenant,
      name: 'Collision Tenant',
      slug: otherTenant,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const otherUser = nanoid();
    await db.insert(users).values({
      id: otherUser,
      tenantId: otherTenant,
      email: `coll-${nanoid(6)}@local`,
      name: 'Collision User',
      passwordHash: 'x',
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const sharedId = `anomaly:coll:${nanoid(6)}`;
    writeOne({ owner: 'main' }, sharedId);

    const headBefore = (await db
      .select()
      .from(auditChainHeads)
      .where(eq(auditChainHeads.tenantId, otherTenant))
      .get()) as { headHash: string } | undefined;
    // Same global id under another tenant: INSERT OR IGNORE semantics —
    // no throw, no row, no head advance for the second tenant.
    const returned = db.transaction(tx =>
      writeAuditLog({
        tx,
        id: sharedId,
        tenantId: otherTenant,
        actorId: otherUser,
        action: 'module.toggle',
        resourceType: 'tenant',
        resourceId: otherTenant,
      })
    );
    expect(returned).toBe(sharedId);
    const headAfter = (await db
      .select()
      .from(auditChainHeads)
      .where(eq(auditChainHeads.tenantId, otherTenant))
      .get()) as { headHash: string } | undefined;
    expect(headAfter?.headHash).toBe(headBefore?.headHash);
    expect(verifyAuditChain(db, otherTenant).valid).toBe(true);
    expect(verifyAuditChain(db, tenantId).valid).toBe(true);
  });

  it('anchors the head under a configured key and detects a forged head', async () => {
    const db = getDatabase();
    try {
      // A configured key makes an unstamped head invalid. This manual
      // stamp models the explicit trusted adoption/restore boundary;
      // ordinary audit writes are never allowed to bless the gap.
      configureAuditAnchorKey('test-anchor-secret');
      const beforeStamp = verifyAuditChain(db, tenantId);
      expect(beforeStamp.valid).toBe(false);
      expect(beforeStamp.reason).toBe('anchor-mismatch');
      expect(() => writeOne({ mustNotBless: true })).toThrow('AUDIT_CHAIN_HEAD_UNTRUSTED');
      const preKeyHead = (await db
        .select()
        .from(auditChainHeads)
        .where(eq(auditChainHeads.tenantId, tenantId))
        .get())!;
      await db
        .update(auditChainHeads)
        .set({ headMac: computeAuditHeadMac(tenantId, preKeyHead.headHash) })
        .where(eq(auditChainHeads.tenantId, tenantId));
      const afterStamp = verifyAuditChain(db, tenantId);
      expect(afterStamp.valid).toBe(true);
      expect(afterStamp.anchored).toBe(true);

      // Subsequent writes preserve the anchored state.
      writeOne({ anchor: 1 });
      const anchoredResult = verifyAuditChain(db, tenantId);
      expect(anchoredResult.valid).toBe(true);
      expect(anchoredResult.anchored).toBe(true);

      // Authorized redaction rewrites the affected chain and produces a
      // fresh MAC under the configured key without leaving the trust domain.
      const anchoredRedactionId = writeOne({ pii: 'anchored-redaction' });
      db.transaction(tx =>
        redactAuditLogPayloads({
          tx,
          tenantId,
          ids: [anchoredRedactionId],
          redactedAt: new Date().toISOString(),
        })
      );
      const afterRedaction = verifyAuditChain(db, tenantId);
      expect(afterRedaction.valid).toBe(true);
      expect(afterRedaction.anchored).toBe(true);

      // Recompute-everything attack: rewrite the head to a
      // self-consistent chain of one fabricated row. Without the key
      // the attacker cannot produce the matching MAC.
      const head = (await db
        .select()
        .from(auditChainHeads)
        .where(eq(auditChainHeads.tenantId, tenantId))
        .get())!;
      await db
        .update(auditChainHeads)
        .set({ headMac: '0'.repeat(64) })
        .where(eq(auditChainHeads.tenantId, tenantId));
      const forged = verifyAuditChain(db, tenantId);
      expect(forged.valid).toBe(false);
      expect(forged.reason).toBe('anchor-mismatch');

      // Stripping the MAC is also tampering, never a downgrade to a
      // valid-but-unanchored state.
      await db
        .update(auditChainHeads)
        .set({ headMac: null })
        .where(eq(auditChainHeads.tenantId, tenantId));
      const stripped = verifyAuditChain(db, tenantId);
      expect(stripped.valid).toBe(false);
      expect(stripped.reason).toBe('anchor-mismatch');
      expect(() => writeOne({ mustNotBless: true })).toThrow('AUDIT_CHAIN_HEAD_UNTRUSTED');

      await db
        .update(auditChainHeads)
        .set({ headMac: head.headMac })
        .where(eq(auditChainHeads.tenantId, tenantId));
      expect(verifyAuditChain(db, tenantId).valid).toBe(true);
    } finally {
      configureAuditAnchorKey(undefined);
    }
    // Key removed: the stored MAC is ignored, chain stays valid.
    const unkeyed = verifyAuditChain(db, tenantId);
    expect(unkeyed.valid).toBe(true);
    expect(unkeyed.anchored).toBe(false);
  });

  it('tolerates legacy rows written before the chain shipped', async () => {
    const db = getDatabase();
    const legacyId = nanoid();
    await db.insert(auditLogs).values({
      id: legacyId,
      tenantId,
      actorId: userId,
      action: 'module.toggle',
      resourceType: 'tenant',
      resourceId: tenantId,
      before: null,
      after: null,
      metadata: null,
      createdAt: new Date().toISOString(),
    });

    const result = verifyAuditChain(db, tenantId);
    expect(result.valid).toBe(true);
    expect(result.unchainedCount).toBeGreaterThanOrEqual(1);
  });
});
