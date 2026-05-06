/**
 * ENG-067 — Chaos: provider outage recovery.
 *
 * The retail-store failure mode this guards against: the DIAN PT (or
 * any fiscal provider) returns 502 for several minutes. The current
 * fiscal worker tests cover ONE error per row (PROVIDER_5XX →
 * contingency, PROVIDER_REJECTED → rejected). They DO NOT cover
 * "fail N times, then succeed on attempt N+1", which is the actual
 * recovery pattern the worker exists to deliver.
 *
 * This file injects a stateful stub adapter that fails the first
 * `failuresBeforeSuccess` calls and then resolves cleanly. We tick
 * the worker once per attempt, clearing `next_retry_at` between
 * ticks so the kernel picks the row up immediately. The assertions
 * pin:
 *
 *   1. After 3 recoverable failures, `attempts=3` and the doc is in
 *      `contingency`. Tick #4 succeeds — `attempts=3`,
 *      `status='accepted'`, doc.status='accepted'.
 *   2. Non-recoverable error sends the row straight to the
 *      dead_letter line and a subsequent tick is a no-op.
 *   3. With no outbox rows in scope, `tickOnce` returns
 *      `processed: false` immediately — the worker doesn't burn
 *      cycles.
 *
 * @module __tests__/chaos-provider-outage-recovery
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  companies,
  fiscalDocuments,
  fiscalNumberingResolutions,
  fiscalOutbox,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import {
  __clearFiscalAdapterOverridesForTest,
  __setFiscalAdapterForTest,
} from '../services/fiscal/registry.js';
import { FiscalProviderError } from '../services/fiscal/errors.js';
import type {
  FiscalAdapter,
  FiscalAdapterCapabilities,
  FiscalAdapterConfig,
  FiscalAdapterIssueInput,
  FiscalAdapterIssueResult,
  FiscalAdapterValidationResult,
  FiscalAdapterVoidInput,
} from '../services/fiscal/adapter.js';

let server: PuntovivoServer;
let tenantId: string;

/**
 * Stateful stub: tracks call count + decides per attempt whether to
 * succeed or fail. Mirrors the existing test StubAdapter shape so
 * the chaos test reads naturally next to the integration tests.
 */
class StatefulStubAdapter implements FiscalAdapter {
  readonly providerId = 'mock-co';
  readonly countryCode = 'CO';
  readonly capabilities: FiscalAdapterCapabilities = {
    supportsVoid: true,
    supportsDebitNote: true,
    supportsFetchStatus: true,
  };

  callCount = 0;

  constructor(
    private readonly behavior:
      | { kind: 'fail-then-succeed'; failuresBeforeSuccess: number; errorKind: 'PROVIDER_5XX' }
      | { kind: 'always-non-recoverable'; errorKind: 'PROVIDER_REJECTED' }
  ) {}

  async validateConfig(_input: FiscalAdapterConfig): Promise<FiscalAdapterValidationResult> {
    return { ok: true, issues: [] };
  }

  async issue(_input: FiscalAdapterIssueInput): Promise<FiscalAdapterIssueResult> {
    this.callCount += 1;
    if (this.behavior.kind === 'always-non-recoverable') {
      throw new FiscalProviderError(this.behavior.errorKind, {
        message: `Stateful stub forced ${this.behavior.errorKind}`,
      });
    }
    if (this.callCount <= this.behavior.failuresBeforeSuccess) {
      throw new FiscalProviderError(this.behavior.errorKind, {
        message: `Stateful stub failure ${this.callCount}/${this.behavior.failuresBeforeSuccess}`,
      });
    }
    // Success — return a deterministic CUFE.
    return {
      cufe: `chaos-cufe-${this.callCount}-${nanoid(6)}`,
      status: 'accepted',
      providerId: this.providerId,
      providerResponse: { recoveredAfter: this.callCount - 1 },
      xmlRef: null,
    };
  }

  async voidDocument(_input: FiscalAdapterVoidInput): Promise<FiscalAdapterIssueResult> {
    return {
      cufe: `chaos-void-${nanoid(6)}`,
      status: 'accepted',
      providerId: this.providerId,
      providerResponse: null,
      xmlRef: null,
    };
  }

  async fetchStatus() {
    return 'accepted' as const;
  }
}

/**
 * Insert a fiscal_documents row + a fiscal_outbox row pointing at it.
 * Bypasses the full sale → orchestrator flow because the chaos
 * scenario only cares about the worker's retry-on-failure path.
 */
async function seedFiscalRow(args: { tenantId: string }): Promise<{ docId: string; outboxId: string }> {
  const db = getDatabase();
  const docId = `chaos-doc-${nanoid()}`;
  const outboxId = `chaos-outbox-${nanoid()}`;
  const now = new Date().toISOString();

  // Lazy-seed company + site + resolution (the FK chain
  // fiscal_documents requires). Each helper call creates a fresh
  // chain so tests don't share state.
  const companyId = `chaos-company-${nanoid()}`;
  const siteId = `chaos-site-${nanoid()}`;
  const resolutionId = `chaos-res-${nanoid()}`;
  await db.insert(companies).values({
    id: companyId,
    tenantId: args.tenantId,
    name: `Chaos Co ${companyId}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(sites).values({
    id: siteId,
    tenantId: args.tenantId,
    companyId,
    name: `Chaos Site ${siteId}`,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(fiscalNumberingResolutions).values({
    id: resolutionId,
    tenantId: args.tenantId,
    siteId,
    kind: 'DEE',
    resolutionNumber: '1',
    prefix: 'CHA',
    fromNumber: 1,
    toNumber: 1000,
    currentNumber: 0,
    technicalKey: 'chaos-tech-key',
    validFrom: now,
    validUntil: now,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  // emittedByUserId is a NOT NULL FK to users — seed a chaos admin
  // user adjacent to the tenant.
  const userId = `chaos-user-${nanoid()}`;
  await db.insert(users).values({
    id: userId,
    tenantId: args.tenantId,
    email: `chaos-${nanoid(6)}@chaos-prov.test`,
    name: 'Chaos Admin',
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(fiscalDocuments).values({
    id: docId,
    tenantId: args.tenantId,
    source: 'sale',
    sourceId: docId,
    kind: 'DEE',
    resolutionId,
    documentNumber: `CHA${nanoid(4)}`,
    consecutive: Math.floor(Math.random() * 1_000_000),
    cufe: `pending-${docId}`,
    status: 'pending',
    buyerName: 'fixture',
    buyerTaxIdTypeCode: '13',
    buyerTaxId: '0',
    subtotal: 0,
    taxAmount: 0,
    totalAmount: 0,
    currencyCode: 'COP',
    localeCode: 'es-CO',
    emittedByUserId: userId,
    emittedAt: now,
    providerId: 'mock-co',
    updatedAt: now,
  });
  await db.insert(fiscalOutbox).values({
    id: outboxId,
    tenantId: args.tenantId,
    status: 'queued',
    kind: 'emit',
    fiscalDocumentId: docId,
    providerId: 'mock-co',
    payload: {
      countryCode: 'CO',
      providerId: 'mock-co',
      fiscalDocumentId: docId,
      adapterInput: {
        // Minimal valid-ish shape; the stub doesn't read it.
        resolution: { documentNumber: 'CHA1', technicalKey: 'fixture' },
        issueDate: now,
        issueTime: '12:00:00',
        subtotal: 0,
        ivaAmount: 0,
        incAmount: 0,
        icaAmount: 0,
        totalAmount: 0,
        issuerNit: '900000000',
        buyer: { taxIdTypeCode: '13', taxId: '0' },
      },
    },
    payloadVersion: 1,
    attempts: 0,
    nextRetryAt: null,
    priority: 0,
    createdAt: now,
    updatedAt: now,
  });
  return { docId, outboxId };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  tenantId = `chaos-prov-tenant-${nanoid()}`;
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: tenantId,
    name: 'Chaos Provider Tenant',
    slug: tenantId,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
});

afterEach(() => {
  __clearFiscalAdapterOverridesForTest();
});

afterAll(async () => {
  await server.close();
});

describe('chaos: provider outage recovery (ENG-067)', () => {
  it('drains a row that fails 3 times then succeeds — final state accepted', async () => {
    if (!server.fiscalWorker) throw new Error('fiscal worker missing on server');
    const stub = new StatefulStubAdapter({
      kind: 'fail-then-succeed',
      failuresBeforeSuccess: 3,
      errorKind: 'PROVIDER_5XX',
    });
    __setFiscalAdapterForTest('CO', stub);
    const { docId, outboxId } = await seedFiscalRow({ tenantId });

    const db = getDatabase();
    // Tick four times. Between each tick we manually clear nextRetryAt
    // so the kernel's next claim picks the row up without waiting on
    // the bounded exponential backoff.
    for (let i = 0; i < 4; i++) {
      const result = await server.fiscalWorker.tickOnce(tenantId);
      expect(result.processed).toBe(true);
      // Clear backoff between attempts.
      await db
        .update(fiscalOutbox)
        .set({ nextRetryAt: null })
        .where(eq(fiscalOutbox.id, outboxId));
    }

    // Adapter saw 4 attempts (3 failures + 1 success).
    expect(stub.callCount).toBe(4);

    const finalOutbox = await db
      .select({
        status: fiscalOutbox.status,
        attempts: fiscalOutbox.attempts,
        cufe: fiscalOutbox.cufe,
      })
      .from(fiscalOutbox)
      .where(eq(fiscalOutbox.id, outboxId))
      .get();
    expect(finalOutbox?.status).toBe('accepted');
    // attempts increments on each failure; the success on call 4 does
    // NOT increment, so attempts stays at 3.
    expect(finalOutbox?.attempts).toBe(3);
    expect(finalOutbox?.cufe).toMatch(/^chaos-cufe-4-/);

    const finalDoc = await db
      .select({ status: fiscalDocuments.status, cufe: fiscalDocuments.cufe })
      .from(fiscalDocuments)
      .where(eq(fiscalDocuments.id, docId))
      .get();
    expect(finalDoc?.status).toBe('accepted');
    expect(finalDoc?.cufe).toMatch(/^chaos-cufe-4-/);
  });

  it('non-recoverable error goes straight to dead-letter and stays there', async () => {
    if (!server.fiscalWorker) throw new Error('fiscal worker missing on server');
    const stub = new StatefulStubAdapter({
      kind: 'always-non-recoverable',
      errorKind: 'PROVIDER_REJECTED',
    });
    __setFiscalAdapterForTest('CO', stub);
    const { docId, outboxId } = await seedFiscalRow({ tenantId });

    const db = getDatabase();
    const first = await server.fiscalWorker.tickOnce(tenantId);
    expect(first.processed).toBe(true);
    expect(first.outcome).toBe('dead_letter');

    // A second tick is a no-op — dead_letter is terminal.
    const second = await server.fiscalWorker.tickOnce(tenantId);
    expect(second.processed).toBe(false);
    // Adapter only saw 1 call — the second tick never re-claimed it.
    expect(stub.callCount).toBe(1);

    const finalOutbox = await db
      .select({ status: fiscalOutbox.status })
      .from(fiscalOutbox)
      .where(eq(fiscalOutbox.id, outboxId))
      .get();
    expect(finalOutbox?.status).toBe('dead_letter');

    const finalDoc = await db
      .select({ status: fiscalDocuments.status })
      .from(fiscalDocuments)
      .where(eq(fiscalDocuments.id, docId))
      .get();
    expect(finalDoc?.status).toBe('rejected');
  });

  it('tick on an empty outbox returns processed: false without claiming', async () => {
    if (!server.fiscalWorker) throw new Error('fiscal worker missing on server');
    // No seed in this case — we use a fresh tenant so the queue is
    // strictly empty in this scope.
    const db = getDatabase();
    const emptyTenantId = `chaos-prov-empty-${nanoid()}`;
    const now = new Date().toISOString();
    await db.insert(tenants).values({
      id: emptyTenantId,
      name: 'Chaos Provider Empty Tenant',
      slug: emptyTenantId,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const result = await server.fiscalWorker.tickOnce(emptyTenantId);
    expect(result.processed).toBe(false);
    // No row id surfaced when nothing was processed.
    expect(result.rowId).toBeUndefined();
  });
});
