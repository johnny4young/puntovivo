import { TRPCError } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantId: string;
let userId: string;

function createTestContext(): Context {
  const db = getDatabase();
  const mockReq = {
    server: server.app,
    headers: {},
    user: {
      userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    jwtVerify: async () => {},
  } as unknown as Context['req'];

  return {
    req: mockReq,
    res: {} as Context['res'],
    db,
    user: {
      id: userId,
      email: 'admin@localhost',
      role: 'admin',
      tenantId,
    },
    tenantId,
    siteId: null,
  };
}

describe('Customer catalog tRPC Routers', () => {
  beforeAll(async () => {
    server = await createServer({
      dbPath: ':memory:',
      verbose: false,
    });

    const db = getDatabase();
    const seededUser = await db.select().from(users).where(eq(users.email, 'admin@localhost')).get();
    if (!seededUser) {
      throw new Error('Expected seeded admin user');
    }

    tenantId = seededUser.tenantId;
    userId = seededUser.id;
  });

  afterAll(async () => {
    await server.close();
  });

  it('creates, lists, searches, updates, and deletes identification types', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.identificationTypes.create({
      code: 'TI',
      name: 'Tarjeta de Identidad',
      description: 'Minor identification document',
      isActive: true,
    });

    expect(created?.code).toBe('TI');

    const listed = await caller.identificationTypes.list({ page: 1, perPage: 100 });
    expect(listed.items.some(item => item.id === created?.id)).toBe(true);

    const searched = await caller.identificationTypes.search({ q: 'Tarjeta', limit: 10 });
    expect(searched.items.some(item => item.id === created?.id)).toBe(true);

    const updated = await caller.identificationTypes.update({
      id: created!.id,
      name: 'Tarjeta de Identidad Actualizada',
      isActive: false,
    });

    expect(updated?.name).toBe('Tarjeta de Identidad Actualizada');
    expect(updated?.isActive).toBe(false);

    const removed = await caller.identificationTypes.delete({ id: created!.id });
    expect(removed.success).toBe(true);
  });

  it('creates, lists, searches, updates, and deletes commercial activities', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const created = await caller.commercialActivities.create({
      code: '6201',
      name: 'Software Development',
      description: 'Custom software and digital services',
      isActive: true,
    });

    expect(created?.code).toBe('6201');

    const listed = await caller.commercialActivities.list({ page: 1, perPage: 100 });
    expect(listed.items.some(item => item.id === created?.id)).toBe(true);

    const searched = await caller.commercialActivities.search({ q: 'Software', limit: 10 });
    expect(searched.items.some(item => item.id === created?.id)).toBe(true);

    const updated = await caller.commercialActivities.update({
      id: created!.id,
      name: 'Software Development Services',
      isActive: false,
    });

    expect(updated?.name).toBe('Software Development Services');
    expect(updated?.isActive).toBe(false);

    const removed = await caller.commercialActivities.delete({ id: created!.id });
    expect(removed.success).toBe(true);
  });

  it('rejects duplicate identification type codes inside the same tenant', async () => {
    const caller = appRouter.createCaller(createTestContext());

    await caller.identificationTypes.create({
      code: 'PP',
      name: 'Passport',
      description: null,
      isActive: true,
    });

    await expect(
      caller.identificationTypes.create({
        code: 'PP',
        name: 'Passport Duplicate',
        description: null,
        isActive: true,
      })
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: 'CONFLICT',
      message: 'A identification type with this code already exists',
    });
  });

  it('validates customer catalog codes before creating customers', async () => {
    const caller = appRouter.createCaller(createTestContext());

    await expect(
      caller.customers.create({
        name: 'Invalid Catalog Customer',
        identificationTypeId: 'UNKNOWN',
        isActive: true,
      })
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: 'BAD_REQUEST',
      message: 'Selected identification type was not found or is inactive',
    });

    const created = await caller.customers.create({
      name: 'Catalog Customer',
      identificationTypeId: 'CC',
      personTypeId: 'natural',
      regimeTypeId: 'simplified',
      clientTypeId: 'retail',
      commercialActivityId: '4711',
      isActive: true,
    });

    expect(created.identificationTypeId).toBe('CC');
    expect(created.personTypeId).toBe('natural');
    expect(created.regimeTypeId).toBe('simplified');
    expect(created.clientTypeId).toBe('retail');
    expect(created.commercialActivityId).toBe('4711');
  });
});
