/**
 * AI tie-break degradation paths.
 *
 * Exercises the four short-circuit gates without touching the provider
 * registry: AI disabled, monthly budget zero, monthly budget exhausted.
 * The non-decisive / SDK-throws paths are exercised indirectly by the
 * matcher tests via a deterministic stub `TiebreakFn`.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { aiAuditLog, tenants, users } from '../db/schema.js';
import { aiTiebreak } from '../services/payments/ai-tiebreak.js';
import type { TiebreakContext, TiebreakInput } from '../services/payments/ai-tiebreak.js';

const TENANT_ID = 'eng038c-aitb-tenant';
const ADMIN_ID = 'eng038c-aitb-admin';

let server: PuntovivoServer;

const sampleInput: TiebreakInput = {
  statementReference: 'WMP-AITB-001',
  statementAmount: 100_000,
  statementCurrency: 'COP',
  statementCreatedAt: '2026-05-01T08:00:00.000Z',
  candidates: [
    {
      salePaymentId: 'cand-1',
      reference: 'WMP-AITB-001',
      providerTransactionId: 'tx-1',
      amount: 100_000,
      currencyCode: 'COP',
      createdAt: '2026-05-01T08:00:00.000Z',
    },
    {
      salePaymentId: 'cand-2',
      reference: 'WMP-AITB-001b',
      providerTransactionId: 'tx-2',
      amount: 100_000,
      currencyCode: 'COP',
      createdAt: '2026-05-01T07:45:00.000Z',
    },
  ],
};

async function seedTenant(settings: Record<string, unknown>): Promise<void> {
  const db = getDatabase();
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: TENANT_ID,
    name: ' AI tie-break tenant',
    slug: 'eng038c-aitb',
    settings,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: ADMIN_ID,
    tenantId: TENANT_ID,
    email: 'admin@eng038c-aitb.test',
    name: 'AITB admin',
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
}

async function cleanupTenant(): Promise<void> {
  const db = getDatabase();
  await db.delete(aiAuditLog).where(eq(aiAuditLog.tenantId, TENANT_ID));
  await db.delete(users).where(eq(users.tenantId, TENANT_ID));
  await db.delete(tenants).where(eq(tenants.id, TENANT_ID));
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  return async () => {
    await server.close();
  };
});

afterEach(async () => {
  await cleanupTenant();
});

describe('aiTiebreak — gating short-circuits', () => {
  it('returns ai-disabled when tenant AI is off', async () => {
    await seedTenant({ ai: { enabled: false, monthlyBudgetUsd: 10, providerId: 'anthropic' } });
    const ctx: TiebreakContext = {
      db: getDatabase(),
      tenantId: TENANT_ID,
      siteId: null,
      userId: ADMIN_ID,
    };
    const result = await aiTiebreak(ctx, sampleInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('ai-disabled');
      expect(result.costUsd).toBe(0);
      expect(result.auditLogId).toBeNull();
    }
  });

  it('returns ai-budget-exceeded when monthlyBudgetUsd <= 0', async () => {
    await seedTenant({ ai: { enabled: true, monthlyBudgetUsd: 0, providerId: 'anthropic' } });
    const result = await aiTiebreak(
      { db: getDatabase(), tenantId: TENANT_ID, siteId: null, userId: ADMIN_ID },
      sampleInput
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('ai-budget-exceeded');
    }
  });

  it('returns ai-budget-exceeded when currentMonthSpend exceeds budget', async () => {
    await seedTenant({
      ai: { enabled: true, monthlyBudgetUsd: 1, providerId: 'anthropic' },
    });
    const db = getDatabase();
    // Pre-bill a recorded call past the budget so currentMonthSpend
    // returns > 1.
    await db.insert(aiAuditLog).values({
      id: 'pre-billed',
      tenantId: TENANT_ID,
      siteId: null,
      userId: ADMIN_ID,
      feature: 'paymentReconciliation',
      providerId: 'anthropic',
      modelId: 'claude-opus-4-7',
      inputTokens: 100,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 5,
      durationMs: 1000,
      errorCode: null,
      createdAt: new Date().toISOString(),
    });
    const result = await aiTiebreak(
      { db, tenantId: TENANT_ID, siteId: null, userId: ADMIN_ID },
      sampleInput
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('ai-budget-exceeded');
    }
  });

  it('does not throw when tenant settings are empty', async () => {
    await seedTenant({});
    const result = await aiTiebreak(
      { db: getDatabase(), tenantId: TENANT_ID, siteId: null, userId: ADMIN_ID },
      sampleInput
    );
    expect(result.ok).toBe(false);
    // Empty settings → DEFAULT_AI_SETTINGS → enabled: false → ai-disabled
    if (!result.ok) {
      expect(result.reason).toBe('ai-disabled');
    }
  });
});
