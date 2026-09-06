import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import NativeDatabase from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, sql } from 'drizzle-orm';
import { createServer, type PuntovivoServer } from '../index.js';
import * as schema from '../db/schema.js';
import * as passwords from '../security/passwords.js';
import { createInstallationSetup } from '../services/installation/setup.js';
import { completeInstallationInput } from '../trpc/schemas/installation.js';

const claim = {
  ownerName: 'New Owner',
  email: 'owner@example.com',
  password: 'StrongOwnerPassword42!',
  businessName: 'Everyday Retail',
  siteName: 'Main Store',
  countryCode: 'CO',
  presetId: 'retail' as const,
};
const csrf = 'a'.repeat(43);
let directory: string;
let path: string;
let server: PuntovivoServer;

async function boot() {
  server = await createServer({ dbPath: path, seedData: false, verbose: false });
}

function payload() {
  return { ...claim, token: server.getSetupToken()! };
}

function submit(
  overrides: Record<string, unknown> = {},
  options: {
    origin?: string;
    remoteAddress?: string;
    csrfCookie?: string;
    csrfHeader?: string;
  } = {}
) {
  return server.app.inject({
    method: 'POST',
    url: '/api/trpc/auth.completeSetup?batch=1',
    remoteAddress: options.remoteAddress ?? '127.0.0.1',
    headers: {
      origin: options.origin ?? 'http://localhost:3000',
      'content-type': 'application/json',
      'x-csrf-token': options.csrfHeader ?? csrf,
      // Proxy-controlled headers must never override the real socket.
      'x-forwarded-for': '127.0.0.1',
      'x-forwarded-proto': 'https',
    },
    cookies: { puntovivo_csrf: options.csrfCookie ?? csrf },
    payload: JSON.stringify({ '0': { ...payload(), ...overrides } }),
  });
}

function expectEmpty() {
  for (const table of [
    schema.tenants,
    schema.users,
    schema.companies,
    schema.sites,
    schema.units,
    schema.auditLogs,
    schema.tenantLocaleSettings,
  ]) {
    expect(server.db.select().from(table).all()).toHaveLength(0);
  }
  expect(server.db.select().from(schema.installationSetup).get()?.completedAt).toBeNull();
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'puntovivo-installation-'));
  path = join(directory, 'new.db');
  await boot();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await server?.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('first-use ownership over real tRPC and SQLite', () => {
  it('publishes only a setup flag and global country choices, never the capability', async () => {
    const token = server.getSetupToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const response = await server.app.inject('/api/trpc/auth.setupStatus?batch=1');
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const status = response.json()[0].result.data;
    expect(Object.keys(status).sort()).toEqual(['countries', 'required']);
    expect(status.required).toBe(true);
    expect(status.countries).toContainEqual({
      code: 'CO',
      nameEn: 'Colombia',
      nameEs: 'Colombia',
      currencyCode: 'COP',
    });
    expect(response.body).not.toContain(token);
    expect(response.cookies.some(cookie => cookie.name === 'puntovivo_csrf')).toBe(true);
    expectEmpty();
  });

  it.each([
    ['missing CSRF cookie', {}, { csrfCookie: '' }, 'SETUP_CSRF_REQUIRED'],
    ['missing CSRF header', {}, { csrfHeader: '' }, 'SETUP_CSRF_REQUIRED'],
    ['mismatched CSRF', {}, { csrfHeader: 'b'.repeat(43) }, 'SETUP_CSRF_REQUIRED'],
    [
      'remote socket with spoofed forwarding',
      {},
      { remoteAddress: '192.0.2.20' },
      'SETUP_LOCAL_ACCESS_REQUIRED',
    ],
    ['remote origin', {}, { origin: 'https://untrusted.example' }, 'SETUP_LOCAL_ACCESS_REQUIRED'],
    ['missing origin', {}, { origin: '' }, 'SETUP_LOCAL_ACCESS_REQUIRED'],
    ['incorrect capability', { token: '0'.repeat(64) }, {}, 'SETUP_TOKEN_INVALID'],
    ['unknown country', { countryCode: 'ZZ' }, {}, 'SETUP_COUNTRY_INVALID'],
  ])('rejects %s before hashing or any business write', async (_name, input, options, code) => {
    const hash = vi.spyOn(passwords, 'hashPasswordSecurely');
    const response = await submit(input, options);
    expect(response.json()[0].error.data.errorCode).toBe(code);
    expect(hash).not.toHaveBeenCalled();
    expectEmpty();
  });

  it.each([
    { password: 'short' },
    { password: 'a'.repeat(129) },
    { email: 'admin@localhost' },
    { tenantId: 'attacker-supplied' },
    { role: 'admin' },
    { businessName: ' ' },
    { token: 'not-a-capability' },
  ])('validates all identity fields at the API boundary: %j', async input => {
    const hash = vi.spyOn(passwords, 'hashPasswordSecurely');
    expect((await submit(input)).statusCode).toBe(400);
    expect(hash).not.toHaveBeenCalled();
    expectEmpty();
  });

  it('atomically creates the explicit owner, supports ordinary login after lost response, and stays closed after restart', async () => {
    const token = server.getSetupToken()!;
    const response = await submit({ email: '  Owner@Example.com  ' });
    expect(response.statusCode).toBe(200);
    expect(response.json()[0].result.data).toEqual({ created: true });
    expect(server.getSetupToken()).toBeNull();
    const tenant = server.db.select().from(schema.tenants).get()!;
    const owner = server.db.select().from(schema.users).get()!;
    const site = server.db.select().from(schema.sites).get()!;
    const company = server.db.select().from(schema.companies).get()!;
    expect(tenant).toMatchObject({
      name: claim.businessName,
      defaultCurrencyCode: 'COP',
      settings: { businessType: 'retail' },
    });
    expect(owner).toMatchObject({
      name: claim.ownerName,
      email: claim.email,
      role: 'admin',
      tenantId: tenant.id,
    });
    expect(await passwords.verifyPasswordSecurely(owner.passwordHash!, claim.password)).toBe(true);
    expect(site).toMatchObject({
      tenantId: tenant.id,
      companyId: company.id,
      name: claim.siteName,
    });
    expect(company.taxId).toBeNull();
    expect(server.db.select().from(schema.vatRates).all()).toHaveLength(0);
    const audit = server.db.select().from(schema.auditLogs).all();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'installation.owner_created',
      tenantId: tenant.id,
      actorId: owner.id,
    });
    expect(JSON.stringify(audit)).not.toMatch(
      new RegExp(`${token}|${claim.password}|${claim.email}`)
    );
    expect((await submit({ token })).statusCode).toBe(409);
    await server.close();
    await boot();
    expect(server.app.installationSetup.getStatus()).toEqual({ required: false, countries: [] });
    const login = await server.app.inject({
      method: 'POST',
      url: '/api/trpc/auth.login?batch=1',
      payload: { '0': { email: claim.email, password: claim.password } },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()[0].result.data.user.id).toBe(owner.id);
    expect(server.db.select().from(schema.users).all()).toHaveLength(1);
    // Deleting/deactivating an owner must never open unauthenticated setup.
    server.db
      .update(schema.users)
      .set({ isActive: false })
      .where(eq(schema.users.id, owner.id))
      .run();
    await server.close();
    await boot();
    expect(server.getSetupToken()).toBeNull();
  });

  it('rotates an unconsumed capability after restart and rejects the prior process token', async () => {
    const old = server.getSetupToken()!;
    await server.close();
    await boot();
    expect(server.getSetupToken()).not.toBe(old);
    expect((await submit({ token: old })).statusCode).toBe(401);
    expectEmpty();
    expect((await submit()).statusCode).toBe(200);
  });

  it('fails closed when the singleton marker is missing', async () => {
    server.db.delete(schema.installationSetup).run();
    await server.close();
    await boot();
    expect(server.getSetupToken()).toBeNull();
    expect((await submit({ token: '0'.repeat(64) })).statusCode).toBe(409);
    expect(server.db.select().from(schema.installationSetup).all()).toHaveLength(0);
  });

  it('adopts historical identities without modifying credentials and remains completed after their deletion', async () => {
    server.db
      .insert(schema.tenants)
      .values({ id: 'historical', name: 'Original', slug: 'original' })
      .run();
    await server.close();
    await boot();
    expect(server.getSetupToken()).toBeNull();
    expect(server.db.select().from(schema.installationSetup).get()?.completionKind).toBe('adopted');
    server.db.delete(schema.tenants).run();
    await server.close();
    await boot();
    expect(server.getSetupToken()).toBeNull();
    expect(server.db.select().from(schema.users).all()).toHaveLength(0);
  });

  it.each(['audit', 'marker'])(
    'rolls every write back on %s failure and preserves the same proof for retry',
    async failure => {
      const token = server.getSetupToken()!;
      server.db.run(
        sql.raw(
          failure === 'audit'
            ? "CREATE TRIGGER fail_claim BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'claim fault'); END"
            : "CREATE TRIGGER fail_claim BEFORE UPDATE ON installation_setup BEGIN SELECT RAISE(ABORT, 'claim fault'); END"
        )
      );
      await expect(server.app.installationSetup.complete(payload())).rejects.toThrow('claim fault');
      expectEmpty();
      expect(server.getSetupToken()).toBe(token);
      server.db.run(sql`DROP TRIGGER fail_claim`);
      await expect(server.app.installationSetup.complete(payload())).resolves.toEqual({
        created: true,
      });
    }
  );

  it('allows one expensive hash at a time without weakening real password work', async () => {
    const input = payload();
    const first = server.app.installationSetup.complete(input);
    await expect(server.app.installationSetup.complete(input)).rejects.toThrow('busy');
    await expect(first).resolves.toEqual({ created: true });
    expect(server.db.select().from(schema.users).all()).toHaveLength(1);
  });

  it('bounds valid-proof retries after rollback, even under the test runtime', async () => {
    server.db.run(
      sql`CREATE TRIGGER fail_claim BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT, 'claim fault'); END`
    );
    const input = payload();
    for (let i = 0; i < 5; i++)
      await expect(server.app.installationSetup.complete(input)).rejects.toThrow('claim fault');
    const hash = vi.spyOn(passwords, 'hashPasswordSecurely');
    await expect(server.app.installationSetup.complete(input)).rejects.toThrow('busy');
    expect(hash).not.toHaveBeenCalled();
    expectEmpty();
    server.db.run(sql`DROP TRIGGER fail_claim`);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_001);
    await expect(server.app.installationSetup.complete(input)).resolves.toEqual({ created: true });
  });

  it('serializes two actual database connections so competing claims create exactly one owner', async () => {
    const native = new NativeDatabase(path);
    native.pragma('busy_timeout = 1000');
    const peer = createInstallationSetup(drizzle(native, { schema }));
    try {
      const results = await Promise.allSettled([
        server.app.installationSetup.complete(payload()),
        peer.complete({ ...claim, email: 'peer@example.com', token: peer.getToken()! }),
      ]);
      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(server.db.select().from(schema.users).all()).toHaveLength(1);
      expect(server.db.select().from(schema.tenants).all()).toHaveLength(1);
      expect(server.db.select().from(schema.auditLogs).all()).toHaveLength(1);
      expect(peer.getToken()).toBeNull();
      expect(server.getSetupToken()).toBeNull();
    } finally {
      peer.dispose();
      native.close();
    }
  });

  it('invalidates a capability when its owner is disposed while hashing', async () => {
    const controller = server.app.installationSetup;
    const pending = controller.complete(payload());
    controller.dispose();
    await expect(pending).rejects.toThrow('not available');
    expectEmpty();
    expect(controller.getToken()).toBeNull();
  });
});

describe('ownership migration and input contracts', () => {
  it.each([false, true])('adopts existing=%s without inventing business rows', existing => {
    const native = new NativeDatabase(':memory:');
    try {
      for (const table of ['tenants', 'users', 'companies', 'sites'])
        native.exec(`CREATE TABLE ${table} (id TEXT PRIMARY KEY)`);
      if (existing) native.exec("INSERT INTO users VALUES ('old-owner')");
      native.exec(
        readFileSync(
          new URL('../db/migrations/0080_installation_ownership.sql', import.meta.url),
          'utf8'
        )
      );
      expect(native.prepare('SELECT completion_kind FROM installation_setup').get()).toEqual({
        completion_kind: existing ? 'adopted' : null,
      });
      expect(native.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({
        count: existing ? 1 : 0,
      });
      expect(() =>
        native.exec("UPDATE installation_setup SET completed_at = 'now', completion_kind = NULL")
      ).toThrow('CHECK');
      expect(() => native.exec("UPDATE installation_setup SET id = 'second'")).toThrow('CHECK');
    } finally {
      native.close();
    }
  });

  it('accepts normalized real owner data without caller-selected identity or privilege', () => {
    expect(
      completeInstallationInput.parse({
        ...claim,
        token: 'A'.repeat(64),
        email: '  Owner@Example.com  ',
      })
    ).toMatchObject({ email: claim.email, token: 'a'.repeat(64) });
  });
});
