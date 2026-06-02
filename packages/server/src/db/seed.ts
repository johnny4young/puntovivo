/**
 * Database Seed Module
 *
 * Seeds the database with default data including:
 * - Default tenant
 * - Admin user with secure random password
 *
 * @module db/seed
 */

import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { randomBytes } from 'crypto';
import { hashPasswordSecurely } from '../security/passwords.js';
import type { DatabaseInstance } from './index.js';
import { createModuleLogger } from '../logging/logger.js';
import { RING1_RETAIL_PROFILE } from '../services/modules/manifest.js';

const seedLog = createModuleLogger('seed');

/**
 * Operator-facing banner for the first-run admin credentials. Kept on
 * `process.stdout.write` (NOT routed through pino) on purpose:
 *
 * 1. The plaintext password must be visible to the operator on first
 *    install so they can log in and rotate it. If it flowed through
 *    the structured stream, the redact policy would mask it to
 *    `[Redacted]` and the operator would have to query the DB to find
 *    the value — worse UX, not better security.
 * 2. Keeping the banner on stdout but outside the log stream means any
 *    log aggregator or JSON-ingesting tool skips it cleanly; the
 *    plaintext never leaks to shared observability infrastructure.
 *
 * Treat this helper as the ONLY sanctioned path to print a plaintext
 * credential from server code. All other credential fields get
 * structured-logged and redacted by pino automatically.
 */
function printCredentialsBanner(line: string): void {
  process.stdout.write(`${line}\n`);
}
import {
  clientTypes,
  commercialActivities,
  companies,
  identificationTypes,
  personTypes,
  regimeTypes,
  sequentials,
  sites,
  tenants,
  units,
  users,
  vatRates,
} from './schema.js';

/**
 * Default admin email
 */
export const DEFAULT_ADMIN = {
  email: 'admin@localhost',
  name: 'Administrator',
};

export const DEFAULT_DEVELOPMENT_ADMIN_PASSWORD = 'Admin123!Dev';
export const DEVELOPMENT_ADMIN_PASSWORD_ENV = 'PUNTOVIVO_DEV_ADMIN_PASSWORD';

export const DEFAULT_TENANT = {
  name: 'Default Business',
  slug: 'default',
};

export const DEFAULT_COMPANY = {
  name: 'Default Business',
  taxId: '900000000-0',
};

export const DEFAULT_SITE = {
  name: 'Main Site',
};

const DEFAULT_VAT_RATES = [
  { name: 'IVA 0%', rate: 0 },
  { name: 'IVA 5%', rate: 5 },
  { name: 'IVA 19%', rate: 19 },
] as const;

const DEFAULT_UNITS = [
  { name: 'Unidad', abbreviation: 'UND' },
  { name: 'Kilogramo', abbreviation: 'KG' },
  { name: 'Libra', abbreviation: 'LB' },
  { name: 'Caja', abbreviation: 'CJ' },
  { name: 'Docena', abbreviation: 'DOC' },
] as const;

const DEFAULT_SEQUENTIALS = [
  { documentType: 'sale' as const, prefix: 'VTA-', currentValue: 0 },
  { documentType: 'purchase' as const, prefix: 'COM-', currentValue: 0 },
  { documentType: 'order' as const, prefix: 'PED-', currentValue: 0 },
  { documentType: 'quotation' as const, prefix: 'COT-', currentValue: 0 },
] as const;

const DEFAULT_IDENTIFICATION_TYPES = [
  { code: 'CC', name: 'Cedula de Ciudadania' },
  { code: 'NIT', name: 'Numero de Identificacion Tributaria' },
  { code: 'CE', name: 'Cedula de Extranjeria' },
] as const;

const DEFAULT_PERSON_TYPES = [
  { code: 'natural', name: 'Natural Person' },
  { code: 'juridica', name: 'Legal Entity' },
] as const;

const DEFAULT_REGIME_TYPES = [
  { code: 'simplified', name: 'Simplified Regime' },
  { code: 'common', name: 'Common Regime' },
] as const;

const DEFAULT_CLIENT_TYPES = [
  { code: 'retail', name: 'Retail Customer' },
  { code: 'wholesale', name: 'Wholesale Customer' },
] as const;

const DEFAULT_COMMERCIAL_ACTIVITIES = [
  { code: '4711', name: 'Retail Trade in General Stores' },
  { code: '4649', name: 'Wholesale Trade in Consumer Goods' },
] as const;

function resolveSeedAdminPassword() {
  const runtimeEnv = process.env.PUNTOVIVO_RUNTIME_ENV;
  const isProduction =
    runtimeEnv != null ? runtimeEnv === 'production' : process.env.NODE_ENV === 'production';

  if (isProduction) {
    return {
      password: randomBytes(16)
        .toString('base64')
        .replace(/[^a-zA-Z0-9]/g, ''),
      isFixed: false,
    };
  }

  return {
    password: process.env[DEVELOPMENT_ADMIN_PASSWORD_ENV] || DEFAULT_DEVELOPMENT_ADMIN_PASSWORD,
    isFixed: true,
  };
}

/**
 * Seed default data if the database is empty
 */
export async function seedDefaultData(db: DatabaseInstance): Promise<void> {
  const now = new Date().toISOString();
  let seededAnything = false;

  let tenant = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, DEFAULT_TENANT.slug))
    .get();

  if (!tenant) {
    tenant = {
      id: nanoid(),
      name: DEFAULT_TENANT.name,
      slug: DEFAULT_TENANT.slug,
      // ENG-183 — a fresh tenant is a RETAIL tenant: write the explicit
      // Ring-1 retail profile so it boots showing only the sellable retail
      // surfaces. Restaurant / KDS / customer-display / mobile-waiter /
      // delivery / public-API / AI modules stay OFF until an admin enables
      // them per tenant via /company?tab=modules. Existing tenants are
      // untouched (manifest defaultEnabled is unchanged).
      // Spread into a fresh object so the seeded tenant never aliases the
      // shared module-level constant (defensive against in-place mutation).
      settings: { modules: { ...RING1_RETAIL_PROFILE } },
      // ENG-176b — explicit default so the type-required column lands
      // with a known value during seed; matches the schema-level
      // DEFAULT used by migration 0037 for legacy backfill.
      defaultCurrencyCode: 'COP',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(tenants).values(tenant);
    seededAnything = true;
  }

  const tenantId = tenant.id;

  let seededAdminPassword: { value: string; isFixed: boolean } | null = null;
  const existingAdmin = await db
    .select()
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.email, DEFAULT_ADMIN.email)))
    .get();

  if (!existingAdmin) {
    const resolvedAdminPassword = resolveSeedAdminPassword();
    const passwordHash = await hashPasswordSecurely(resolvedAdminPassword.password);
    seededAdminPassword = {
      value: resolvedAdminPassword.password,
      isFixed: resolvedAdminPassword.isFixed,
    };

    await db.insert(users).values({
      id: nanoid(),
      tenantId,
      email: DEFAULT_ADMIN.email,
      name: DEFAULT_ADMIN.name,
      passwordHash,
      role: 'admin',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    seededAnything = true;
  }

  let company = await db
    .select()
    .from(companies)
    .where(and(eq(companies.tenantId, tenantId), eq(companies.name, DEFAULT_COMPANY.name)))
    .get();

  if (!company) {
    company = {
      id: nanoid(),
      tenantId,
      name: DEFAULT_COMPANY.name,
      taxId: DEFAULT_COMPANY.taxId,
      address: 'Default Address',
      phone: '0000000000',
      email: DEFAULT_ADMIN.email,
      logoId: null,
      logoUrl: null,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(companies).values(company);
    seededAnything = true;
  }

  let site = await db
    .select()
    .from(sites)
    .where(and(eq(sites.tenantId, tenantId), eq(sites.name, DEFAULT_SITE.name)))
    .get();

  if (!site) {
    site = {
      id: nanoid(),
      tenantId,
      companyId: company.id,
      name: DEFAULT_SITE.name,
      address: company.address,
      phone: company.phone,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    };
    await db.insert(sites).values(site);
    seededAnything = true;
  }

  for (const defaultVatRate of DEFAULT_VAT_RATES) {
    const existingVatRate = await db
      .select()
      .from(vatRates)
      .where(and(eq(vatRates.tenantId, tenantId), eq(vatRates.name, defaultVatRate.name)))
      .get();

    if (!existingVatRate) {
      await db.insert(vatRates).values({
        id: nanoid(),
        tenantId,
        name: defaultVatRate.name,
        rate: defaultVatRate.rate,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      seededAnything = true;
    }
  }

  for (const defaultUnit of DEFAULT_UNITS) {
    const existingUnit = await db
      .select()
      .from(units)
      .where(and(eq(units.tenantId, tenantId), eq(units.abbreviation, defaultUnit.abbreviation)))
      .get();

    if (!existingUnit) {
      await db.insert(units).values({
        id: nanoid(),
        tenantId,
        name: defaultUnit.name,
        abbreviation: defaultUnit.abbreviation,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      seededAnything = true;
    }
  }

  for (const defaultSequential of DEFAULT_SEQUENTIALS) {
    const existingSequential = await db
      .select()
      .from(sequentials)
      .where(
        and(
          eq(sequentials.tenantId, tenantId),
          eq(sequentials.siteId, site.id),
          eq(sequentials.documentType, defaultSequential.documentType)
        )
      )
      .get();

    if (!existingSequential) {
      await db.insert(sequentials).values({
        id: nanoid(),
        tenantId,
        siteId: site.id,
        documentType: defaultSequential.documentType,
        prefix: defaultSequential.prefix,
        currentValue: defaultSequential.currentValue,
        createdAt: now,
        updatedAt: now,
      });
      seededAnything = true;
    }
  }

  for (const defaultCommercialActivity of DEFAULT_COMMERCIAL_ACTIVITIES) {
    const existingCommercialActivity = await db
      .select()
      .from(commercialActivities)
      .where(
        and(
          eq(commercialActivities.tenantId, tenantId),
          eq(commercialActivities.code, defaultCommercialActivity.code)
        )
      )
      .get();

    if (!existingCommercialActivity) {
      await db.insert(commercialActivities).values({
        id: nanoid(),
        tenantId,
        code: defaultCommercialActivity.code,
        name: defaultCommercialActivity.name,
        description: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      seededAnything = true;
    }
  }

  for (const defaultIdentificationType of DEFAULT_IDENTIFICATION_TYPES) {
    const existingIdentificationType = await db
      .select()
      .from(identificationTypes)
      .where(
        and(
          eq(identificationTypes.tenantId, tenantId),
          eq(identificationTypes.code, defaultIdentificationType.code)
        )
      )
      .get();

    if (!existingIdentificationType) {
      await db.insert(identificationTypes).values({
        id: nanoid(),
        tenantId,
        code: defaultIdentificationType.code,
        name: defaultIdentificationType.name,
        description: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      seededAnything = true;
    }
  }

  for (const defaultPersonType of DEFAULT_PERSON_TYPES) {
    const existingPersonType = await db
      .select()
      .from(personTypes)
      .where(and(eq(personTypes.tenantId, tenantId), eq(personTypes.code, defaultPersonType.code)))
      .get();

    if (!existingPersonType) {
      await db.insert(personTypes).values({
        id: nanoid(),
        tenantId,
        code: defaultPersonType.code,
        name: defaultPersonType.name,
        description: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      seededAnything = true;
    }
  }

  for (const defaultRegimeType of DEFAULT_REGIME_TYPES) {
    const existingRegimeType = await db
      .select()
      .from(regimeTypes)
      .where(and(eq(regimeTypes.tenantId, tenantId), eq(regimeTypes.code, defaultRegimeType.code)))
      .get();

    if (!existingRegimeType) {
      await db.insert(regimeTypes).values({
        id: nanoid(),
        tenantId,
        code: defaultRegimeType.code,
        name: defaultRegimeType.name,
        description: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      seededAnything = true;
    }
  }

  for (const defaultClientType of DEFAULT_CLIENT_TYPES) {
    const existingClientType = await db
      .select()
      .from(clientTypes)
      .where(and(eq(clientTypes.tenantId, tenantId), eq(clientTypes.code, defaultClientType.code)))
      .get();

    if (!existingClientType) {
      await db.insert(clientTypes).values({
        id: nanoid(),
        tenantId,
        code: defaultClientType.code,
        name: defaultClientType.name,
        description: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      seededAnything = true;
    }
  }

  if (!seededAnything) {
    return;
  }

  seedLog.info('default data seeded successfully');

  if (seededAdminPassword) {
    // Every line below goes to stdout directly. See the comment on
    // `printCredentialsBanner` above — the plaintext password must be
    // readable by the operator on first install, and pino's redact
    // would mask it if we routed through the module logger.
    printCredentialsBanner('[Database] ═══════════════════════════════════════════════════════════');
    printCredentialsBanner(
      seededAdminPassword.isFixed
        ? '[Database] Development admin credentials are ready'
        : '[Database] ⚠️  IMPORTANT: Save these admin credentials securely!'
    );
    printCredentialsBanner('[Database] ═══════════════════════════════════════════════════════════');
    printCredentialsBanner(`[Database] Email:    ${DEFAULT_ADMIN.email}`);
    printCredentialsBanner(`[Database] Password: ${seededAdminPassword.value}`);
    printCredentialsBanner('[Database] ═══════════════════════════════════════════════════════════');
    if (seededAdminPassword.isFixed) {
      printCredentialsBanner(
        `[Database] Non-production mode uses a fixed password. Override it with ${DEVELOPMENT_ADMIN_PASSWORD_ENV}.`
      );
    } else {
      printCredentialsBanner('[Database] ⚠️  This password will NOT be shown again!');
      printCredentialsBanner('[Database] ⚠️  Please change it immediately after first login.');
    }
    printCredentialsBanner('[Database] ═══════════════════════════════════════════════════════════');
  }
}
