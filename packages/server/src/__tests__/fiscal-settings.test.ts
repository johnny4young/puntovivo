/**
 * ENG-035a — Tests del router `fiscal.settings.*`.
 *
 * Cobertura:
 *
 * - `getByCountry({MX})` para tenant fresco devuelve settings vacíos
 *   + readiness rojo con MISSING_RFC + MISSING_RESOLUTION +
 *   MISSING_CERTIFICATE.
 * - `getByCountry({CO})` devuelve la proyección mínima + readiness
 *   verde (Colombia mock siempre ok=true).
 * - `getByCountry({CL})` devuelve readiness rojo con
 *   PACK_NOT_AVAILABLE (stub ENG-036).
 * - `updateMx` happy path con RFC + régimen + lugar válidos →
 *   persiste y devuelve readiness verde.
 * - `updateMx` con RFC inválido → tira FISCAL_RFC_INVALID.
 * - `updateMx` con régimen no en catálogo → tira FISCAL_REGIMEN_INVALID.
 * - Cashier llamando `getByCountry` → FORBIDDEN.
 * - Aislamiento multi-tenant: el update del tenant A no toca al tenant B.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';

import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import { tenants, users } from '../db/schema.js';
import { ServerErrorWithCode } from '../lib/errorCodes.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';

let server: PuntovivoServer;
let tenantA: string;
let tenantB: string;
let adminA: string;
let cashierA: string;

function createCtx(opts: {
  tenantId: string;
  userId: string;
  role: 'admin' | 'cashier' | 'manager';
}): Context {
  const db = getDatabase();
  return {
    req: {
      server: server.app,
      headers: {},
      user: {
        userId: opts.userId,
        email: 'ctx@example.com',
        role: opts.role,
        tenantId: opts.tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: opts.userId,
      email: 'ctx@example.com',
      role: opts.role,
      tenantId: opts.tenantId,
    },
    tenantId: opts.tenantId,
    siteId: null,
  };
}

beforeAll(async () => {
  server = await createServer({ dbPath: ':memory:', verbose: false });
  const db = getDatabase();
  const now = new Date().toISOString();

  tenantA = nanoid();
  tenantB = nanoid();
  await db.insert(tenants).values([
    {
      id: tenantA,
      name: 'Fiscal Tenant A',
      slug: `fiscal-a-${nanoid(6)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    },
    {
      id: tenantB,
      name: 'Fiscal Tenant B',
      slug: `fiscal-b-${nanoid(6)}`,
      settings: {},
      createdAt: now,
      updatedAt: now,
    },
  ]);

  adminA = nanoid();
  cashierA = nanoid();
  await db.insert(users).values([
    {
      id: adminA,
      tenantId: tenantA,
      email: 'fiscal-admin@example.com',
      name: 'Fiscal Admin',
      passwordHash: await hash('FiscalPass123!'),
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: cashierA,
      tenantId: tenantA,
      email: 'fiscal-cashier@example.com',
      name: 'Fiscal Cashier',
      passwordHash: await hash('FiscalPass123!'),
      sessionVersion: 1,
      role: 'cashier',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
});

afterAll(async () => {
  if (server) await server.close();
});

beforeEach(async () => {
  // Limpiar settings entre tests para que cada uno arranque fresco.
  const db = getDatabase();
  await db
    .update(tenants)
    .set({ settings: {} })
    .where(eq(tenants.id, tenantA));
  await db
    .update(tenants)
    .set({ settings: {} })
    .where(eq(tenants.id, tenantB));
});

describe('fiscalSettings.getByCountry (ENG-035a)', () => {
  it('MX para tenant fresco → settings vacíos + readiness rojo con 3 issues', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    const result = await caller.fiscalSettings.getByCountry({
      countryCode: 'MX',
    });
    expect(result.countryCode).toBe('MX');
    expect(result.settings).toMatchObject({
      enabled: false,
      rfc: null,
      regimenFiscalCode: null,
      lugarExpedicion: null,
      environment: 'sandbox',
    });
    expect(result.validation.ok).toBe(false);
    const codes = result.validation.issues.map(i => i.code).sort();
    expect(codes).toEqual([
      'MISSING_CERTIFICATE',
      'MISSING_RESOLUTION',
      'MISSING_RFC',
    ]);
    expect(result.notImplemented).toBe(true);
    expect(result.availableInTicket).toBe('ENG-035b');
  });

  it('CO devuelve readiness verde (mock siempre ok)', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    const result = await caller.fiscalSettings.getByCountry({
      countryCode: 'CO',
    });
    expect(result.countryCode).toBe('CO');
    expect(result.settings).toBeNull();
    expect(result.validation.ok).toBe(true);
    expect(result.notImplemented).toBe(false);
  });

  it('CL devuelve readiness rojo con MISSING_RUT/MISSING_RESOLUTION/MISSING_CERTIFICATE (ENG-036a)', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    const result = await caller.fiscalSettings.getByCountry({
      countryCode: 'CL',
    });
    expect(result.countryCode).toBe('CL');
    expect(result.validation.ok).toBe(false);
    const codes = result.validation.issues.map(i => i.code);
    expect(codes).toContain('MISSING_RUT');
    expect(codes).toContain('MISSING_RESOLUTION');
    expect(codes).toContain('MISSING_CERTIFICATE');
    // ENG-036a sigue notImplemented hasta que ENG-036b shipa
    // la emisión XML real.
    expect(result.notImplemented).toBe(true);
    expect(result.availableInTicket).toBe('ENG-036b');
  });

  it('rechaza cashier con FORBIDDEN', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: cashierA, role: 'cashier' })
    );
    let caught: unknown;
    try {
      await caller.fiscalSettings.getByCountry({ countryCode: 'MX' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    expect((caught as TRPCError).code).toBe('FORBIDDEN');
  });
});

describe('fiscalSettings.updateMx (ENG-035a)', () => {
  it('happy path: RFC + régimen + lugar válidos → persiste + readiness verde', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    const result = await caller.fiscalSettings.updateMx({
      enabled: true,
      rfc: 'XEXX010101000',
      regimenFiscalCode: '601',
      lugarExpedicion: '06700',
      environment: 'sandbox',
    });
    expect(result.ok).toBe(true);
    expect(result.settings.rfc).toBe('XEXX010101000');
    expect(result.settings.regimenFiscalCode).toBe('601');
    expect(result.settings.enabled).toBe(true);
    expect(result.validation.ok).toBe(true);

    // El subsequent get refleja lo persistido.
    const fetched = await caller.fiscalSettings.getByCountry({
      countryCode: 'MX',
    });
    expect(fetched.settings).toMatchObject({
      enabled: true,
      rfc: 'XEXX010101000',
      regimenFiscalCode: '601',
      lugarExpedicion: '06700',
      environment: 'sandbox',
    });
  });

  it('RFC inválido → tira FISCAL_RFC_INVALID', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    let caught: unknown;
    try {
      await caller.fiscalSettings.updateMx({ rfc: 'BAD123' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('FISCAL_RFC_INVALID');
  });

  it('régimen fuera del catálogo → tira FISCAL_REGIMEN_INVALID', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    let caught: unknown;
    try {
      await caller.fiscalSettings.updateMx({ regimenFiscalCode: '999' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe(
      'FISCAL_REGIMEN_INVALID'
    );
  });

  it('aislamiento multi-tenant: update del A no toca settings del B', async () => {
    const callerA = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    await callerA.fiscalSettings.updateMx({
      rfc: 'XEXX010101000',
      regimenFiscalCode: '601',
      lugarExpedicion: '06700',
    });

    // Crear admin del tenant B para query aislada.
    const db = getDatabase();
    const adminB = nanoid();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: adminB,
      tenantId: tenantB,
      email: 'fiscal-admin-b@example.com',
      name: 'Fiscal Admin B',
      passwordHash: await hash('FiscalPassB!'),
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const callerB = appRouter.createCaller(
      createCtx({ tenantId: tenantB, userId: adminB, role: 'admin' })
    );
    const fetched = await callerB.fiscalSettings.getByCountry({
      countryCode: 'MX',
    });
    expect(fetched.settings).toMatchObject({
      enabled: false,
      rfc: null,
      regimenFiscalCode: null,
    });
  });
});

describe('fiscalSettings.updateCl (ENG-036a)', () => {
  it('happy path: RUT + giro + comuna + casa matriz válidos → persiste + readiness verde', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    const result = await caller.fiscalSettings.updateCl({
      enabled: true,
      rut: '55555555-5',
      giroCode: '4711',
      comunaCode: 13101,
      casaMatriz: 'Av Apoquindo 4500',
      environment: 'certificacion',
    });
    expect(result.ok).toBe(true);
    expect(result.settings.rut).toBe('55555555-5');
    expect(result.settings.giroCode).toBe('4711');
    expect(result.settings.enabled).toBe(true);
    expect(result.validation.ok).toBe(true);

    // El subsequent get refleja lo persistido.
    const fetched = await caller.fiscalSettings.getByCountry({
      countryCode: 'CL',
    });
    expect(fetched.settings).toMatchObject({
      enabled: true,
      rut: '55555555-5',
      giroCode: '4711',
      comunaCode: 13101,
      casaMatriz: 'Av Apoquindo 4500',
      environment: 'certificacion',
    });
  });

  it('RUT inválido → tira FISCAL_RUT_INVALID', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    let caught: unknown;
    try {
      await caller.fiscalSettings.updateCl({ rut: 'BAD123' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('FISCAL_RUT_INVALID');
  });

  it('giro fuera del catálogo CIIU.cl → tira FISCAL_REGIMEN_INVALID', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    let caught: unknown;
    try {
      await caller.fiscalSettings.updateCl({ giroCode: '9999' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe(
      'FISCAL_REGIMEN_INVALID'
    );
  });

  it('aislamiento multi-tenant: update CL del A no toca settings del B', async () => {
    const callerA = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    await callerA.fiscalSettings.updateCl({
      rut: '55555555-5',
      giroCode: '4711',
      comunaCode: 13101,
      casaMatriz: 'Av Apoquindo 4500',
    });

    // Tenant B sigue limpio (otro admin con mismo countryCode).
    const db = getDatabase();
    const adminBcl = nanoid();
    const now = new Date().toISOString();
    await db.insert(users).values({
      id: adminBcl,
      tenantId: tenantB,
      email: 'fiscal-admin-bcl@example.com',
      name: 'Fiscal Admin B CL',
      passwordHash: await hash('FiscalPassBcl!'),
      sessionVersion: 1,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const callerB = appRouter.createCaller(
      createCtx({ tenantId: tenantB, userId: adminBcl, role: 'admin' })
    );
    const fetched = await callerB.fiscalSettings.getByCountry({
      countryCode: 'CL',
    });
    expect(fetched.settings).toMatchObject({
      enabled: false,
      rut: null,
      giroCode: null,
      comunaCode: null,
      casaMatriz: null,
    });
  });
});
