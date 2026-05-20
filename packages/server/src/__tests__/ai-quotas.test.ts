/**
 * ENG-102 — AI per-site monthly quota enforcement.
 *
 * Pins the contract from `services/ai/quotas.ts`:
 *
 *   - Under quota → `requireAiQuotaAvailable` returns the projection
 *     without throwing.
 *   - At quota → throws `AI_QUOTA_EXCEEDED` with details
 *     `{feature, used, limit, resetsAt}`.
 *   - Errored audit rows do NOT consume quota — the counter only
 *     reflects successful provider calls.
 *   - Quotas are per (tenant, site). Filling Site A does not bleed
 *     into Site B; Tenant T1's bucket is isolated from Tenant T2.
 *   - Calendar boundary: rows from the previous month don't count
 *     toward this month's bucket.
 *
 * @module __tests__/ai-quotas.test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { aiAuditLog, companies, sites, tenants, users } from '../db/schema.js';
import type { NewSite } from '../db/schema.js';
import {
  AI_QUOTAS,
  countMonthlyAiCalls,
  projectEmptyAiQuotas,
  requireAiQuotaAvailable,
  type QuotaFeature,
} from '../services/ai/quotas.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';

let server: PuntovivoServer;
let tenantId: string;
let siteAId: string;
let siteBId: string;
let secondTenantId: string;
let secondTenantSiteId: string;

const NOW = new Date('2026-05-15T12:00:00Z');

async function seedAuditRow(args: {
  tenantId: string;
  siteId: string;
  feature: QuotaFeature;
  errorCode?: string | null;
  createdAt?: string;
}) {
  const db = getDatabase();
  await db.insert(aiAuditLog).values({
    id: nanoid(),
    tenantId: args.tenantId,
    siteId: args.siteId,
    userId: null,
    feature: args.feature,
    providerId: 'anthropic',
    modelId: 'claude-haiku-4-5-20251001',
    inputTokens: 100,
    outputTokens: 50,
    costUsd: 0.001,
    durationMs: 200,
    errorCode: args.errorCode ?? null,
    createdAt: args.createdAt ?? NOW.toISOString(),
  });
}

async function seedAuditRows(args: {
  tenantId: string;
  siteId: string;
  feature: QuotaFeature;
  count: number;
  errorCode?: string | null;
  createdAt?: string;
}) {
  for (let i = 0; i < args.count; i++) {
    await seedAuditRow({
      tenantId: args.tenantId,
      siteId: args.siteId,
      feature: args.feature,
      errorCode: args.errorCode ?? null,
      createdAt: args.createdAt,
    });
  }
}

async function clearAuditRows() {
  const db = getDatabase();
  await db.delete(aiAuditLog);
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();

  const admin = await db
    .select()
    .from(users)
    .where(eq(users.email, 'admin@localhost'))
    .get();
  if (!admin) throw new Error('Expected seeded admin');
  tenantId = admin.tenantId;

  // Seed two sites for the active tenant so cross-site isolation
  // tests have real FK targets. The dev seed ships one site per
  // tenant; we add a second one programmatically to keep the test
  // standalone (no dependency on a future seed change).
  const allSites = await db
    .select()
    .from(sites)
    .where(eq(sites.tenantId, tenantId))
    .all();
  if (allSites.length === 0) {
    throw new Error('Expected at least one seeded site for the active tenant');
  }
  siteAId = allSites[0]!.id;
  if (allSites.length >= 2) {
    siteBId = allSites[1]!.id;
  } else {
    const newSite: NewSite = {
      id: nanoid(),
      tenantId,
      companyId: allSites[0]!.companyId,
      name: 'AI Quota Test Site B',
      isActive: true,
    };
    await db.insert(sites).values(newSite);
    siteBId = newSite.id;
  }

  // Cross-tenant isolation needs a real foreign (tenant, site) pair.
  // The in-memory test rig seeds only one tenant, so we seed a
  // second tenant + company + site programmatically. The FK chain
  // tenants → companies → sites needs all three; ai_audit_log
  // references both tenant and site.
  const foreignTenantId = nanoid();
  const foreignCompanyId = nanoid();
  const foreignSiteId = nanoid();
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: foreignTenantId,
    name: 'AI Quota Foreign Tenant',
    slug: `ai-quota-foreign-${foreignTenantId.slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(companies).values({
    id: foreignCompanyId,
    tenantId: foreignTenantId,
    name: 'AI Quota Foreign Company',
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: foreignSiteId,
    tenantId: foreignTenantId,
    companyId: foreignCompanyId,
    name: 'AI Quota Foreign Site',
    isActive: true,
  });
  secondTenantId = foreignTenantId;
  secondTenantSiteId = foreignSiteId;
});

afterAll(async () => {
  await server.close();
});

beforeEach(async () => {
  await clearAuditRows();
});

describe('AI quotas (ENG-102)', () => {
  it('projects empty site-less quotas from the same constants', () => {
    const quotas = projectEmptyAiQuotas(NOW);
    expect(quotas.copilot).toEqual({
      feature: 'copilot',
      used: 0,
      limit: AI_QUOTAS.copilot,
      resetsAt: new Date(2026, 5, 1).toISOString(),
    });
    expect(quotas.invoiceOcr).toEqual({
      feature: 'invoiceOcr',
      used: 0,
      limit: AI_QUOTAS.invoiceOcr,
      resetsAt: new Date(2026, 5, 1).toISOString(),
    });
  });

  it('passes when under quota (799 / 800 copilot)', async () => {
    await seedAuditRows({
      tenantId,
      siteId: siteAId,
      feature: 'copilot',
      count: 799,
    });

    const projection = await requireAiQuotaAvailable({
      db: getDatabase(),
      tenantId,
      siteId: siteAId,
      feature: 'copilot',
      now: NOW,
    });
    expect(projection.used).toBe(799);
    expect(projection.limit).toBe(AI_QUOTAS.copilot);
    expect(projection.resetsAt).toBe(new Date(2026, 5, 1).toISOString());
  });

  it('throws AI_QUOTA_EXCEEDED at quota (800 / 800 copilot)', async () => {
    await seedAuditRows({
      tenantId,
      siteId: siteAId,
      feature: 'copilot',
      count: AI_QUOTAS.copilot,
    });

    let thrown: unknown = null;
    try {
      await requireAiQuotaAvailable({
        db: getDatabase(),
        tenantId,
        siteId: siteAId,
        feature: 'copilot',
        now: NOW,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();
    const cause = (thrown as { cause?: ServerErrorWithCode })?.cause ?? thrown;
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_QUOTA_EXCEEDED');
    expect((cause as ServerErrorWithCode).details).toMatchObject({
      feature: 'copilot',
      used: AI_QUOTAS.copilot,
      limit: AI_QUOTAS.copilot,
    });
  });

  it('throws at OCR quota boundary (200 / 200 invoiceOcr)', async () => {
    await seedAuditRows({
      tenantId,
      siteId: siteAId,
      feature: 'invoiceOcr',
      count: AI_QUOTAS.invoiceOcr,
    });

    let thrown: unknown = null;
    try {
      await requireAiQuotaAvailable({
        db: getDatabase(),
        tenantId,
        siteId: siteAId,
        feature: 'invoiceOcr',
        now: NOW,
      });
    } catch (err) {
      thrown = err;
    }
    const cause = (thrown as { cause?: ServerErrorWithCode })?.cause ?? thrown;
    expect((cause as ServerErrorWithCode).errorCode).toBe('AI_QUOTA_EXCEEDED');
    expect((cause as ServerErrorWithCode).details).toMatchObject({
      feature: 'invoiceOcr',
      used: AI_QUOTAS.invoiceOcr,
      limit: AI_QUOTAS.invoiceOcr,
    });
  });

  it('errored rows do NOT consume quota (200 errored + 199 ok → 200th still passes)', async () => {
    // Two hundred upstream provider errors stay invisible to the counter.
    await seedAuditRows({
      tenantId,
      siteId: siteAId,
      feature: 'invoiceOcr',
      count: 200,
      errorCode: 'AI_PROVIDER_ERROR',
    });
    // One hundred ninety-nine successful calls — under the 200 cap.
    await seedAuditRows({
      tenantId,
      siteId: siteAId,
      feature: 'invoiceOcr',
      count: 199,
    });

    const projection = await requireAiQuotaAvailable({
      db: getDatabase(),
      tenantId,
      siteId: siteAId,
      feature: 'invoiceOcr',
      now: NOW,
    });
    expect(projection.used).toBe(199);
  });

  it('isolates by site (Site A full, Site B still passes)', async () => {
    await seedAuditRows({
      tenantId,
      siteId: siteAId,
      feature: 'copilot',
      count: AI_QUOTAS.copilot,
    });
    // Site A is full — should throw.
    let aThrown: unknown = null;
    try {
      await requireAiQuotaAvailable({
        db: getDatabase(),
        tenantId,
        siteId: siteAId,
        feature: 'copilot',
        now: NOW,
      });
    } catch (err) {
      aThrown = err;
    }
    expect(aThrown).not.toBeNull();

    // Site B starts at zero — should pass.
    const bProjection = await requireAiQuotaAvailable({
      db: getDatabase(),
      tenantId,
      siteId: siteBId,
      feature: 'copilot',
      now: NOW,
    });
    expect(bProjection.used).toBe(0);
  });

  it('isolates by tenant (tenant T1 full, tenant T2 starts at zero)', async () => {
    await seedAuditRows({
      tenantId,
      siteId: siteAId,
      feature: 'copilot',
      count: AI_QUOTAS.copilot,
    });

    const otherProjection = await requireAiQuotaAvailable({
      db: getDatabase(),
      tenantId: secondTenantId,
      siteId: secondTenantSiteId,
      feature: 'copilot',
      now: NOW,
    });
    expect(otherProjection.used).toBe(0);
  });

  it('calendar boundary: previous-month rows do not count', async () => {
    // Insert AI_QUOTAS.copilot rows but dated April 30 — last day of
    // previous month. Counter for May (NOW) should be zero.
    await seedAuditRows({
      tenantId,
      siteId: siteAId,
      feature: 'copilot',
      count: AI_QUOTAS.copilot,
      createdAt: '2026-04-30T23:59:59.999Z',
    });

    const projection = await requireAiQuotaAvailable({
      db: getDatabase(),
      tenantId,
      siteId: siteAId,
      feature: 'copilot',
      now: NOW,
    });
    expect(projection.used).toBe(0);

    // Sanity: the counter helper returns the same number directly.
    const count = await countMonthlyAiCalls({
      db: getDatabase(),
      tenantId,
      siteId: siteAId,
      feature: 'copilot',
      now: NOW,
    });
    expect(count).toBe(0);
  });
});
