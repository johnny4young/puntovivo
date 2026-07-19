/**
 * ENG-035a — Tests del router `fiscal.settings.*`.
 *
 * Cobertura:
 *
 * - `getByCountry({MX})` para tenant fresco devuelve settings vacíos
 *   + readiness rojo con MISSING_RFC + MISSING_RESOLUTION +
 *   MISSING_CERTIFICATE.
 * - `getByCountry({CO})` devuelve settings CO vacíos + readiness rojo
 *   de presencia con NIT / resolución / rango faltantes.
 * - `getByCountry({CL})` devuelve readiness rojo con RUT /
 *   resolución / certificado faltantes.
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
  await db.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantA));
  await db.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantB));
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
    expect(result.maturity).toBe('draft'); // ENG-185 — unsigned CFDI draft
    expect(result.settings).toMatchObject({
      enabled: false,
      rfc: null,
      regimenFiscalCode: null,
      lugarExpedicion: null,
      environment: 'sandbox',
    });
    expect(result.validation.ok).toBe(false);
    const codes = result.validation.issues.map(i => i.code).sort();
    expect(codes).toEqual(['MISSING_CERTIFICATE', 'MISSING_RESOLUTION', 'MISSING_RFC']);
    // ENG-035b promovió MX de NotImplemented a real adapter — los
    // flags `notImplemented` / `availableInTicket` ya no aplican.
    // El readiness sigue siendo rojo porque los settings están
    // vacíos (3 issues), pero ya no es un stub gated.
    expect(result.notImplemented).toBe(false);
    expect(result.availableInTicket).toBeNull();
  });

  it('CO para tenant fresco → settings CO vacíos + readiness rojo con NIT/RESOLUTION/RANGE (ENG-184)', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    const result = await caller.fiscalSettings.getByCountry({
      countryCode: 'CO',
    });
    expect(result.countryCode).toBe('CO');
    expect(result.maturity).toBe('mock'); // ENG-185 — mock, no DIAN transmission
    // ENG-184 — CO ya no devuelve settings:null; trae la proyección real
    // del namespace fiscal.co + un readiness de PRESENCIA (no mock ok).
    expect(result.settings).toMatchObject({
      enabled: false,
      nit: null,
      dianResolutionNumber: null,
      prefix: null,
      rangeFrom: null,
      rangeTo: null,
      environment: 'habilitacion',
    });
    expect(result.validation.ok).toBe(false);
    const codes = result.validation.issues.map(i => i.code).sort();
    expect(codes).toEqual(['MISSING_NIT', 'MISSING_RANGE', 'MISSING_RESOLUTION']);
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
    expect(result.maturity).toBe('draft'); // ENG-185 — unsigned DTE draft
    expect(result.validation.ok).toBe(false);
    const codes = result.validation.issues.map(i => i.code);
    expect(codes).toContain('MISSING_RUT');
    expect(codes).toContain('MISSING_RESOLUTION');
    expect(codes).toContain('MISSING_CERTIFICATE');
    // ENG-036b lifted the notImplemented stub: the adapter now
    // serializes valid DTE 1.0 XML drafts. ENG-036c is what remains
    // (XAdES signature + SII transmission), but the top-level
    // availableInTicket marker is gone now.
    expect(result.notImplemented).toBe(false);
    expect(result.availableInTicket).toBeNull();
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
    expect((cause as ServerErrorWithCode).errorCode).toBe('FISCAL_REGIMEN_INVALID');
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
    expect((cause as ServerErrorWithCode).errorCode).toBe('FISCAL_REGIMEN_INVALID');
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

describe('fiscalSettings.updateCo (ENG-184)', () => {
  it('happy path: NIT + resolución + rango válidos → persiste flag legacy + fiscal.co + readiness verde', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    const result = await caller.fiscalSettings.updateCo({
      enabled: true,
      nit: '900123456-8',
      dianResolutionNumber: '18760000001',
      prefix: 'setp',
      rangeFrom: 1,
      rangeTo: 5000,
      environment: 'produccion',
    });
    expect(result.ok).toBe(true);
    expect(result.settings).toMatchObject({
      enabled: true,
      nit: '900123456-8',
      dianResolutionNumber: '18760000001',
      prefix: 'SETP', // normalizado a mayúsculas
      rangeFrom: 1,
      rangeTo: 5000,
      environment: 'produccion',
    });
    expect(result.validation.ok).toBe(true);

    // El subsequent get refleja lo persistido + el flag legacy.
    const fetched = await caller.fiscalSettings.getByCountry({
      countryCode: 'CO',
    });
    expect(fetched.settings).toMatchObject({
      enabled: true,
      nit: '900123456-8',
      prefix: 'SETP',
    });

    // El switch maestro se persistió en el flag legacy fiscal_dian_enabled.
    const db = getDatabase();
    const row = await db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantA))
      .get();
    const settings = (row?.settings ?? {}) as Record<string, unknown>;
    expect(settings.fiscal_dian_enabled).toBe(true);
  });

  it('config incompleta → readiness rojo con los issues faltantes', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    const result = await caller.fiscalSettings.updateCo({
      enabled: true,
      nit: '900123456-8',
    });
    expect(result.validation.ok).toBe(false);
    const codes = result.validation.issues.map(i => i.code).sort();
    expect(codes).toEqual(['MISSING_RANGE', 'MISSING_RESOLUTION']);
  });

  it('NIT inválido → tira FISCAL_NIT_INVALID', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    let caught: unknown;
    try {
      await caller.fiscalSettings.updateCo({ nit: 'NOPE' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('FISCAL_NIT_INVALID');
  });

  // A-33 — a NIT with valid FORMAT but a wrong verification digit used to
  // save and only blow up at emission. Now it is rejected, and the message
  // carries the correct DV so the admin can fix it without a lookup.
  it('DV incorrecto → tira FISCAL_NIT_INVALID con el DV correcto en el mensaje', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    let caught: unknown;
    try {
      // 900123456 has DV 8; -7 is a valid-shaped but wrong NIT.
      await caller.fiscalSettings.updateCo({ nit: '900123456-7' });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause as ServerErrorWithCode;
    expect(cause.errorCode).toBe('FISCAL_NIT_INVALID');
    expect(cause.message).toContain('8'); // the correct DV, surfaced to the admin
  });

  it('rango invertido (from > to) → tira FISCAL_NUMBERING_RANGE_INVALID', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    let caught: unknown;
    try {
      await caller.fiscalSettings.updateCo({ rangeFrom: 9000, rangeTo: 10 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TRPCError);
    const cause = (caught as TRPCError).cause;
    expect(cause).toBeInstanceOf(ServerErrorWithCode);
    expect((cause as ServerErrorWithCode).errorCode).toBe('FISCAL_NUMBERING_RANGE_INVALID');
  });

  it('no toca otras ramas fiscales (preserva fiscal.mx)', async () => {
    const caller = appRouter.createCaller(
      createCtx({ tenantId: tenantA, userId: adminA, role: 'admin' })
    );
    await caller.fiscalSettings.updateMx({
      rfc: 'XEXX010101000',
      regimenFiscalCode: '601',
    });
    await caller.fiscalSettings.updateCo({
      enabled: true,
      nit: '900123456-8',
      dianResolutionNumber: '18760000001',
      rangeFrom: 1,
      rangeTo: 5000,
    });
    const mx = await caller.fiscalSettings.getByCountry({ countryCode: 'MX' });
    expect(mx.settings).toMatchObject({
      rfc: 'XEXX010101000',
      regimenFiscalCode: '601',
    });
  });
});
