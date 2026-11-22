import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify,
  type ECDH,
} from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase, type DatabaseInstance } from '../db/index.js';
import {
  appSettings,
  pushSubscriptions,
  sites,
  tenantLocaleSettings,
  tenants,
  users,
} from '../db/schema.js';
import type { WebhookPostRequest } from '../services/events/webhook-http.js';
import { registerDevice } from '../services/devices/devicesService.js';
import { configureWebPushKey } from '../services/push/key-store.js';
import { renderOwnerPush } from '../services/push/messages.js';
import {
  configureOwnerPushDelivery,
  deliverOwnerPush,
  settleOwnerPush,
} from '../services/push/notify.js';
import { MAX_PUSH_SUBSCRIPTIONS_PER_USER } from '../services/push/subscriptions.js';
import { encryptPushPayload, vapidAuthorization } from '../services/push/web-push.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { freshCriticalContext } from './utils/criticalCommandFixture.js';

const PUSH_KEY = 'b'.repeat(64);
const PUBLIC_ADDRESS = { address: '93.184.216.34', family: 4 };

let server: PuntovivoServer;
let db: DatabaseInstance;
let tenantId: string;
let siteId: string;
let sent: WebhookPostRequest<Buffer>[];
let nextStatus: number;

type Role = 'admin' | 'manager' | 'cashier' | 'viewer';

interface Browser {
  endpoint: string;
  receiver: ECDH;
  auth: Buffer;
  keys: { p256dh: string; auth: string };
}

function browser(): Browser {
  const receiver = createECDH('prime256v1');
  const p256dh = receiver.generateKeys().toString('base64url');
  const auth = randomBytes(16);
  return {
    endpoint: `https://push.example.test/send/${nanoid()}`,
    receiver,
    auth,
    keys: { p256dh, auth: auth.toString('base64url') },
  };
}

// Receiver side of RFC 8291, written from the spec independently of the sender.
function decrypt(
  body: Buffer,
  target: Browser
): { title: string; body: string; tag: string; url: string } {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const senderKey = body.subarray(21, 21 + idLength);
  const ciphertext = body.subarray(21 + idLength);
  const shared = target.receiver.computeSecret(senderKey);
  const info = Buffer.concat([
    Buffer.from('WebPush: info\0'),
    target.receiver.getPublicKey(),
    senderKey,
  ]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, target.auth, info, 32));
  const cek = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16)
  );
  const nonce = Buffer.from(
    hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12)
  );
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  expect(plain.at(-1)).toBe(2);
  return JSON.parse(plain.subarray(0, -1).toString('utf8'));
}

function sentTo(target: Browser) {
  return sent.filter(request => request.url.href === target.endpoint);
}

async function createUser(role: Role, name = `Push ${role}`) {
  const id = nanoid();
  const email = `push-${role}-${id}@example.test`;
  await db.insert(users).values({
    id,
    tenantId,
    email,
    name,
    passwordHash: 'unused',
    role,
    isActive: true,
  });
  const context = (): Context => {
    const user = { id, email, role, tenantId };
    return {
      req: {
        server: server.app,
        headers: {},
        user: { userId: id, email, role, tenantId },
        jwtVerify: async () => {},
      } as unknown as Context['req'],
      res: {} as Context['res'],
      db,
      user,
      tenantId,
      siteId,
    };
  };
  const caller = () => appRouter.createCaller(context());
  const subscribe = async (target: Browser, language: 'es' | 'en' = 'es') => {
    await caller().ownerPush.subscribe({ endpoint: target.endpoint, keys: target.keys, language });
    await settleOwnerPush();
  };
  return { id, email, role, caller, subscribe };
}

describe('owner push', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    db = getDatabase();
    const admin = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!admin) throw new Error('Expected seeded admin user');
    tenantId = admin.tenantId;
    const site = await db
      .select({ id: sites.id })
      .from(sites)
      .where(eq(sites.tenantId, tenantId))
      .get();
    if (!site) throw new Error('Expected seeded site');
    siteId = site.id;
    await db
      .update(tenants)
      .set({ settings: { modules: { companion: true } } })
      .where(eq(tenants.id, tenantId));
    await db
      .insert(tenantLocaleSettings)
      .values({ tenantId, countryCode: 'CO' })
      .onConflictDoUpdate({ target: tenantLocaleSettings.tenantId, set: { countryCode: 'CO' } });
  });

  beforeEach(async () => {
    configureWebPushKey(PUSH_KEY);
    sent = [];
    nextStatus = 201;
    configureOwnerPushDelivery({
      resolver: async () => [PUBLIC_ADDRESS],
      transport: async request => {
        sent.push(request);
        return { status: nextStatus };
      },
    });
    await db.delete(pushSubscriptions);
  });

  afterEach(async () => {
    await settleOwnerPush();
    configureOwnerPushDelivery();
  });

  afterAll(async () => {
    configureWebPushKey(undefined);
    await server.app.close();
  });

  it('matches the RFC 8291 aes128gcm test vector', () => {
    const b = (value: string) => Buffer.from(value, 'base64url');
    const body = encryptPushPayload(
      Buffer.from('When I grow up, I want to be a watermelon'),
      {
        p256dh:
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        auth: 'BTBZMqHH6r4Tts7J_aSIgg',
      },
      {
        salt: b('DGv6ra1nlYgDCS1FRnbzlw'),
        senderPrivateKey: b('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
      }
    );
    expect(body.toString('base64url')).toBe(
      'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN'
    );
  });

  it('serves one stable VAPID key and stores its private half sealed', async () => {
    const manager = await createUser('manager');
    const first = await manager.caller().ownerPush.status({ endpoint: null });
    const second = await manager.caller().ownerPush.status({ endpoint: null });
    expect(first).toMatchObject({ available: true, subscribed: false });
    expect(Buffer.from(first.publicKey!, 'base64url')).toHaveLength(65);
    expect(second.publicKey).toBe(first.publicKey);

    const stored = await db
      .select({ value: appSettings.value })
      .from(appSettings)
      .where(eq(appSettings.key, 'web_push_vapid'))
      .get();
    const value = stored?.value as { publicKey: string; sealedPrivateKey: string };
    expect(value.publicKey).toBe(first.publicKey);
    expect(value.sealedPrivateKey).toMatch(/^v1\./);
  });

  it('is unavailable without a database key and refuses to subscribe', async () => {
    configureWebPushKey(undefined);
    const manager = await createUser('manager');
    await expect(manager.caller().ownerPush.status({ endpoint: null })).resolves.toEqual({
      available: false,
      publicKey: null,
      subscribed: false,
      language: null,
    });
    const target = browser();
    await expect(
      manager
        .caller()
        .ownerPush.subscribe({ endpoint: target.endpoint, keys: target.keys, language: 'es' })
    ).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' });
  });

  it('limits push to managers and admins with the companion module on', async () => {
    const target = browser();
    for (const role of ['cashier', 'viewer'] as const) {
      const user = await createUser(role);
      await expect(user.subscribe(target)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    await db
      .update(tenants)
      .set({ settings: { modules: { companion: false } } })
      .where(eq(tenants.id, tenantId));
    try {
      const manager = await createUser('manager');
      await expect(manager.subscribe(target)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally {
      await db
        .update(tenants)
        .set({ settings: { modules: { companion: true } } })
        .where(eq(tenants.id, tenantId));
    }
  });

  it('rejects endpoints the server must never post to and malformed keys', async () => {
    const manager = await createUser('manager');
    const target = browser();
    for (const endpoint of [
      'http://push.example.test/x',
      'https://localhost/x',
      'https://push.example.test:8443/x',
      'https://10.0.0.4/x',
    ]) {
      await expect(
        manager.caller().ownerPush.subscribe({ endpoint, keys: target.keys, language: 'es' })
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    }
    configureOwnerPushDelivery({ resolver: async () => [{ address: '192.168.1.20', family: 4 }] });
    await expect(manager.subscribe(target)).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    configureOwnerPushDelivery({ resolver: async () => [PUBLIC_ADDRESS] });
    await expect(
      manager.caller().ownerPush.subscribe({
        endpoint: target.endpoint,
        keys: { p256dh: target.keys.auth, auth: target.keys.auth },
        language: 'es',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it('confirms the opt-in to that phone only, signed with VAPID and readable only by it', async () => {
    const manager = await createUser('manager');
    const other = browser();
    const target = browser();
    await manager.subscribe(other);
    sent = [];
    await manager.subscribe(target);

    expect(sent).toHaveLength(1);
    const [request] = sent;
    expect(request!.url.href).toBe(target.endpoint);
    expect(request!.pinnedAddress).toEqual(PUBLIC_ADDRESS);
    expect(request!.headers).toMatchObject({
      'content-encoding': 'aes128gcm',
      urgency: 'normal',
    });
    expect(decrypt(request!.body, target)).toEqual({
      title: 'Avisos activados',
      body: 'Aprobaciones, relevos de caja y el día sellado llegan a este teléfono.',
      tag: 'enabled',
      url: '/c/',
    });

    const { publicKey } = await manager.caller().ownerPush.status({ endpoint: target.endpoint });
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(
      request!.headers.authorization!
    );
    expect(match?.[4]).toBe(publicKey);
    const point = Buffer.from(publicKey!, 'base64url');
    const key = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: point.subarray(1, 33).toString('base64url'),
        y: point.subarray(33).toString('base64url'),
      },
      format: 'jwk',
    });
    expect(
      verify(
        'sha256',
        Buffer.from(`${match![1]}.${match![2]}`),
        { key, dsaEncoding: 'ieee-p1363' },
        Buffer.from(match![3]!, 'base64url')
      )
    ).toBe(true);
    const claims = JSON.parse(Buffer.from(match![2]!, 'base64url').toString('utf8'));
    expect(claims).toMatchObject({
      aud: 'https://push.example.test',
      sub: 'https://puntovivo.app',
    });

    await expect(
      manager.caller().ownerPush.status({ endpoint: target.endpoint })
    ).resolves.toMatchObject({
      subscribed: true,
    });
  });

  it('tells the people who can approve, never the requester, when an approval waits', async () => {
    const manager = await createUser('manager');
    const admin = await createUser('admin');
    const managerPhone = browser();
    const adminPhone = browser();
    await manager.subscribe(managerPhone);
    await admin.subscribe(adminPhone, 'en');

    const cashier = await createUser('cashier', 'Marta Ríos');
    const device = await registerDevice(db, {
      tenantId,
      userId: cashier.id,
      kind: 'web',
      name: 'push-cashier',
    });
    const cashierCritical = () =>
      freshCriticalContext({
        db,
        serverApp: server.app,
        tenantId,
        userId: cashier.id,
        email: cashier.email,
        role: 'cashier',
        siteId,
        deviceId: device.deviceId,
      });

    sent = [];
    const discount = await appRouter.createCaller(cashierCritical()).managerApprovals.request({
      action: 'sale_discount',
      reason: 'Cliente mayorista',
      resourceType: 'sale',
      resourceId: nanoid(),
      summary: { label: 'checkout', amount: 74400, currencyCode: 'COP' },
    });
    expect(discount.status).toBe('pending');
    await settleOwnerPush();
    expect(sent).toHaveLength(2);
    const managerMessage = decrypt(sentTo(managerPhone)[0]!.body, managerPhone);
    expect(managerMessage.title).toMatch(/^Le toca a usted: descuento de \$\s?74\.400$/u);
    expect(managerMessage.body).toMatch(/^Marta Ríos pide su aprobación en .+\.$/u);
    expect(managerMessage.tag).toBe(`approval:${discount.id}`);
    expect(sentTo(managerPhone)[0]!.headers).toMatchObject({ urgency: 'high', ttl: '600' });
    expect(decrypt(sentTo(adminPhone)[0]!.body, adminPhone).title).toMatch(
      /^Your call: discount of /
    );

    // Admin-only actions reach admins only; a manager requesting is not told about it.
    const managerDevice = await registerDevice(db, {
      tenantId,
      userId: manager.id,
      kind: 'web',
      name: 'push-manager',
    });
    sent = [];
    await appRouter
      .createCaller(
        freshCriticalContext({
          db,
          serverApp: server.app,
          tenantId,
          userId: manager.id,
          email: manager.email,
          role: 'manager',
          siteId,
          deviceId: managerDevice.deviceId,
        })
      )
      .managerApprovals.request({
        action: 'credit_override',
        reason: 'Cupo excedido',
        resourceType: 'sale',
        resourceId: nanoid(),
        summary: { label: 'checkout', amount: 10, currencyCode: 'COP' },
      });
    await settleOwnerPush();
    expect(sent.map(request => request.url.href)).toEqual([adminPhone.endpoint]);
  });

  it('never blocks the business write when the push service is down', async () => {
    const manager = await createUser('manager');
    await manager.subscribe(browser());
    configureOwnerPushDelivery({
      resolver: async () => [PUBLIC_ADDRESS],
      transport: async () => {
        throw new Error('ENETUNREACH');
      },
    });
    const cashier = await createUser('cashier');
    const device = await registerDevice(db, {
      tenantId,
      userId: cashier.id,
      kind: 'web',
      name: 'push-offline',
    });
    const created = await appRouter
      .createCaller(
        freshCriticalContext({
          db,
          serverApp: server.app,
          tenantId,
          userId: cashier.id,
          email: cashier.email,
          role: 'cashier',
          siteId,
          deviceId: device.deviceId,
        })
      )
      .managerApprovals.request({
        action: 'cash_drawer_open',
        reason: 'Cambio',
        resourceType: 'site',
        resourceId: siteId,
        summary: { label: 'drawer' },
      });
    expect(created.status).toBe('pending');
    await settleOwnerPush();
    expect(await db.select().from(pushSubscriptions)).toHaveLength(1);
  });

  it("silences a phone once the owner's sessions are revoked, until they turn it on again", async () => {
    const manager = await createUser('manager');
    const phone = browser();
    await manager.subscribe(phone);
    await db
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, manager.id));
    sent = [];
    const handoff = {
      id: 'handoff-revoked',
      registerName: 'Caja 3',
      fromCashierName: 'Laura',
      toCashierName: 'Diego',
      outgoingCount: 100,
      receivedCount: 100,
    };
    await deliverOwnerPush(db, { kind: 'handoff_done', tenantId, actorId: 'x', handoff });
    expect(sent).toHaveLength(0);
    await expect(
      manager.caller().ownerPush.status({ endpoint: phone.endpoint })
    ).resolves.toMatchObject({
      subscribed: false,
    });

    await manager.subscribe(phone);
    expect(sentTo(phone).map(request => decrypt(request.body, phone).tag)).toEqual(['enabled']);
    sent = [];
    await deliverOwnerPush(db, { kind: 'handoff_done', tenantId, actorId: 'x', handoff });
    expect(sentTo(phone)).toHaveLength(1);
  });

  it('forgets a phone the push service reports gone', async () => {
    const manager = await createUser('manager');
    await manager.subscribe(browser());
    nextStatus = 410;
    const result = await deliverOwnerPush(db, {
      kind: 'handoff_done',
      tenantId,
      actorId: 'someone-else',
      handoff: {
        id: 'handoff-1',
        registerName: 'Caja 2',
        fromCashierName: 'Andrés',
        toCashierName: 'Camila',
        outgoingCount: 1392700,
        receivedCount: 1392700,
      },
    });
    expect(result).toEqual({ sent: 0, removed: 1, failed: 0 });
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });

  it('drops subscriptions and rotates the VAPID key when the database key changes', async () => {
    const manager = await createUser('manager');
    const before = await manager.caller().ownerPush.status({ endpoint: null });
    await manager.subscribe(browser());
    configureWebPushKey('c'.repeat(64));
    const after = await manager.caller().ownerPush.status({ endpoint: null });
    expect(after.publicKey).not.toBe(before.publicKey);
    expect(
      await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, manager.id))
    ).toHaveLength(0);
    sent = [];
    const result = await deliverOwnerPush(db, {
      kind: 'handoff_done',
      tenantId,
      actorId: 'someone-else',
      handoff: {
        id: 'handoff-2',
        registerName: 'Caja 1',
        fromCashierName: 'Laura',
        toCashierName: 'Diego',
        outgoingCount: 100,
        receivedCount: null,
      },
    });
    expect(result.removed).toBe(0);
    expect(sent).toHaveLength(0);
    await db.delete(appSettings).where(eq(appSettings.key, 'web_push_vapid'));
  });

  it('confirms the opt-in once, not on a language refresh of the same phone', async () => {
    const manager = await createUser('manager');
    const target = browser();
    await manager.subscribe(target);
    expect(sent).toHaveLength(1);
    sent = [];
    await manager.subscribe(target, 'en');
    expect(sent).toHaveLength(0);
    await expect(
      manager.caller().ownerPush.status({ endpoint: target.endpoint })
    ).resolves.toMatchObject({ subscribed: true, language: 'en' });
  });

  it('moves a re-subscribed phone to the new person, caps phones per person and unsubscribes', async () => {
    const manager = await createUser('manager');
    const admin = await createUser('admin');
    const shared = browser();
    await manager.subscribe(shared);
    await admin.subscribe(shared, 'en');
    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, shared.endpoint));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: admin.id, language: 'en' });
    expect(rows[0]!.sealedKeys).not.toContain(shared.keys.auth);
    await expect(
      manager.caller().ownerPush.status({ endpoint: shared.endpoint })
    ).resolves.toMatchObject({
      subscribed: false,
    });

    // Knowing the endpoint URL without the browser's keys does not take it over.
    await expect(
      manager.caller().ownerPush.subscribe({
        endpoint: shared.endpoint,
        keys: browser().keys,
        language: 'es',
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const owner = await db
      .select({ userId: pushSubscriptions.userId })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, shared.endpoint))
      .get();
    expect(owner?.userId).toBe(admin.id);

    for (let index = 0; index < MAX_PUSH_SUBSCRIPTIONS_PER_USER + 2; index += 1) {
      await manager.subscribe(browser());
    }
    const owned = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, manager.id));
    expect(owned).toHaveLength(MAX_PUSH_SUBSCRIPTIONS_PER_USER);

    await admin.caller().ownerPush.unsubscribe({ endpoint: shared.endpoint });
    await expect(
      admin.caller().ownerPush.status({ endpoint: shared.endpoint })
    ).resolves.toMatchObject({
      subscribed: false,
    });
  });
});

describe('owner push copy', () => {
  const format = { locale: 'es-CO', displayDecimals: 0 };

  it('renders handoffs as on the phone board', () => {
    const base = {
      kind: 'handoff_done' as const,
      registerName: 'Caja 2',
      fromName: 'Andrés',
      toName: 'Camila',
      outgoingCount: 1392700,
      currencyCode: 'COP',
    };
    const same = renderOwnerPush({ ...base, receivedCount: 1392700 }, 'es', format);
    expect(same.title).toBe('Relevo de Caja 2 hecho');
    expect(same.body).toMatch(/^Andrés entregó \$\s?1\.392\.700\. Camila contó lo mismo\.$/u);
    expect(renderOwnerPush({ ...base, receivedCount: 1380000 }, 'es', format).body).toMatch(
      /Camila contó \$\s?1\.380\.000\.$/u
    );
    expect(renderOwnerPush({ ...base, receivedCount: null }, 'en', format).body).toMatch(
      /Camila opened with a new drawer\.$/
    );
  });

  it('renders the sealed day with its weekday, signer and sales', () => {
    const message = {
      kind: 'day_sealed' as const,
      date: '2026-11-11',
      signerName: 'Marta Ríos',
      netRevenue: 8517350,
      salesCount: 171,
      currencyCode: 'COP',
    };
    const es = renderOwnerPush(message, 'es', format);
    expect(es.title).toBe('Día sellado: miércoles 11');
    expect(es.body).toMatch(/^Firmó Marta Ríos\. Vendido \$\s?8\.517\.350 en 171 ventas\.$/u);
    expect(renderOwnerPush(message, 'en', format).title).toBe('Day sealed: Wednesday 11');
  });

  it('leaves the amount out of a drawer opening', () => {
    expect(
      renderOwnerPush(
        {
          kind: 'approval_waiting',
          action: 'cash_drawer_open',
          requesterName: 'Diego',
          siteName: 'Sede Norte',
          amount: null,
          currencyCode: null,
        },
        'es',
        format
      ).title
    ).toBe('Le toca a usted: apertura del cajón');
  });
});

describe('vapid authorization', () => {
  it('scopes the token to the push service origin', () => {
    const header = vapidAuthorization(
      new URL('https://fcm.googleapis.com/fcm/send/abc'),
      {
        publicKey:
          'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
        privateKey: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
      },
      'https://puntovivo.app',
      Date.UTC(2026, 10, 22)
    );
    const claims = JSON.parse(Buffer.from(header.split('.')[1]!, 'base64url').toString('utf8'));
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: Date.UTC(2026, 10, 22) / 1000 + 12 * 60 * 60,
      sub: 'https://puntovivo.app',
    });
  });
});
