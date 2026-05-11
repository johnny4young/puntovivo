/**
 * ENG-065c — `reports.diagnostics.*` integration tests.
 *
 * Verifies the admin-only bulk export that drives the Operations
 * Center Diagnostics tab. Coverage:
 *
 *   - Empty tenant → preview zero counts, export empty arrays + no warnings.
 *   - Manager / cashier FORBIDDEN; admin allowed for both procedures.
 *   - Date range narrows correctly — fixtures inside vs outside the window.
 *   - Cross-tenant isolation — tenant B fixtures never leak.
 *   - `includeOutboxes: ['sync']` populates only sync_outbox in `tables.*`,
 *     leaves the others as empty arrays, but `manifest.counts` still
 *     reports every source.
 *   - Row-limit warning surfaces when sync_outbox fixture exceeds 10000.
 *   - Invalid input (`fromDate > toDate`) surfaces a TRPCError BAD_REQUEST.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  devices,
  fiscalOutbox,
  hardwareOutbox,
  operationEffects,
  operationEvents,
  syncOutbox,
  tenants,
  users,
} from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { __TEST_ROW_LIMIT } from '../trpc/routers/reports/diagnostics.js';

let server: PuntovivoServer;

interface DiagHarness {
  tenantId: string;
  adminId: string;
  managerId: string;
  cashierId: string;
  deviceId: string;
}

async function seedHarness(suffix: string): Promise<DiagHarness> {
  const db = getDatabase();
  const now = new Date().toISOString();
  const tenantId = `rdiag-tenant-${suffix}`;
  const adminId = `rdiag-admin-${suffix}`;
  const managerId = `rdiag-mgr-${suffix}`;
  const cashierId = `rdiag-csh-${suffix}`;
  const deviceId = `rdiag-device-${suffix}`;

  await db.insert(tenants).values({
    id: tenantId,
    name: `Diag Tenant ${suffix}`,
    slug: `rdiag-${suffix}`,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `admin-${suffix}@example.com`,
      name: `Admin ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: managerId,
      tenantId,
      email: `manager-${suffix}@example.com`,
      name: `Manager ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierId,
      tenantId,
      email: `cashier-${suffix}@example.com`,
      name: `Cashier ${suffix}`,
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
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

  return { tenantId, adminId, managerId, cashierId, deviceId };
}

async function insertEvent(args: {
  tenantId: string;
  deviceId: string;
  userId: string;
  createdAt: string;
  status?: 'started' | 'succeeded' | 'failed' | 'partial';
  operationKind?: string;
}): Promise<string> {
  const db = getDatabase();
  const id = nanoid();
  await db.insert(operationEvents).values({
    id,
    tenantId: args.tenantId,
    operationId: `op-${id}`,
    operationKind: args.operationKind ?? 'sale.complete',
    deviceId: args.deviceId,
    userId: args.userId,
    status: args.status ?? 'succeeded',
    requestHash: `hash-${id}`,
    summary: { sample: true },
    startedAt: args.createdAt,
    completedAt: args.createdAt,
    createdAt: args.createdAt,
  });
  return id;
}

async function insertEffect(args: {
  eventId: string;
  createdAt: string;
}): Promise<void> {
  const db = getDatabase();
  await getDatabase()
    .insert(operationEffects)
    .values({
      id: nanoid(),
      operationEventId: args.eventId,
      kind: 'audit',
      resourceType: 'audit_logs',
      resourceId: `audit-${args.eventId}`,
      effectData: { sample: true },
      createdAt: args.createdAt,
    });
  void db;
}

async function insertSyncOutbox(args: {
  tenantId: string;
  createdAt: string;
}): Promise<void> {
  await getDatabase()
    .insert(syncOutbox)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      status: 'queued',
      entityType: 'sales',
      entityId: nanoid(),
      operation: 'create',
      conflictPolicy: 'manual',
      payload: { kind: 'fixture' },
      payloadVersion: 1,
      attempts: 0,
      priority: 0,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });
}

async function insertFiscalOutbox(args: {
  tenantId: string;
  createdAt: string;
}): Promise<void> {
  // fiscalDocumentId is nullable (set null on delete) — keeping it null
  // here avoids a fiscal_documents + fiscal_numbering_resolutions
  // fixture cascade that's irrelevant to the diagnostic export's read.
  await getDatabase()
    .insert(fiscalOutbox)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      status: 'queued',
      kind: 'emit',
      fiscalDocumentId: null,
      providerId: 'mock-co',
      payload: { kind: 'fixture' },
      payloadVersion: 1,
      attempts: 0,
      priority: 0,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });
}

async function insertHardwareOutbox(args: {
  tenantId: string;
  createdAt: string;
}): Promise<void> {
  await getDatabase()
    .insert(hardwareOutbox)
    .values({
      id: nanoid(),
      tenantId: args.tenantId,
      status: 'queued',
      kind: 'print-receipt',
      payload: { kind: 'fixture' },
      payloadVersion: 1,
      attempts: 0,
      priority: 0,
      createdAt: args.createdAt,
      updatedAt: args.createdAt,
    });
}

function buildCtx(
  tenantId: string,
  userId: string,
  role: 'admin' | 'manager' | 'cashier' | 'viewer'
): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: { userId, email: `${userId}@example.com`, role, tenantId },
    jwtVerify: async () => {},
  } as unknown as Context['req'];
  return {
    req: mockReq,
    res: {} as unknown as Context['res'],
    db,
    user: { id: userId, email: `${userId}@example.com`, role, tenantId },
    tenantId,
    siteId: null,
  };
}

const RANGE_FROM = '2026-05-01T00:00:00.000Z';
const RANGE_TO = '2026-05-31T23:59:59.999Z';
const IN_RANGE_TS = '2026-05-15T12:00:00.000Z';
const BEFORE_RANGE_TS = '2026-04-01T12:00:00.000Z';
const AFTER_RANGE_TS = '2026-06-15T12:00:00.000Z';

describe('reports.diagnostics (ENG-065c)', () => {
  let harnessA: DiagHarness;
  let harnessB: DiagHarness;

  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    harnessA = await seedHarness('a');
    harnessB = await seedHarness('b');

    // Tenant A — three events in range, one before, one after.
    const eventInRangeId1 = await insertEvent({
      tenantId: harnessA.tenantId,
      deviceId: harnessA.deviceId,
      userId: harnessA.adminId,
      createdAt: IN_RANGE_TS,
    });
    const eventInRangeId2 = await insertEvent({
      tenantId: harnessA.tenantId,
      deviceId: harnessA.deviceId,
      userId: harnessA.adminId,
      createdAt: IN_RANGE_TS,
    });
    const eventInRangeId3 = await insertEvent({
      tenantId: harnessA.tenantId,
      deviceId: harnessA.deviceId,
      userId: harnessA.adminId,
      createdAt: IN_RANGE_TS,
    });
    await insertEvent({
      tenantId: harnessA.tenantId,
      deviceId: harnessA.deviceId,
      userId: harnessA.adminId,
      createdAt: BEFORE_RANGE_TS,
    });
    await insertEvent({
      tenantId: harnessA.tenantId,
      deviceId: harnessA.deviceId,
      userId: harnessA.adminId,
      createdAt: AFTER_RANGE_TS,
    });

    // Two effects in range tied to the first two events.
    await insertEffect({ eventId: eventInRangeId1, createdAt: IN_RANGE_TS });
    await insertEffect({ eventId: eventInRangeId2, createdAt: IN_RANGE_TS });
    // One effect outside the range — must NOT count.
    await insertEffect({ eventId: eventInRangeId3, createdAt: AFTER_RANGE_TS });

    // 4 sync_outbox in range, 1 outside.
    for (let i = 0; i < 4; i++) {
      await insertSyncOutbox({ tenantId: harnessA.tenantId, createdAt: IN_RANGE_TS });
    }
    await insertSyncOutbox({ tenantId: harnessA.tenantId, createdAt: BEFORE_RANGE_TS });

    // 2 fiscal_outbox in range. fiscalDocumentId is nullable so the
    // fixture stays minimal — the diagnostic export reads the row
    // verbatim, the FK shape doesn't influence the assertion.
    await insertFiscalOutbox({ tenantId: harnessA.tenantId, createdAt: IN_RANGE_TS });
    await insertFiscalOutbox({ tenantId: harnessA.tenantId, createdAt: IN_RANGE_TS });

    // 1 hardware_outbox in range.
    await insertHardwareOutbox({ tenantId: harnessA.tenantId, createdAt: IN_RANGE_TS });

    // Tenant B fixture for cross-tenant isolation. If this leaked the
    // assertion numbers would fail.
    const eventBId = await insertEvent({
      tenantId: harnessB.tenantId,
      deviceId: harnessB.deviceId,
      userId: harnessB.adminId,
      createdAt: IN_RANGE_TS,
    });
    void eventBId;
    for (let i = 0; i < 99; i++) {
      await insertSyncOutbox({ tenantId: harnessB.tenantId, createdAt: IN_RANGE_TS });
    }
  });

  afterAll(async () => {
    await server.close();
  });

  it('preview returns zero counters for a tenant with no fixtures in range', async () => {
    const empty = await seedHarness('empty');
    const caller = appRouter.createCaller(buildCtx(empty.tenantId, empty.adminId, 'admin'));
    const result = await caller.reports.diagnostics.preview({
      fromDate: RANGE_FROM,
      toDate: RANGE_TO,
    });
    expect(result.counts.operation_events).toBe(0);
    expect(result.counts.operation_effects).toBe(0);
    expect(result.counts.sync_outbox).toBe(0);
    expect(result.counts.fiscal_outbox).toBe(0);
    expect(result.counts.hardware_outbox).toBe(0);
    expect(result.counts.payment_outbox).toBe(0);
    expect(result.counts.webhook_outbox).toBe(0);
    expect(result.willHitLimit).toBe(false);
    expect(result.estimatedSizeBytes).toBe(0);
    expect(result.rowLimit).toBe(__TEST_ROW_LIMIT);
    // ENG-072 — runtime metadata is surfaced on every preview so an
    // admin can confirm the boot mode without downloading the bundle.
    expect(result.runtime.authorityMode).toBe('device_local');
    expect(typeof result.runtime.bindHost).toBe('string');
    expect(typeof result.runtime.bindPort).toBe('number');
    expect(result.runtime.allowedLanOrigins).toEqual([]);
    expect(result.authorityTopology.runtime.authorityMode).toBe('device_local');
    expect(result.authorityTopology.devices.every(device => device.id !== harnessA.deviceId)).toBe(
      true
    );
  });

  it('preview narrows by date range and reports per-source counts', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await caller.reports.diagnostics.preview({
      fromDate: RANGE_FROM,
      toDate: RANGE_TO,
    });
    // 3 events in range (the BEFORE + AFTER fixtures are outside).
    expect(result.counts.operation_events).toBe(3);
    // 2 effects in range; the third effect is timestamped AFTER_RANGE_TS.
    expect(result.counts.operation_effects).toBe(2);
    expect(result.counts.sync_outbox).toBe(4);
    expect(result.counts.fiscal_outbox).toBe(2);
    expect(result.counts.hardware_outbox).toBe(1);
    expect(result.counts.payment_outbox).toBe(0);
    expect(result.counts.webhook_outbox).toBe(0);
    expect(result.willHitLimit).toBe(false);
  });

  it('rejects manager and cashier with FORBIDDEN; admin allowed', async () => {
    const adminCaller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const managerCaller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.managerId, 'manager')
    );
    const cashierCaller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.cashierId, 'cashier')
    );

    await expect(
      adminCaller.reports.diagnostics.preview({ fromDate: RANGE_FROM, toDate: RANGE_TO })
    ).resolves.toBeDefined();
    await expect(
      managerCaller.reports.diagnostics.preview({ fromDate: RANGE_FROM, toDate: RANGE_TO })
    ).rejects.toThrow(/TRPCError|administrators|admin/i);
    await expect(
      cashierCaller.reports.diagnostics.preview({ fromDate: RANGE_FROM, toDate: RANGE_TO })
    ).rejects.toThrow(/TRPCError|administrators|admin/i);

    await expect(
      adminCaller.reports.diagnostics.export({ fromDate: RANGE_FROM, toDate: RANGE_TO })
    ).resolves.toBeDefined();
    await expect(
      managerCaller.reports.diagnostics.export({ fromDate: RANGE_FROM, toDate: RANGE_TO })
    ).rejects.toThrow(/TRPCError|administrators|admin/i);
  });

  it('export returns full bundle with manifest counts and tables', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await caller.reports.diagnostics.export({
      fromDate: RANGE_FROM,
      toDate: RANGE_TO,
    });
    expect(result.manifest.schemaVersion).toBe(1);
    expect(result.manifest.tenantId).toBe(harnessA.tenantId);
    expect(result.manifest.range).toEqual({ fromDate: RANGE_FROM, toDate: RANGE_TO });
    expect(result.manifest.counts.operation_events).toBe(3);
    expect(result.manifest.counts.sync_outbox).toBe(4);
    expect(result.manifest.warnings).toEqual([]);
    expect(result.manifest.includedOutboxes).toEqual(['sync', 'fiscal', 'hardware']);
    expect(result.tables.operation_events).toHaveLength(3);
    expect(result.tables.operation_effects).toHaveLength(2);
    expect(result.tables.sync_outbox).toHaveLength(4);
    expect(result.tables.fiscal_outbox).toHaveLength(2);
    expect(result.tables.hardware_outbox).toHaveLength(1);
    // ENG-072 — runtime metadata is captured into the export manifest
    // so support tickets carry the boot identity of the box that
    // produced the bundle. The default test runtime is `device_local`
    // because none of the test harness boots set the env override.
    expect(result.manifest.runtime.authorityMode).toBe('device_local');
    expect(typeof result.manifest.runtime.bindHost).toBe('string');
    expect(typeof result.manifest.runtime.bindPort).toBe('number');
    expect(result.manifest.runtime.hubUrl).toBeNull();
    expect(result.manifest.authorityTopology.runtime.authorityMode).toBe('device_local');
    expect(result.manifest.authorityTopology.devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: harnessA.deviceId, authorityRole: 'web_client' }),
      ])
    );
  });

  it('respects includeOutboxes filter while keeping counts honest', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await caller.reports.diagnostics.export({
      fromDate: RANGE_FROM,
      toDate: RANGE_TO,
      includeOutboxes: ['sync'],
    });
    expect(result.tables.sync_outbox).toHaveLength(4);
    // fiscal and hardware come back as empty arrays even though their
    // counts are non-zero — the manifest reports the truth.
    expect(result.tables.fiscal_outbox).toEqual([]);
    expect(result.tables.hardware_outbox).toEqual([]);
    expect(result.manifest.counts.fiscal_outbox).toBe(2);
    expect(result.manifest.counts.hardware_outbox).toBe(1);
    expect(result.manifest.includedOutboxes).toEqual(['sync']);
  });

  it('allows exporting only journal tables when includeOutboxes is empty', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await caller.reports.diagnostics.export({
      fromDate: RANGE_FROM,
      toDate: RANGE_TO,
      includeOutboxes: [],
    });
    expect(result.tables.operation_events).toHaveLength(3);
    expect(result.tables.operation_effects).toHaveLength(2);
    expect(result.tables.sync_outbox).toEqual([]);
    expect(result.tables.fiscal_outbox).toEqual([]);
    expect(result.tables.hardware_outbox).toEqual([]);
    expect(result.manifest.includedOutboxes).toEqual([]);
  });

  it('isolates tenants — tenant A export never returns tenant B rows', async () => {
    const callerA = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    const result = await callerA.reports.diagnostics.export({
      fromDate: RANGE_FROM,
      toDate: RANGE_TO,
    });
    // Tenant B has 99 sync_outbox rows in range; if any leaked the
    // count would jump from 4 to 4+99.
    expect(result.tables.sync_outbox).toHaveLength(4);
    expect(result.manifest.counts.sync_outbox).toBe(4);
    expect(result.tables.sync_outbox.every(row => row.tenantId === harnessA.tenantId)).toBe(
      true
    );
  });

  it('rejects fromDate > toDate with BAD_REQUEST', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    await expect(
      caller.reports.diagnostics.preview({
        fromDate: RANGE_TO,
        toDate: RANGE_FROM,
      })
    ).rejects.toThrow(/fromDate must be on or before toDate|BAD_REQUEST/i);
  });

  it('accepts chronological ranges when the ISO offsets differ', async () => {
    const caller = appRouter.createCaller(
      buildCtx(harnessA.tenantId, harnessA.adminId, 'admin')
    );
    await expect(
      caller.reports.diagnostics.preview({
        fromDate: '2026-05-02T00:30:00+02:00',
        toDate: '2026-05-01T23:00:00Z',
      })
    ).resolves.toBeDefined();
  });
});
