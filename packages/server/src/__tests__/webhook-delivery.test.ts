import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  tenants,
  users,
  webhookDeliveries,
  webhookOutbox,
  webhookSubscriptions,
} from '../db/schema.js';
import {
  assertPublicWebhookDestination,
  isPrivateAddress,
} from '../services/events/destination-policy.js';
import {
  createWebhookSigningSecret,
  openWebhookSecret,
  sealWebhookSecret,
  signWebhookPayload,
} from '../services/events/secret-box.js';
import { createWebhookWorker } from '../services/events/webhook-worker.js';

let server: PuntovivoServer;

beforeAll(async () => {
  server = await createServer({
    dbPath: ':memory:',
    seedData: false,
    webhookSecretKey: 'worker-test-key',
  });
});

afterAll(async () => {
  await server.close();
});

describe('webhook destination and secret policy', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '169.254.1.1',
    '192.168.2.3',
    '::1',
    '[::1]',
    '::c0a8:101',
    '::ffff:7f00:1',
    '64:ff9b::7f00:1',
    '2001::1',
    '2002:7f00:1::',
    'fd00::1',
    'fec0::1',
  ])('rejects private address %s', address => expect(isPrivateAddress(address)).toBe(true));

  it('rejects DNS rebinding to private space and non-HTTPS URLs', async () => {
    await expect(
      assertPublicWebhookDestination('https://hooks.example.test/path', async () => [
        { address: '127.0.0.1', family: 4 },
      ])
    ).rejects.toThrow('WEBHOOK_DESTINATION_PRIVATE');
    await expect(assertPublicWebhookDestination('http://93.184.216.34/path')).rejects.toThrow(
      'WEBHOOK_DESTINATION_HTTPS_REQUIRED'
    );
    await expect(assertPublicWebhookDestination('https://[::1]/path')).rejects.toThrow(
      'WEBHOOK_DESTINATION_PRIVATE'
    );
  });

  it('seals and opens secrets and signs deterministic payloads', () => {
    const secret = createWebhookSigningSecret();
    const sealed = sealWebhookSecret(secret);
    expect(sealed).not.toContain(secret);
    expect(openWebhookSecret(sealed)).toBe(secret);
    expect(signWebhookPayload('secret', '2026-08-01T00:00:00.000Z', '{}')).toMatch(
      /^v1=[a-f0-9]{64}$/
    );
  });
});

describe('webhook worker', () => {
  it('delivers once with signature and idempotency headers, then records observability', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const tenantId = 'webhook-worker-tenant';
    const userId = 'webhook-worker-admin';
    await db.insert(tenants).values({
      id: tenantId,
      name: 'Webhook Worker',
      slug: tenantId,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: userId,
      tenantId,
      email: 'admin@webhook-worker.test',
      name: 'Admin',
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const secret = 'test-signing-secret';
    await db.insert(webhookSubscriptions).values({
      id: 'subscription-1',
      tenantId,
      name: 'ERP',
      destinationUrl: 'https://hooks.example.test/puntovivo',
      eventTypes: ['sale.completed'],
      sealedSecret: sealWebhookSecret(secret),
      enabled: true,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(webhookOutbox).values({
      id: 'outbox-1',
      tenantId,
      eventType: 'sale.completed',
      eventVersion: 1,
      payload: { saleId: 'sale-1' },
      createdAt: now,
      updatedAt: now,
    });
    const transport = vi.fn(
      async (request: {
        headers: Record<string, string>;
        body: string;
        pinnedAddress: { address: string };
      }) => {
        expect(request.pinnedAddress.address).toBe('93.184.216.34');
        expect(request.headers['idempotency-key']).toBe('outbox-1:subscription-1');
        const timestamp = request.headers['x-puntovivo-timestamp']!;
        expect(request.headers['x-puntovivo-signature']).toBe(
          signWebhookPayload(secret, timestamp, request.body)
        );
        return { status: 204 };
      }
    );
    const worker = createWebhookWorker({
      db,
      transport,
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    });
    await expect(worker.tickOnce(tenantId)).resolves.toMatchObject({ outcome: 'completed' });
    expect(transport).toHaveBeenCalledTimes(1);
    const event = await db
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.id, 'outbox-1'))
      .get();
    expect(event?.status).toBe('delivered');
    const delivery = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.outboxId, 'outbox-1'))
      .get();
    expect(delivery).toMatchObject({ status: 'delivered', attempts: 1, responseStatus: 204 });
    await expect(worker.tickOnce(tenantId)).resolves.toMatchObject({ processed: false });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('drains a direct delivery and refuses new ticks after stop', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const tenantId = 'webhook-drain-tenant';
    const userId = 'webhook-drain-admin';
    await db.insert(tenants).values({
      id: tenantId,
      name: 'Webhook Drain',
      slug: tenantId,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: userId,
      tenantId,
      email: 'admin@webhook-drain.test',
      name: 'Admin',
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(webhookSubscriptions).values({
      id: 'subscription-drain',
      tenantId,
      name: 'Drain target',
      destinationUrl: 'https://drain.example.test/puntovivo',
      eventTypes: ['sale.completed'],
      sealedSecret: sealWebhookSecret('drain-secret'),
      enabled: true,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(webhookOutbox).values({
      id: 'outbox-drain',
      tenantId,
      eventType: 'sale.completed',
      eventVersion: 1,
      payload: { saleId: 'sale-drain' },
      createdAt: now,
      updatedAt: now,
    });
    let transportStarted!: () => void;
    const started = new Promise<void>(resolve => {
      transportStarted = resolve;
    });
    let releaseTransport!: () => void;
    const transportGate = new Promise<void>(resolve => {
      releaseTransport = resolve;
    });
    const worker = createWebhookWorker({
      db,
      transport: async () => {
        transportStarted();
        await transportGate;
        return { status: 204 };
      },
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    const tick = worker.tickOnce(tenantId);
    await started;
    let stopResolved = false;
    const stop = worker.stop().then(() => {
      stopResolved = true;
    });
    await Promise.resolve();
    expect(stopResolved).toBe(false);

    releaseTransport();
    await expect(tick).resolves.toMatchObject({ outcome: 'completed' });
    await stop;
    await expect(worker.tickOnce(tenantId)).resolves.toEqual({
      processed: false,
      reason: 'idle',
    });
  });

  it('attempts every matching destination even when one permanently rejects the event', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const tenantId = 'webhook-multi-tenant';
    const userId = 'webhook-multi-admin';
    await db.insert(tenants).values({
      id: tenantId,
      name: 'Webhook Multi',
      slug: tenantId,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: userId,
      tenantId,
      email: 'admin@webhook-multi.test',
      name: 'Admin',
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(webhookSubscriptions).values([
      {
        id: 'subscription-rejects',
        tenantId,
        name: 'Rejecting ERP',
        destinationUrl: 'https://rejects.example.test/puntovivo',
        eventTypes: ['sale.completed'],
        sealedSecret: sealWebhookSecret('rejecting-secret'),
        enabled: true,
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'subscription-accepts',
        tenantId,
        name: 'Accepting ERP',
        destinationUrl: 'https://accepts.example.test/puntovivo',
        eventTypes: ['sale.completed'],
        sealedSecret: sealWebhookSecret('accepting-secret'),
        enabled: true,
        createdByUserId: userId,
        createdAt: now,
        updatedAt: now,
      },
    ]);
    await db.insert(webhookOutbox).values({
      id: 'outbox-multi',
      tenantId,
      eventType: 'sale.completed',
      eventVersion: 1,
      payload: { saleId: 'sale-multi' },
      createdAt: now,
      updatedAt: now,
    });
    const transport = vi.fn(async (request: { url: URL }) => ({
      status: request.url.hostname === 'rejects.example.test' ? 400 : 204,
    }));
    const worker = createWebhookWorker({
      db,
      transport,
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    await expect(worker.tickOnce(tenantId)).resolves.toMatchObject({ outcome: 'dead_letter' });
    expect(transport).toHaveBeenCalledTimes(2);
    const deliveries = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.outboxId, 'outbox-multi'))
      .all();
    expect(deliveries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ subscriptionId: 'subscription-rejects', status: 'dead_letter' }),
        expect.objectContaining({ subscriptionId: 'subscription-accepts', status: 'delivered' }),
      ])
    );
  });

  it('retries a transient failure with the same idempotency key and preserves final evidence', async () => {
    const db = getDatabase();
    const now = new Date().toISOString();
    const tenantId = 'webhook-retry-tenant';
    const userId = 'webhook-retry-admin';
    await db.insert(tenants).values({
      id: tenantId,
      name: 'Webhook Retry',
      slug: tenantId,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(users).values({
      id: userId,
      tenantId,
      email: 'admin@webhook-retry.test',
      name: 'Admin',
      passwordHash: 'x',
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(webhookSubscriptions).values({
      id: 'subscription-retry',
      tenantId,
      name: 'Retry ERP',
      destinationUrl: 'https://retry.example.test/puntovivo',
      eventTypes: ['sale.completed'],
      sealedSecret: sealWebhookSecret('retry-secret'),
      enabled: true,
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(webhookOutbox).values({
      id: 'outbox-retry',
      tenantId,
      eventType: 'sale.completed',
      eventVersion: 1,
      payload: { saleId: 'sale-retry' },
      createdAt: now,
      updatedAt: now,
    });
    let attempt = 0;
    const transport = vi.fn(async (request: { headers: Record<string, string> }) => {
      expect(request.headers['idempotency-key']).toBe('outbox-retry:subscription-retry');
      attempt += 1;
      return { status: attempt === 1 ? 503 : 204 };
    });
    const worker = createWebhookWorker({
      db,
      transport,
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
    });

    await expect(worker.tickOnce(tenantId)).resolves.toMatchObject({ outcome: 'retrying' });
    const retrying = await db
      .select()
      .from(webhookOutbox)
      .where(eq(webhookOutbox.id, 'outbox-retry'))
      .get();
    expect(retrying).toMatchObject({ status: 'retrying', attempts: 1 });
    expect(retrying?.nextRetryAt).toBeTruthy();
    await db
      .update(webhookOutbox)
      .set({ nextRetryAt: null })
      .where(eq(webhookOutbox.id, 'outbox-retry'))
      .run();

    await expect(worker.tickOnce(tenantId)).resolves.toMatchObject({ outcome: 'completed' });
    expect(transport).toHaveBeenCalledTimes(2);
    const delivery = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.outboxId, 'outbox-retry'))
      .get();
    expect(delivery).toMatchObject({ status: 'delivered', attempts: 2, responseStatus: 204 });
  });
});
