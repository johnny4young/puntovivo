/**
 * `reports.diagnostics.export` sanitization integration tests.
 *
 * Drives the export procedure through a tRPC caller against an
 * in-memory DB seeded with payloads that contain known-sensitive
 * keys. Asserts the bundle's manifest reports
 * `sanitized: true` + `redactedKeysByTable` and that the row payloads
 * actually carry `[REDACTED]` instead of the original secret.
 *
 * Cases:
 * 1. sync_outbox payload with `password` + `token` → both redacted,
 * benign business fields preserved, manifest reports the keys.
 * 2. fiscal_outbox payload with `clientSecret` + `certificate` →
 * both redacted, manifest reports them under fiscal_outbox.
 * 3. operation_events.summary with `apiKey` → redacted in summary
 * column, manifest reports `apiKey` under operation_events.
 * 4. Empty windows surface `redactedKeysByTable.<table> = []` —
 * sanitization stays opt-out-by-default-empty.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  devices,
  fiscalOutbox,
  operationEvents,
  syncOutbox,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { REDACTED_PLACEHOLDER } from '../services/diagnostics/sanitize.js';

let server: PuntovivoServer;

interface ExportHarness {
  tenantId: string;
  adminId: string;
  deviceId: string;
}

async function seedHarness(suffix: string): Promise<ExportHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `eng066-tenant-${suffix}`;
  const adminId = `eng066-admin-${suffix}`;
  const deviceId = `eng066-dev-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `ENG066 Tenant ${suffix}`,
    slug: `eng066-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values({
    id: adminId,
    tenantId,
    email: `admin-${suffix}@eng066.test`,
    name: `Admin ${suffix}`,
    passwordHash: 'x',
    sessionVersion: 1,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(devices).values({
    id: deviceId,
    tenantId,
    kind: 'web',
    name: `Device ${suffix}`,
    registeredByUserId: adminId,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  return { tenantId, adminId, deviceId };
}

function buildCtx(tenantId: string, userId: string): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: { userId, email: `${userId}@eng066.test`, role: 'admin' as const, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: {
      id: userId,
      email: `${userId}@eng066.test`,
      role: 'admin',
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

const RANGE = {
  fromDate: '2026-05-01T00:00:00.000Z',
  toDate: '2026-05-31T23:59:59.999Z',
};
const IN_RANGE_TS = '2026-05-15T12:00:00.000Z';

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
});

afterAll(async () => {
  await server.close();
});

describe('reports.diagnostics.export sanitization', () => {
  it('redacts sensitive keys in sync_outbox.payload + reports them in manifest', async () => {
    const h = await seedHarness('sync');
    const db = getDatabase();
    const rowId = nanoid();

    await db.insert(syncOutbox).values({
      id: rowId,
      tenantId: h.tenantId,
      status: 'queued',
      entityType: 'sales',
      entityId: 'sale-1',
      operation: 'create',
      conflictPolicy: 'manual',
      payload: {
        // Sensitive — must be redacted.
        password: 'hunter2',
        token: 'jwt-secret-xyz',
        // Benign business fields — must be preserved.
        saleId: 'sale-1',
        total: 19999,
        operation: 'create',
      },
      payloadVersion: 1,
      attempts: 0,
      priority: 0,
      createdAt: IN_RANGE_TS,
      updatedAt: IN_RANGE_TS,
    });

    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId));
    const result = await caller.reports.diagnostics.export(RANGE);

    // Manifest flags + per-source redaction list.
    expect(result.manifest.sanitized).toBe(true);
    expect(result.manifest.redactedKeysByTable.sync_outbox).toEqual(
      expect.arrayContaining(['password', 'token'])
    );
    // No false positives — operation_events table reports empty.
    expect(result.manifest.redactedKeysByTable.operation_events).toEqual([]);

    // The bundled row's payload carries [REDACTED] for the sensitive
    // keys but preserves saleId, total, operation.
    const row = result.tables.sync_outbox.find(r => r.id === rowId);
    expect(row).toBeDefined();
    const sanitized = row!.payload as Record<string, unknown>;
    expect(sanitized.password).toBe(REDACTED_PLACEHOLDER);
    expect(sanitized.token).toBe(REDACTED_PLACEHOLDER);
    expect(sanitized.saleId).toBe('sale-1');
    expect(sanitized.total).toBe(19999);
    expect(sanitized.operation).toBe('create');
  });

  it('redacts clientSecret + certificate in fiscal_outbox.payload', async () => {
    const h = await seedHarness('fiscal');
    const db = getDatabase();
    const rowId = nanoid();

    await db.insert(fiscalOutbox).values({
      id: rowId,
      tenantId: h.tenantId,
      status: 'queued',
      kind: 'emit',
      fiscalDocumentId: null,
      providerId: 'mock-co',
      payload: {
        clientSecret: 'oauth-leaked-secret',
        certificate: '/private/dian-cert.p12',
        // Benign:
        cufe: 'pending-abc',
        documentNumber: 'DEE-001',
      },
      payloadVersion: 1,
      attempts: 0,
      priority: 0,
      createdAt: IN_RANGE_TS,
      updatedAt: IN_RANGE_TS,
    });

    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId));
    const result = await caller.reports.diagnostics.export(RANGE);

    expect(result.manifest.redactedKeysByTable.fiscal_outbox).toEqual(
      expect.arrayContaining(['clientSecret', 'certificate'])
    );
    const row = result.tables.fiscal_outbox.find(r => r.id === rowId);
    expect(row).toBeDefined();
    const sanitized = row!.payload as Record<string, unknown>;
    expect(sanitized.clientSecret).toBe(REDACTED_PLACEHOLDER);
    expect(sanitized.certificate).toBe(REDACTED_PLACEHOLDER);
    expect(sanitized.cufe).toBe('pending-abc');
    expect(sanitized.documentNumber).toBe('DEE-001');
  });

  it('redacts apiKey in operation_events.summary', async () => {
    const h = await seedHarness('events');
    const db = getDatabase();
    const eventId = nanoid();

    await db.insert(operationEvents).values({
      id: eventId,
      tenantId: h.tenantId,
      operationId: `op-${eventId}`,
      operationKind: 'sale.complete',
      deviceId: h.deviceId,
      userId: h.adminId,
      status: 'succeeded',
      requestHash: `hash-${eventId}`,
      summary: {
        api_key: 'sk-leaked-by-mistake',
        saleId: 'sale-events-1',
      },
      startedAt: IN_RANGE_TS,
      completedAt: IN_RANGE_TS,
      createdAt: IN_RANGE_TS,
    });

    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId));
    const result = await caller.reports.diagnostics.export(RANGE);

    expect(result.manifest.redactedKeysByTable.operation_events).toEqual(
      expect.arrayContaining(['api_key'])
    );
    const row = result.tables.operation_events.find(r => r.id === eventId);
    expect(row).toBeDefined();
    const summary = row!.summary as Record<string, unknown>;
    expect(summary.api_key).toBe(REDACTED_PLACEHOLDER);
    expect(summary.saleId).toBe('sale-events-1');
  });

  it('reports empty redactedKeysByTable arrays when nothing sensitive is present', async () => {
    const h = await seedHarness('clean');
    const db = getDatabase();

    await db.insert(syncOutbox).values({
      id: nanoid(),
      tenantId: h.tenantId,
      status: 'queued',
      entityType: 'products',
      entityId: 'prod-1',
      operation: 'update',
      conflictPolicy: 'auto_lww',
      payload: { productId: 'prod-1', price: 100 },
      payloadVersion: 1,
      attempts: 0,
      priority: 0,
      createdAt: IN_RANGE_TS,
      updatedAt: IN_RANGE_TS,
    });

    const caller = appRouter.createCaller(buildCtx(h.tenantId, h.adminId));
    const result = await caller.reports.diagnostics.export(RANGE);

    // sanitized is always true — the flag does not depend on whether
    // anything was actually redacted.
    expect(result.manifest.sanitized).toBe(true);
    // Every per-source key list is empty when no sensitive keys land.
    expect(result.manifest.redactedKeysByTable.operation_events).toEqual([]);
    expect(result.manifest.redactedKeysByTable.operation_effects).toEqual([]);
    expect(result.manifest.redactedKeysByTable.sync_outbox).toEqual([]);
    expect(result.manifest.redactedKeysByTable.fiscal_outbox).toEqual([]);
    expect(result.manifest.redactedKeysByTable.hardware_outbox).toEqual([]);
  });
});
