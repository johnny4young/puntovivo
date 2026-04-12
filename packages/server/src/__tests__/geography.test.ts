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

describe('Geography tRPC Routers', () => {
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

  it('creates, lists, updates, searches, and deletes countries, departments, and cities', async () => {
    const caller = appRouter.createCaller(createTestContext());

    const country = await caller.countries.create({
      code: 'CO',
      name: 'Colombia',
      isActive: true,
    });

    const department = await caller.departments.create({
      countryId: country!.id,
      code: 'CUN',
      name: 'Cundinamarca',
      isActive: true,
    });

    expect(department?.code).toBe('CUN');
    expect(department?.countryName).toBe('Colombia');

    const city = await caller.cities.create({
      departmentId: department!.id,
      code: 'BOG',
      name: 'Bogota',
      isActive: true,
    });

    expect(city?.departmentName).toBe('Cundinamarca');
    expect(city?.countryName).toBe('Colombia');

    const listedCountries = await caller.countries.list({ page: 1, perPage: 20 });
    expect(listedCountries.items.some(item => item.id === country!.id)).toBe(true);

    const listedDepartments = await caller.departments.list({ page: 1, perPage: 20 });
    expect(listedDepartments.items.some(item => item.id === department!.id)).toBe(true);

    const listedCities = await caller.cities.list({ page: 1, perPage: 20 });
    expect(listedCities.items.some(item => item.id === city!.id)).toBe(true);

    const updatedCity = await caller.cities.update({
      id: city!.id,
      name: 'Bogota D.C.',
    });
    expect(updatedCity?.name).toBe('Bogota D.C.');

    const searchedCities = await caller.cities.search({ q: 'Cundinamarca', limit: 10 });
    expect(searchedCities.items.map(item => item.id)).toContain(city!.id);

    const removedCity = await caller.cities.delete({ id: city!.id });
    expect(removedCity.success).toBe(true);

    const removedDepartment = await caller.departments.delete({ id: department!.id });
    expect(removedDepartment.success).toBe(true);

    const removedCountry = await caller.countries.delete({ id: country!.id });
    expect(removedCountry.success).toBe(true);
  });

  it('rejects duplicate codes and blocks deleting countries and departments with dependents', async () => {
    const caller = appRouter.createCaller(createTestContext());
    const country = await caller.countries.create({
      code: 'VE',
      name: 'Venezuela',
      isActive: true,
    });

    const department = await caller.departments.create({
      countryId: country!.id,
      code: 'ATL',
      name: 'Atlantico',
      isActive: true,
    });

    await expect(
      caller.departments.create({
        countryId: country!.id,
        code: 'ATL',
        name: 'Duplicate Atlantico',
        isActive: true,
      })
    ).rejects.toMatchObject<Partial<TRPCError>>({
      code: 'CONFLICT',
      message: 'A department with this code already exists',
    });

    await caller.cities.create({
      departmentId: department!.id,
      code: 'BAQ',
      name: 'Barranquilla',
      isActive: true,
    });

    await expect(caller.departments.delete({ id: department!.id })).rejects.toMatchObject<
      Partial<TRPCError>
    >({
      code: 'CONFLICT',
      message: 'This department is assigned to one or more cities',
    });

    await expect(caller.countries.delete({ id: country!.id })).rejects.toMatchObject<
      Partial<TRPCError>
    >({
      code: 'CONFLICT',
      message: 'This country is assigned to one or more departments',
    });
  });
});
