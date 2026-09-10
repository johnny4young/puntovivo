/**
 * 100k-row audit-chain scale contract.
 *
 * Runs only through scripts/run-audit-chain-profile-gate.mjs. The fixture is
 * file-backed so RSS measurements are not dominated by an in-memory SQLite
 * database. It exercises the production paged verifier and the deliberately
 * transaction-bound privacy rewrite.
 */
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import { loadPerfBudget } from '../perf/budgets.js';
import {
  AUDIT_CHAIN_GENESIS,
  canonicalAuditPayload,
  redactAuditLogPayloads,
  sha256Hex,
  verifyAuditChain,
} from '../services/audit-logs.js';
import { configureAuditAnchor } from '../services/audit-anchor.js';

const budget = loadPerfBudget().auditChainProfile;
const profileDir = mkdtempSync(join(tmpdir(), 'puntovivo-audit-profile-'));
const dbPath = join(profileDir, 'audit.db');
const createdAt = '2026-08-28T00:00:00.000Z';

let server: PuntovivoServer | undefined;
let tenantId = '';
let actorId = '';
let seedElapsedMs = 0;
let verifyElapsedMs = 0;
let redactElapsedMs = 0;
let maxRssGrowthMiB = 0;
let verifyMaxRssGrowthMiB = 0;
let redactMaxRssGrowthMiB = 0;
let rssBaselineMiB = 0;
let queryPlan: string[] = [];

function liveClient(): Database.Database {
  return (getDatabase() as unknown as { $client: Database.Database }).$client;
}

function maxRssMiB(): number {
  return process.resourceUsage().maxRSS / 1024;
}

function insertProfileChain(): void {
  const sqlite = liveClient();
  sqlite.prepare('DELETE FROM audit_logs WHERE tenant_id = ?').run(tenantId);
  sqlite.prepare('DELETE FROM audit_chain_heads WHERE tenant_id = ?').run(tenantId);

  const insert = sqlite.prepare(
    `INSERT INTO audit_logs (
       id, tenant_id, actor_id, action, resource_type, resource_id,
       before, after, metadata, operation_id, created_at,
       content_hash, prev_hash, chain_hash, redacted_at
     ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?, ?, ?, NULL)`
  );
  let prevHash = AUDIT_CHAIN_GENESIS;
  const transaction = sqlite.transaction(() => {
    for (let sequence = 0; sequence < budget.rows; sequence += 1) {
      const id = `audit-profile-${String(sequence).padStart(6, '0')}`;
      const after = { flag: true, sequence };
      const metadata = { source: 'audit-profile' };
      const contentHash = sha256Hex(
        canonicalAuditPayload({
          id,
          tenantId,
          actorId,
          action: 'module.toggle',
          resourceType: 'tenant',
          resourceId: tenantId,
          before: null,
          after,
          metadata,
          operationId: null,
          createdAt,
        })
      );
      const chainHash = sha256Hex(`${prevHash}\n${contentHash}`);
      insert.run(
        id,
        tenantId,
        actorId,
        'module.toggle',
        'tenant',
        tenantId,
        JSON.stringify(after),
        JSON.stringify(metadata),
        createdAt,
        contentHash,
        prevHash,
        chainHash
      );
      prevHash = chainHash;
    }
    sqlite
      .prepare(
        `INSERT INTO audit_chain_heads (
           tenant_id, head_hash, head_mac, anchor_counter, version, adopted_at, updated_at
         ) VALUES (?, ?, NULL, ?, 1, ?, ?)`
      )
      .run(tenantId, prevHash, budget.rows, createdAt, createdAt);
  });
  transaction();
}

describe('100k audit-chain profile', () => {
  beforeAll(async () => {
    configureAuditAnchor({});
    server = await createServer({ dbPath, verbose: false });
    const admin = await getDatabase()
      .select({ id: users.id, tenantId: users.tenantId })
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!admin) throw new Error('Expected seeded admin');
    tenantId = admin.tenantId;
    actorId = admin.id;

    const seedStartedAt = performance.now();
    insertProfileChain();
    seedElapsedMs = performance.now() - seedStartedAt;
    rssBaselineMiB = maxRssMiB();
  }, 120_000);

  afterAll(async () => {
    process.stdout.write(
      `audit-chain-profile measured=${JSON.stringify({ rows: budget.rows, seedElapsedMs: Number(seedElapsedMs.toFixed(2)), verifyElapsedMs: Number(verifyElapsedMs.toFixed(2)), redactElapsedMs: Number(redactElapsedMs.toFixed(2)), verifyMaxRssGrowthMiB: Number(verifyMaxRssGrowthMiB.toFixed(2)), redactMaxRssGrowthMiB: Number(redactMaxRssGrowthMiB.toFixed(2)), maxRssGrowthMiB: Number(maxRssGrowthMiB.toFixed(2)), queryPlan })}\n`
    );
    if (server) await server.close();
    configureAuditAnchor({});
    rmSync(profileDir, { recursive: true, force: true });
  });

  it('uses the chain-hash index and verifies in bounded yielding pages', async () => {
    const sqlite = liveClient();
    const head = sqlite
      .prepare('SELECT head_hash AS headHash FROM audit_chain_heads WHERE tenant_id = ?')
      .get(tenantId) as { headHash: string };
    queryPlan = (
      sqlite
        .prepare(
          `EXPLAIN QUERY PLAN
           SELECT id, prev_hash
           FROM audit_logs INDEXED BY idx_audit_logs_chain_hash
           WHERE chain_hash = ? AND tenant_id = ?`
        )
        .all(head.headHash, tenantId) as Array<{ detail: string }>
    ).map(row => row.detail);
    expect(queryPlan.join('\n')).toContain('idx_audit_logs_chain_hash');

    let timerYielded = false;
    const timer = setTimeout(() => {
      timerYielded = true;
    }, 0);
    const startedAt = performance.now();
    const verification = await verifyAuditChain(getDatabase(), tenantId);
    verifyElapsedMs = performance.now() - startedAt;
    clearTimeout(timer);
    verifyMaxRssGrowthMiB = maxRssMiB() - rssBaselineMiB;
    maxRssGrowthMiB = Math.max(maxRssGrowthMiB, verifyMaxRssGrowthMiB);

    expect(verification).toMatchObject({ valid: true, checkedCount: budget.rows });
    expect(timerYielded).toBe(true);
    expect(verifyElapsedMs).toBeLessThanOrEqual(
      budget.verifyElapsedMs * (1 + budget.thresholdPercent / 100)
    );
  }, 120_000);

  it('redacts and rehashes 100k rows within the transaction budget', async () => {
    const startedAt = performance.now();
    const redacted = getDatabase().transaction(tx =>
      redactAuditLogPayloads({
        tx,
        tenantId,
        ids: ['audit-profile-000000'],
        redactedAt: '2026-08-28T01:00:00.000Z',
      })
    );
    redactElapsedMs = performance.now() - startedAt;
    redactMaxRssGrowthMiB = maxRssMiB() - rssBaselineMiB;
    maxRssGrowthMiB = Math.max(maxRssGrowthMiB, redactMaxRssGrowthMiB);

    expect(redacted).toBe(1);
    expect(redactElapsedMs).toBeLessThanOrEqual(
      budget.redactElapsedMs * (1 + budget.thresholdPercent / 100)
    );
    expect((await verifyAuditChain(getDatabase(), tenantId)).valid).toBe(true);
    expect(maxRssGrowthMiB).toBeLessThanOrEqual(budget.maxRssGrowthMiB);
  }, 120_000);
});
