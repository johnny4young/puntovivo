import { crc16Ccitt } from '@puntovivo/shared/transfer-destinations';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getDatabase } from '../db/index.js';
import {
  auditLogs,
  MAX_SITE_TRANSFER_DESTINATIONS,
  siteTransferDestinations,
  sites,
  tenants,
  users,
} from '../db/schema.js';
import { createServer, type PuntovivoServer } from '../index.js';
import type { Context } from '../trpc/context.js';
import { appRouter } from '../trpc/router.js';

let server: PuntovivoServer;
let tenantId: string;
let adminId: string;
let siteId: string;
let otherSiteId: string;

const body = '000201010211' + '2625' + '0013CO.EXAMPLE.QR' + '0104ABCD' + '5303170' + '5802CO';
const BANK_QR = `${body}6304${crc16Ccitt(`${body}6304`)}`;

function ctxFor(role: 'admin' | 'manager' | 'cashier', overrides: Partial<Context> = {}): Context {
  const user = { id: adminId, email: 'admin@localhost', role, tenantId };
  return {
    req: { server: server.app, headers: {}, user: { userId: adminId, ...user } } as never,
    res: {} as Context['res'],
    db: getDatabase(),
    user,
    tenantId,
    siteId,
    ...overrides,
  } as Context;
}

const admin = () => appRouter.createCaller(ctxFor('admin'));
const manager = () => appRouter.createCaller(ctxFor('manager'));
const cashier = () => appRouter.createCaller(ctxFor('cashier'));

describe('site transfer destinations', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    const db = getDatabase();
    const row = db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!row) throw new Error('Expected seeded admin user');
    tenantId = row.tenantId;
    adminId = row.id;
    const mainSite = db.select().from(sites).where(eq(sites.tenantId, tenantId)).get();
    if (!mainSite) throw new Error('Expected a seeded site');
    siteId = mainSite.id;
    otherSiteId = nanoid();
    db.insert(sites)
      .values({ id: otherSiteId, tenantId, companyId: mainSite.companyId, name: 'Sede Sur' })
      .run();
  });

  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    getDatabase().delete(siteTransferDestinations).run();
  });

  it('stores canonical accounts in order with the brand or bank as default label', async () => {
    await admin().transferDestinations.set({ siteId, kind: 'bre_b', account: ' @TiendaDemo ' });
    await admin().transferDestinations.set({
      siteId,
      kind: 'nequi',
      account: '+57 310 555 0142',
      label: '  Nequi de Rosa ',
      bankName: 'ignored',
      accountType: 'checking',
    });
    const list = await admin().transferDestinations.set({
      siteId,
      kind: 'bank_account',
      account: '000-123456-789',
      bankName: 'Banco Demo',
      accountType: 'savings',
      holderName: 'Tienda Demo',
      holderId: '900123456',
    });

    expect(list.map(row => [row.position, row.kind, row.label, row.account])).toEqual([
      [0, 'bre_b', 'Bre-B', '@TiendaDemo'],
      [1, 'nequi', 'Nequi de Rosa', '3105550142'],
      [2, 'bank_account', 'Banco Demo', '000123456789'],
    ]);
    expect(list[1]).toMatchObject({ bankName: null, accountType: null });
    expect(await admin().transferDestinations.list({ siteId: otherSiteId })).toEqual([]);
  });

  it('builds the charge QR for the amount, or shows the bank QR as stored', async () => {
    await admin().transferDestinations.set({
      siteId,
      kind: 'nequi',
      account: '3105550142',
      holderName: 'Tienda Demo',
    });
    await admin().transferDestinations.set({
      siteId,
      kind: 'bre_b',
      account: '@tiendademo',
      qrPayload: BANK_QR,
    });
    await admin().transferDestinations.set({
      siteId,
      kind: 'bank_account',
      account: '000123456789',
      bankName: 'Banco Demo',
      accountType: 'checking',
    });

    const charge = await cashier().transferDestinations.forCharge({
      siteId,
      amount: 87420,
      locale: 'en',
    });
    expect(charge.currency).toBe('COP');
    expect(charge.destinations).toEqual([
      {
        id: expect.any(String),
        kind: 'nequi',
        label: 'Nequi',
        account: '310 555 0142',
        holderName: 'Tienda Demo',
        qr: {
          format: 'text',
          payload: 'Nequi\n310 555 0142\nTienda Demo\nCOP 87420',
          amountIncluded: true,
        },
      },
      {
        id: expect.any(String),
        kind: 'bre_b',
        label: 'Bre-B',
        account: '@tiendademo',
        holderName: null,
        qr: { format: 'emvco', payload: BANK_QR, amountIncluded: false },
      },
      expect.objectContaining({
        qr: {
          format: 'text',
          payload: 'Banco Demo · Checking\n000123456789\nCOP 87420',
          amountIncluded: true,
        },
      }),
    ]);

    const spanishStatic = await manager().transferDestinations.forCharge({ siteId });
    expect(spanishStatic.destinations[2]!.qr).toEqual({
      format: 'text',
      payload: 'Banco Demo · Corriente\n000123456789',
      amountIncluded: false,
    });
  });

  it('replaces every field on update and rejects invalid accounts, banks and QR content', async () => {
    const [created] = await admin().transferDestinations.set({
      siteId,
      kind: 'nequi',
      account: '3105550142',
      holderName: 'Rosa',
      label: 'Caja 1',
    });
    const [updated] = await admin().transferDestinations.set({
      siteId,
      id: created!.id,
      kind: 'daviplata',
      account: '3115550142',
    });
    expect(updated).toMatchObject({
      id: created!.id,
      kind: 'daviplata',
      label: 'Daviplata',
      account: '3115550142',
      holderName: null,
    });

    const reject = (
      input: Parameters<ReturnType<typeof admin>['transferDestinations']['set']>[0]
    ) => expect(admin().transferDestinations.set(input)).rejects;
    await reject({ siteId, kind: 'nequi', account: '6015550142' }).toMatchObject({
      code: 'BAD_REQUEST',
      cause: {
        errorCode: 'TRANSFER_DESTINATION_ACCOUNT_INVALID',
        details: { kind: 'nequi' },
      },
    });
    await reject({ siteId, kind: 'bank_account', account: '000123456789' }).toMatchObject({
      cause: { errorCode: 'TRANSFER_DESTINATION_BANK_REQUIRED' },
    });
    await reject({
      siteId,
      kind: 'bre_b',
      account: '@tiendademo',
      qrPayload: BANK_QR.replace('ABCD', 'ABCE'),
    }).toMatchObject({ cause: { errorCode: 'TRANSFER_DESTINATION_QR_INVALID' } });
    await reject({ siteId, id: nanoid(), kind: 'nequi', account: '3125550142' }).toMatchObject({
      code: 'NOT_FOUND',
      cause: { errorCode: 'TRANSFER_DESTINATION_NOT_FOUND' },
    });
  });

  it('rejects duplicates and a destination over the limit', async () => {
    await admin().transferDestinations.set({ siteId, kind: 'nequi', account: '3105550100' });
    await expect(
      admin().transferDestinations.set({ siteId, kind: 'nequi', account: '310 555 0100' })
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      cause: { errorCode: 'TRANSFER_DESTINATION_DUPLICATE' },
    });
    // The same number under another wallet is a different destination.
    await admin().transferDestinations.set({ siteId, kind: 'daviplata', account: '3105550100' });

    for (let index = 2; index < MAX_SITE_TRANSFER_DESTINATIONS; index += 1) {
      await admin().transferDestinations.set({
        siteId,
        kind: 'nequi',
        account: `31055501${String(index).padStart(2, '0')}`,
      });
    }
    await expect(
      admin().transferDestinations.set({ siteId, kind: 'nequi', account: '3105550199' })
    ).rejects.toMatchObject({
      code: 'BAD_REQUEST',
      cause: {
        errorCode: 'TRANSFER_DESTINATION_LIMIT_REACHED',
        details: { max: MAX_SITE_TRANSFER_DESTINATIONS },
      },
    });
  });

  it('reorders only with the full set and compacts positions on remove', async () => {
    const ids: string[] = [];
    for (const account of ['3105550101', '3105550102', '3105550103']) {
      ids.push(
        (await admin().transferDestinations.set({ siteId, kind: 'nequi', account })).at(-1)!.id
      );
    }
    await expect(
      admin().transferDestinations.reorder({ siteId, ids: [ids[0]!, ids[1]!] })
    ).rejects.toMatchObject({ cause: { errorCode: 'TRANSFER_DESTINATION_ORDER_INVALID' } });

    const reordered = await admin().transferDestinations.reorder({
      siteId,
      ids: [ids[2]!, ids[0]!, ids[1]!],
    });
    expect(reordered.map(row => row.id)).toEqual([ids[2], ids[0], ids[1]]);

    const remaining = await admin().transferDestinations.remove({ siteId, id: ids[2]! });
    expect(remaining.map(row => [row.id, row.position])).toEqual([
      [ids[0], 0],
      [ids[1], 1],
    ]);
    await expect(
      admin().transferDestinations.remove({ siteId, id: ids[2]! })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('audits every change with the site and the before and after account', async () => {
    const [row] = await admin().transferDestinations.set({
      siteId,
      kind: 'nequi',
      account: '3105550142',
    });
    await admin().transferDestinations.set({
      siteId,
      id: row!.id,
      kind: 'nequi',
      account: '3105550143',
    });
    await admin().transferDestinations.remove({ siteId, id: row!.id });

    const trail = getDatabase()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceId, row!.id)))
      .orderBy(auditLogs.createdAt)
      .all();
    expect(trail.map(entry => entry.action)).toEqual([
      'transfer_destination.create',
      'transfer_destination.update',
      'transfer_destination.delete',
    ]);
    expect(trail[1]).toMatchObject({
      resourceType: 'transfer_destination',
      actorId: adminId,
      before: expect.objectContaining({ account: '3105550142' }),
      after: expect.objectContaining({ account: '3105550143' }),
      metadata: { siteId },
    });
  });

  it('lets managers and cashiers read the charge view but only admins edit or list', async () => {
    for (const caller of [manager(), cashier()]) {
      await expect(
        caller.transferDestinations.set({ siteId, kind: 'nequi', account: '3105550142' })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(caller.transferDestinations.list({ siteId })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(caller.transferDestinations.reorder({ siteId, ids: [] })).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
      await expect(
        caller.transferDestinations.remove({ siteId, id: nanoid() })
      ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
    expect((await cashier().transferDestinations.forCharge({ siteId })).destinations).toEqual([]);
  });

  it('never reads or writes another tenant site', async () => {
    const foreignTenant = nanoid();
    getDatabase()
      .insert(tenants)
      .values({ id: foreignTenant, slug: nanoid(), name: 'Other' })
      .run();
    const foreign = (role: 'admin' | 'cashier') =>
      appRouter.createCaller(ctxFor(role, { tenantId: foreignTenant, siteId: null }));
    const [row] = await admin().transferDestinations.set({
      siteId,
      kind: 'nequi',
      account: '3105550142',
    });

    await expect(foreign('admin').transferDestinations.list({ siteId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      foreign('cashier').transferDestinations.forCharge({ siteId, amount: 1000 })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      foreign('admin').transferDestinations.set({
        siteId,
        id: row!.id,
        kind: 'nequi',
        account: '3000000000',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      foreign('admin').transferDestinations.remove({ siteId, id: row!.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // A row id from another site is not found from this one.
    await expect(
      admin().transferDestinations.remove({ siteId: otherSiteId, id: row!.id })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
