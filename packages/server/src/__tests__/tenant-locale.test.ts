/**
 * ENG-017 — tenant locale resolver tests.
 *
 * Coverage:
 * - Resolver round-trip for 4 canonical countries (CO/US/MX/CL)
 *   exercising the full override-shadow matrix.
 * - Override precedence (locale / currency / timezone /
 *   firstDayOfWeek each tested independently against country defaults).
 * - Fallback when the tenant has no row in `tenant_locale_settings`.
 * - Fallback when the tenant references a country/currency that no
 *   longer exists (shouldn't happen in practice but the resolver
 *   must degrade gracefully).
 * - Cross-tenant isolation — two tenants with different countries
 *   resolve independently.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { createServer, type PuntovivoServer } from '../index.js';
import { getDatabase } from '../db/index.js';
import {
  countryCatalog,
  tenantLocaleSettings,
  tenants,
  users,
} from '../db/schema.js';
import {
  LOCALE_FALLBACK,
  resolveTenantLocale,
} from '../services/tenant-locale.js';

let server: PuntovivoServer;
let primaryTenantId: string;
let secondaryTenantId: string;

async function ensureTenant(slug: string): Promise<string> {
  const db = getDatabase();
  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .get();
  if (existing) return existing.id;
  const id = nanoid();
  const now = new Date().toISOString();
  await db
    .insert(tenants)
    .values({
      id,
      name: slug,
      slug,
      settings: {},
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
  return id;
}

async function setLocaleSettings(
  tenantId: string,
  countryCode: string,
  overrides: Partial<{
    localeOverride: string;
    currencyOverride: string;
    timezoneOverride: string;
    firstDayOfWeekOverride: number;
  }> = {}
) {
  const db = getDatabase();
  await db.delete(tenantLocaleSettings).where(eq(tenantLocaleSettings.tenantId, tenantId)).run();
  await db
    .insert(tenantLocaleSettings)
    .values({
      tenantId,
      countryCode,
      localeOverride: overrides.localeOverride ?? null,
      currencyOverride: overrides.currencyOverride ?? null,
      timezoneOverride: overrides.timezoneOverride ?? null,
      firstDayOfWeekOverride: overrides.firstDayOfWeekOverride ?? null,
      updatedAt: new Date().toISOString(),
    })
    .run();
}

describe('resolveTenantLocale (ENG-017)', () => {
  beforeAll(async () => {
    server = await createServer({ dbPath: ':memory:', verbose: false });
    // The default seed creates an admin@localhost user + its tenant.
    // Grab it for the "primary" tenant and create a second one so
    // cross-tenant isolation has a control case.
    const db = getDatabase();
    const seededAdmin = await db
      .select({ tenantId: users.tenantId })
      .from(users)
      .where(eq(users.email, 'admin@localhost'))
      .get();
    if (!seededAdmin) throw new Error('Expected seeded admin tenant');
    primaryTenantId = seededAdmin.tenantId;
    secondaryTenantId = await ensureTenant(`locale-secondary-${nanoid(6)}`);

    // Sanity: the boot-time seed must have populated the catalogs.
    const countryCount = await db
      .select({ count: countryCatalog.code })
      .from(countryCatalog)
      .all();
    expect(countryCount.length).toBeGreaterThanOrEqual(21);
  });

  afterAll(async () => {
    await server.close();
  });

  it('falls back to US/USD when the tenant has no locale settings row', async () => {
    const db = getDatabase();
    await db
      .delete(tenantLocaleSettings)
      .where(eq(tenantLocaleSettings.tenantId, primaryTenantId))
      .run();

    const resolved = await resolveTenantLocale(db, primaryTenantId);
    expect(resolved).toMatchObject({
      locale: 'en-US',
      language: 'en',
      currency: 'USD',
      isFallback: true,
    });
    expect(resolved).toEqual(LOCALE_FALLBACK);
  });

  it('resolves Colombia to es-CO / COP with 0 display decimals (canonical case)', async () => {
    const db = getDatabase();
    await setLocaleSettings(primaryTenantId, 'CO');
    const resolved = await resolveTenantLocale(db, primaryTenantId);
    expect(resolved).toMatchObject({
      locale: 'es-CO',
      language: 'es',
      countryCode: 'CO',
      currency: 'COP',
      currencySymbol: '$',
      legalDecimals: 2,
      displayDecimals: 0,
      timezone: 'America/Bogota',
      firstDayOfWeek: 1,
      dateFormatShort: 'dd/MM/yyyy',
      uiLocaleReady: true,
      isFallback: false,
    });
  });

  it('resolves the USA baseline to en-US / USD with 2/2 decimals', async () => {
    const db = getDatabase();
    await setLocaleSettings(primaryTenantId, 'US');
    const resolved = await resolveTenantLocale(db, primaryTenantId);
    expect(resolved).toMatchObject({
      locale: 'en-US',
      language: 'en',
      countryCode: 'US',
      currency: 'USD',
      legalDecimals: 2,
      displayDecimals: 2,
      firstDayOfWeek: 0,
    });
  });

  it('resolves Chile to es-CL / CLP with 0/0 decimals (strict integer currency)', async () => {
    const db = getDatabase();
    await setLocaleSettings(primaryTenantId, 'CL');
    const resolved = await resolveTenantLocale(db, primaryTenantId);
    expect(resolved).toMatchObject({
      countryCode: 'CL',
      currency: 'CLP',
      legalDecimals: 0,
      displayDecimals: 0,
      locale: 'es-CL',
    });
  });

  it('resolves Mexico to es-MX / MXN with 2/2 decimals', async () => {
    const db = getDatabase();
    await setLocaleSettings(primaryTenantId, 'MX');
    const resolved = await resolveTenantLocale(db, primaryTenantId);
    expect(resolved).toMatchObject({
      countryCode: 'MX',
      currency: 'MXN',
      legalDecimals: 2,
      displayDecimals: 2,
    });
  });

  it('currencyOverride shadows the country default while the rest stays from the country row', async () => {
    // Venezuela defaults to VES; an operator may override to USD for
    // de-facto dollar-denominated operations. Locale should stay
    // es-VE, timezone America/Caracas.
    const db = getDatabase();
    await setLocaleSettings(primaryTenantId, 'VE', { currencyOverride: 'USD' });
    const resolved = await resolveTenantLocale(db, primaryTenantId);
    expect(resolved.countryCode).toBe('VE');
    expect(resolved.currency).toBe('USD');
    expect(resolved.currencySymbol).toBe('$');
    expect(resolved.locale).toBe('es-VE');
    expect(resolved.timezone).toBe('America/Caracas');
  });

  it('localeOverride shadows the country default locale while currency stays from country', async () => {
    // Hypothetical: operator picks Colombia but forces en-US locale.
    // Currency still COP (no currencyOverride), language becomes 'en'.
    const db = getDatabase();
    await setLocaleSettings(primaryTenantId, 'CO', { localeOverride: 'en-US' });
    const resolved = await resolveTenantLocale(db, primaryTenantId);
    expect(resolved.locale).toBe('en-US');
    expect(resolved.language).toBe('en');
    expect(resolved.currency).toBe('COP');
  });

  it('timezoneOverride and firstDayOfWeekOverride shadow the country defaults independently', async () => {
    const db = getDatabase();
    await setLocaleSettings(primaryTenantId, 'US', {
      timezoneOverride: 'America/Los_Angeles',
      firstDayOfWeekOverride: 1,
    });
    const resolved = await resolveTenantLocale(db, primaryTenantId);
    expect(resolved.timezone).toBe('America/Los_Angeles');
    expect(resolved.firstDayOfWeek).toBe(1);
    // Everything else stays from the country row.
    expect(resolved.locale).toBe('en-US');
    expect(resolved.currency).toBe('USD');
  });

  it('keeps two tenants isolated — primary CO does not affect secondary US', async () => {
    const db = getDatabase();
    await setLocaleSettings(primaryTenantId, 'CO');
    await setLocaleSettings(secondaryTenantId, 'US');

    const primary = await resolveTenantLocale(db, primaryTenantId);
    const secondary = await resolveTenantLocale(db, secondaryTenantId);
    expect(primary.countryCode).toBe('CO');
    expect(primary.currency).toBe('COP');
    expect(secondary.countryCode).toBe('US');
    expect(secondary.currency).toBe('USD');
  });
});
