import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  operationalAlertDeliveries,
  operationalAlertDeliveryAttempts,
  operationalAlerts,
  paymentOutbox,
  tenants,
  users,
  webhookSubscriptions,
} from '../db/schema.js';
import { sealWebhookSecret, signWebhookPayload } from '../services/events/secret-box.js';
import { createOperationalAlertWorker } from '../services/operations/alert-worker.js';
import {
  pruneOperationalAlertEvidence,
  reconcileOperationalAlerts,
} from '../services/operations/alerts.js';
import type { Context } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';

let server: PuntovivoServer;

beforeAll(async () => {
  server = await createServer({
    dbPath: ':memory:',
    seedData: false,
    verbose: false,
    webhookSecretKey: 'operational-alert-test-key',
  });
});

afterAll(async () => {
  await server.close();
});

function context(
  tenantId: string,
  userId: string,
  role: 'admin' | 'manager' | 'cashier' = 'admin'
): Context {
  return {
    req: {
      server: server.app,
      headers: {},
      user: { userId, email: `${userId}@example.test`, role, tenantId },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db: getDatabase(),
    user: { id: userId, email: `${userId}@example.test`, role, tenantId },
    tenantId,
    siteId: null,
  };
}

async function seedTenant(label: string) {
  const db = getDatabase();
  const suffix = nanoid(8);
  const tenantId = `alert-${label}-${suffix}`;
  const adminId = `admin-${suffix}`;
  const managerId = `manager-${suffix}`;
  const now = new Date().toISOString();
  await db.insert(tenants).values({
    id: tenantId,
    name: `Alert ${label}`,
    slug: tenantId,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(users).values([
    {
      id: adminId,
      tenantId,
      email: `${adminId}@example.test`,
      name: 'Admin',
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
      email: `${managerId}@example.test`,
      name: 'Manager',
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'manager',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  return { tenantId, adminId, managerId, now };
}

async function seedPaymentIncident(tenantId: string, createdAt: string) {
  await getDatabase()
    .insert(paymentOutbox)
    .values({
      id: nanoid(),
      tenantId,
      salePaymentId: null,
      railId: 'wompi',
      kind: 'charge',
      status: 'declined',
      amount: 25_000,
      currencyCode: 'COP',
      reference: `ALERT-${nanoid(6)}`,
      providerTransactionId: null,
      payload: { fixture: true },
      payloadVersion: 1,
      attempts: 1,
      priority: 0,
      createdAt,
      updatedAt: createdAt,
    });
}

async function seedAlertSubscription(tenantId: string, userId: string, createdAt: string) {
  const id = `subscription-${nanoid(8)}`;
  const secret = `secret-${nanoid(12)}`;
  await getDatabase()
    .insert(webhookSubscriptions)
    .values({
      id,
      tenantId,
      name: 'External incident receiver',
      destinationUrl: 'https://alerts.example.test/puntovivo',
      eventTypes: [
        'operational_alert.opened',
        'operational_alert.escalated',
        'operational_alert.acknowledged',
        'operational_alert.resolved',
      ],
      sealedSecret: sealWebhookSecret(secret),
      enabled: true,
      createdByUserId: userId,
      createdAt,
      updatedAt: createdAt,
    });
  return { id, secret };
}

describe('operational alerts', () => {
  it('persists the incident without pretending external delivery is configured', async () => {
    const { tenantId, adminId, now } = await seedTenant('unconfigured');
    await seedPaymentIncident(tenantId, now);

    await expect(reconcileOperationalAlerts(getDatabase(), tenantId)).resolves.toEqual({
      opened: 1,
      escalated: 0,
      resolved: 0,
    });
    await expect(reconcileOperationalAlerts(getDatabase(), tenantId)).resolves.toEqual({
      opened: 0,
      escalated: 0,
      resolved: 0,
    });

    const overview = await appRouter
      .createCaller(context(tenantId, adminId))
      .operations.alertsOverview();
    expect(overview.provisioned).toBe(false);
    expect(overview.alerts).toEqual([
      expect.objectContaining({ area: 'payments', status: 'open', severity: 'danger' }),
    ]);
    expect(overview.deliveries).toEqual([]);
  });

  it('delivers a minimal signed payload and retains immutable attempt evidence', async () => {
    const { tenantId, adminId, now } = await seedTenant('delivery');
    const subscription = await seedAlertSubscription(tenantId, adminId, now);
    await seedPaymentIncident(tenantId, now);
    await reconcileOperationalAlerts(getDatabase(), tenantId);

    const transport = vi.fn(async (request: { headers: Record<string, string>; body: string }) => {
      const body = JSON.parse(request.body) as { data: Record<string, unknown>; type: string };
      expect(body.type).toBe('operational_alert.opened');
      expect(Object.keys(body.data).sort()).toEqual([
        'alertId',
        'area',
        'count',
        'occurredAt',
        'recoveryPath',
        'severity',
        'status',
      ]);
      expect(body.data).toMatchObject({
        area: 'payments',
        recoveryPath: '/operations?tab=payments',
      });
      expect(request.headers['x-puntovivo-signature']).toBe(
        signWebhookPayload(
          subscription.secret,
          request.headers['x-puntovivo-timestamp']!,
          request.body
        )
      );
      return { status: 204 };
    });
    const worker = createOperationalAlertWorker({
      db: getDatabase(),
      transport,
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    await expect(worker.tickOnce(tenantId)).resolves.toMatchObject({ outcome: 'completed' });
    expect(transport).toHaveBeenCalledTimes(1);
    const delivery = await getDatabase()
      .select()
      .from(operationalAlertDeliveries)
      .where(eq(operationalAlertDeliveries.tenantId, tenantId))
      .get();
    expect(delivery).toMatchObject({ status: 'delivered', attempts: 1, responseStatus: 204 });
    const attempts = await getDatabase()
      .select()
      .from(operationalAlertDeliveryAttempts)
      .where(eq(operationalAlertDeliveryAttempts.tenantId, tenantId))
      .all();
    expect(attempts).toEqual([
      expect.objectContaining({ attemptNumber: 1, outcome: 'delivered', responseStatus: 204 }),
    ]);
  });

  it('closes interrupted attempt evidence before retrying a stale claim', async () => {
    const { tenantId, adminId, now } = await seedTenant('stale-claim');
    await seedAlertSubscription(tenantId, adminId, now);
    await seedPaymentIncident(tenantId, now);
    await reconcileOperationalAlerts(getDatabase(), tenantId);
    const delivery = await getDatabase()
      .select()
      .from(operationalAlertDeliveries)
      .where(eq(operationalAlertDeliveries.tenantId, tenantId))
      .get();
    if (!delivery) throw new Error('Expected stale delivery fixture');
    await getDatabase()
      .update(operationalAlertDeliveries)
      .set({
        status: 'submitting',
        claimToken: 'stale-worker',
        lockedAt: '2026-01-01T00:00:00.000Z',
      })
      .where(eq(operationalAlertDeliveries.id, delivery.id));
    await getDatabase()
      .insert(operationalAlertDeliveryAttempts)
      .values({
        id: `attempt-${nanoid(8)}`,
        tenantId,
        deliveryId: delivery.id,
        attemptNumber: 1,
        outcome: 'attempting',
        startedAt: '2026-01-01T00:00:00.000Z',
      });
    const worker = createOperationalAlertWorker({
      db: getDatabase(),
      now: () => new Date('2026-01-02T00:00:00.000Z'),
      transport: async () => ({ status: 204 }),
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    await expect(worker.tickOnce(tenantId)).resolves.toMatchObject({ outcome: 'completed' });
    const attempts = await getDatabase()
      .select()
      .from(operationalAlertDeliveryAttempts)
      .where(eq(operationalAlertDeliveryAttempts.deliveryId, delivery.id))
      .all();
    expect(attempts).toEqual([
      expect.objectContaining({
        attemptNumber: 1,
        outcome: 'retrying',
        errorCode: 'OPERATIONAL_ALERT_WORKER_INTERRUPTED',
        completedAt: '2026-01-02T00:00:00.000Z',
      }),
      expect.objectContaining({ attemptNumber: 2, outcome: 'delivered' }),
    ]);
  });

  it('keeps the underlying incident visible after a manager acknowledges it', async () => {
    const { tenantId, adminId, managerId, now } = await seedTenant('ack');
    await seedAlertSubscription(tenantId, adminId, now);
    await seedPaymentIncident(tenantId, now);
    await reconcileOperationalAlerts(getDatabase(), tenantId);
    const alert = await getDatabase()
      .select()
      .from(operationalAlerts)
      .where(eq(operationalAlerts.tenantId, tenantId))
      .get();
    if (!alert) throw new Error('Expected operational alert');

    const caller = appRouter.createCaller(context(tenantId, managerId, 'manager'));
    await expect(caller.operations.acknowledgeAlert({ alertId: alert.id })).resolves.toMatchObject({
      status: 'acknowledged',
      deduped: false,
    });
    await expect(caller.operations.acknowledgeAlert({ alertId: alert.id })).resolves.toMatchObject({
      deduped: true,
    });
    const attention = await caller.operations.needsAttention();
    expect(attention.areas).toContainEqual({ area: 'payments', severity: 'danger', count: 1 });
    const audit = await getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, 'operational_alert.acknowledged')
        )
      )
      .all();
    expect(audit).toHaveLength(1);
  });

  it('emits a fresh acknowledgement after an active incident escalates', async () => {
    const { tenantId, adminId, managerId, now } = await seedTenant('reacknowledge');
    await seedAlertSubscription(tenantId, adminId, now);
    const alertId = `alert-${nanoid(8)}`;
    await getDatabase().insert(operationalAlerts).values({
      id: alertId,
      tenantId,
      area: 'payments',
      severity: 'warning',
      status: 'open',
      sequence: 1,
      count: 1,
      firstObservedAt: now,
      lastObservedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    const caller = appRouter.createCaller(context(tenantId, managerId, 'manager'));

    await caller.operations.acknowledgeAlert({ alertId });
    await seedPaymentIncident(tenantId, now);
    await expect(reconcileOperationalAlerts(getDatabase(), tenantId)).resolves.toMatchObject({
      escalated: 1,
    });
    await caller.operations.acknowledgeAlert({ alertId });

    const acknowledgements = await getDatabase()
      .select({
        transition: operationalAlertDeliveries.transition,
        alertSequence: operationalAlertDeliveries.alertSequence,
      })
      .from(operationalAlertDeliveries)
      .where(
        and(
          eq(operationalAlertDeliveries.tenantId, tenantId),
          eq(operationalAlertDeliveries.transition, 'acknowledged')
        )
      )
      .all();
    expect(acknowledgements).toEqual([
      { transition: 'acknowledged', alertSequence: 2 },
      { transition: 'acknowledged', alertSequence: 4 },
    ]);
  });

  it('dead-letters a permanent provider rejection and allows an audited admin retry', async () => {
    const { tenantId, adminId, now } = await seedTenant('dead-letter');
    await seedAlertSubscription(tenantId, adminId, now);
    await seedPaymentIncident(tenantId, now);
    await reconcileOperationalAlerts(getDatabase(), tenantId);
    const worker = createOperationalAlertWorker({
      db: getDatabase(),
      transport: async () => ({ status: 400 }),
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    });
    await expect(worker.tickOnce(tenantId)).resolves.toMatchObject({ outcome: 'dead_letter' });
    const delivery = await getDatabase()
      .select()
      .from(operationalAlertDeliveries)
      .where(eq(operationalAlertDeliveries.tenantId, tenantId))
      .get();
    if (!delivery) throw new Error('Expected operational alert delivery');
    const caller = appRouter.createCaller(context(tenantId, adminId));
    await expect(
      caller.operations.retryAlertDelivery({ deliveryId: delivery.id })
    ).resolves.toEqual({ id: delivery.id, status: 'queued' });
    await expect(caller.operations.retryAlertDelivery({ deliveryId: delivery.id })).rejects.toThrow(
      'OPERATIONAL_ALERT_DELIVERY_NOT_DEAD_LETTER'
    );
    const retried = await getDatabase()
      .select()
      .from(operationalAlertDeliveries)
      .where(eq(operationalAlertDeliveries.id, delivery.id))
      .get();
    expect(retried).toMatchObject({ status: 'queued', attempts: 0, lastError: null });
    const retryAudits = await getDatabase()
      .select()
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, tenantId),
          eq(auditLogs.action, 'operational_alert.delivery.retry')
        )
      )
      .all();
    expect(retryAudits).toHaveLength(1);
  });

  it('does not expose or mutate alerts across tenants', async () => {
    const owner = await seedTenant('owner');
    const outsider = await seedTenant('outsider');
    await seedPaymentIncident(owner.tenantId, owner.now);
    await reconcileOperationalAlerts(getDatabase(), owner.tenantId);
    const alert = await getDatabase()
      .select()
      .from(operationalAlerts)
      .where(eq(operationalAlerts.tenantId, owner.tenantId))
      .get();
    if (!alert) throw new Error('Expected owner alert');

    const outsiderCaller = appRouter.createCaller(context(outsider.tenantId, outsider.adminId));
    await expect(outsiderCaller.operations.acknowledgeAlert({ alertId: alert.id })).rejects.toThrow(
      'OPERATIONAL_ALERT_NOT_FOUND'
    );
    const overview = await outsiderCaller.operations.alertsOverview();
    expect(overview.alerts).toEqual([]);
    expect(overview.deliveries).toEqual([]);
  });

  it('keeps recent delivery evidence before pruning old resolved incidents', async () => {
    const { tenantId, adminId, now } = await seedTenant('retention');
    await seedAlertSubscription(tenantId, adminId, now);
    await seedPaymentIncident(tenantId, now);
    await reconcileOperationalAlerts(getDatabase(), tenantId);
    const worker = createOperationalAlertWorker({
      db: getDatabase(),
      transport: async () => ({ status: 204 }),
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    });
    await worker.tickOnce(tenantId);
    const alert = await getDatabase()
      .select()
      .from(operationalAlerts)
      .where(eq(operationalAlerts.tenantId, tenantId))
      .get();
    const attempt = await getDatabase()
      .select()
      .from(operationalAlertDeliveryAttempts)
      .where(eq(operationalAlertDeliveryAttempts.tenantId, tenantId))
      .get();
    if (!alert || !attempt) throw new Error('Expected alert retention fixtures');
    await getDatabase()
      .update(operationalAlerts)
      .set({ status: 'resolved', resolvedAt: '2025-01-01T00:00:00.000Z' })
      .where(eq(operationalAlerts.id, alert.id));
    await getDatabase()
      .update(operationalAlertDeliveryAttempts)
      .set({ startedAt: '2026-12-15T00:00:00.000Z' })
      .where(eq(operationalAlertDeliveryAttempts.id, attempt.id));

    expect(
      pruneOperationalAlertEvidence(getDatabase(), tenantId, new Date('2027-01-01T00:00:00.000Z'))
    ).toEqual({ attempts: 0, alerts: 0 });
    await getDatabase()
      .update(operationalAlertDeliveryAttempts)
      .set({ startedAt: '2026-01-01T00:00:00.000Z' })
      .where(eq(operationalAlertDeliveryAttempts.id, attempt.id));
    expect(
      pruneOperationalAlertEvidence(getDatabase(), tenantId, new Date('2027-01-01T00:00:00.000Z'))
    ).toEqual({ attempts: 1, alerts: 1 });
  });
});
