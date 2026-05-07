/**
 * Developer Seed Module (`docs/DEV-SEED.md`).
 *
 * Populates a fresh Puntovivo install with a realistic multi-site /
 * multi-user / multi-product dataset so developers, QA, and demos do
 * not have to click through every catalog form. Invoke via:
 *
 *     npm run seed:dev
 *     npm run seed:dev -- --preset=large
 *     npm run seed:dev -- --reset
 *
 * Design principles:
 *
 * - **Idempotent**: a second run without `--reset` is a no-op because
 *   the tenant slug (`demo-co`) lookup short-circuits. Each other
 *   insert is also existence-checked for safety.
 * - **Deterministic**: fixed names / SKUs / prices so two runs
 *   produce byte-identical output. Helps snapshot-style tests.
 * - **Invariant-safe**: wherever possible the seed goes through the
 *   same tRPC caller the UI uses, so `inventory_balances`,
 *   `products.stock`, `sequentials`, and `cash_sessions.expected_balance`
 *   are all maintained by the existing service transactions. For
 *   rows that do not need service logic (catalogs, customers) we
 *   direct-insert to keep the seed fast.
 * - **Safe in production**: `seedDevData()` itself is innocent and
 *   can be called with any DB, but the CLI entry
 *   (`scripts/seed-dev.mjs`) refuses to run when `NODE_ENV` is
 *   production or the tenant slug already contains a non-dev marker.
 *
 * @module db/seed-dev
 */

import * as argon2 from 'argon2';
import { and, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from './index.js';
import {
  categories,
  cities,
  clientTypes,
  commercialActivities,
  companies,
  countries,
  customers,
  departments,
  fiscalCertificates,
  fiscalNumberingResolutions,
  identificationTypes,
  locations,
  personTypes,
  providers,
  regimeTypes,
  sequentials,
  sites,
  tenantLocaleSettings,
  tenants,
  units,
  userRoleEnum,
  users,
  vatRates,
} from './schema.js';

type UserRole = (typeof userRoleEnum)[number];
import { createModuleLogger } from '../logging/logger.js';
import { appRouter } from '../trpc/router.js';
import type { Context } from '../trpc/context.js';
import { createReceiptTemplate } from '../services/receipt-templates.js';
import type { ReceiptLayout } from '../trpc/schemas/receiptTemplates.js';
import { registerDevice as registerDeviceService } from '../services/devices/devicesService.js';
import { makeEnvelopeHeadersProxy } from '../lib/envelopeHeadersProxy.js';

const log = createModuleLogger('seed-dev');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const DEV_TENANT_SLUG = 'demo-co';
export const DEV_TENANT_NAME = 'Demo Retail Colombia';
export const DEV_COMPANY_NAME = 'Demo Retail Colombia S.A.S.';
export const DEV_ADMIN_EMAIL = 'admin@demo.co';
/**
 * The shared dev password for every seeded user. Satisfies the
 * server's `strongPasswordSchema` (≥12 chars, upper, lower, digit,
 * symbol). Documented in `docs/DEV-SEED.md` so the operator knows
 * exactly what to type at the login screen.
 */
export const DEV_USER_PASSWORD = 'Admin123!Dev';

export interface SeedDevOptions {
  /**
   * Dataset size:
   * - `default`: 50 products + 40 sales (fast, for tests + first-boot).
   * - `large`: 500 products + 200 sales (legacy, for catalog stress tests).
   * - `mega` (ENG-052b): builds on `default` and adds 90+ days of
   *   historical operational data — sales/refunds/voids, cash sessions,
   *   purchases + returns, transfers, quotations across all 5 states,
   *   orders, suspended drafts, sync queue, AI audit, login attempts,
   *   logos, and a recent-3-days pass through the live tRPC critical
   *   procedure path. Designed for visual UI testing of every page.
   */
  preset?: 'default' | 'large' | 'mega';
  /**
   * Country code para el tenant demo. Default `'CO'` para preservar
   * paridad con todos los tests + E2E existentes que asumen Colombia.
   * `'MX'` activa el pack México (ENG-035b) — flippea `tenantLocaleSettings.countryCode`,
   * setea el namespace `fiscal.mx.*` con valores de prueba, y deja
   * los seed sales emitiendo CFDI 4.0 vía `MexicoCFDIAdapter`.
   */
  countryCode?: 'CO' | 'MX';
  /** Structured logging verbosity during the run. */
  verbose?: boolean;
}

export interface SeedDevUser {
  email: string;
  password: string;
  name: string;
  role: UserRole;
}

export interface SeedDevSite {
  id: string;
  name: string;
}

export interface SeedDevCounts {
  users: number;
  sites: number;
  categories: number;
  providers: number;
  customers: number;
  products: number;
  receiptTemplates: number;
  purchases: number;
  sales: number;
  quotations: number;
  inventoryTransfers: number;
  cashSessions: number;
  stockAdjustments: number;
}

export interface SeedDevResult {
  /** True when the seed actually ran (freshly created data). False on idempotent skip. */
  seeded: boolean;
  tenantId: string;
  companyId: string;
  users: SeedDevUser[];
  sites: SeedDevSite[];
  counts: SeedDevCounts;
}

/**
 * Run the developer seed. Safe to call on an already-seeded DB — the
 * tenant-slug check short-circuits. Only the CLI entry
 * (`scripts/seed-dev.mjs`) enforces the production guard; callers in
 * tests want to seed `:memory:` and should not be blocked.
 */
export async function seedDevData(
  db: DatabaseInstance,
  options: SeedDevOptions = {}
): Promise<SeedDevResult> {
  const preset = options.preset ?? 'default';
  const countryCode = options.countryCode ?? 'CO';

  const existingTenant = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, DEV_TENANT_SLUG))
    .get();

  if (existingTenant) {
    log.info(
      { tenantSlug: DEV_TENANT_SLUG, tenantId: existingTenant.id },
      'dev seed skipped — tenant already exists'
    );
    const counts = await summarizeTenant(db, existingTenant.id);
    const existingUsers = await db
      .select({
        email: users.email,
        name: users.name,
        role: users.role,
      })
      .from(users)
      .where(eq(users.tenantId, existingTenant.id))
      .all();
    const existingSites = await db
      .select({ id: sites.id, name: sites.name })
      .from(sites)
      .where(eq(sites.tenantId, existingTenant.id))
      .all();
    return {
      seeded: false,
      tenantId: existingTenant.id,
      companyId: counts.companyId,
      users: existingUsers.map(u => ({
        email: u.email,
        password: DEV_USER_PASSWORD,
        name: u.name,
        role: (u.role ?? 'viewer') as UserRole,
      })),
      sites: existingSites,
      counts: counts.counts,
    };
  }

  log.info({ preset }, 'running dev seed');

  const target = buildPreset(preset);
  const now = new Date().toISOString();

  // ----- 1. Tenant --------------------------------------------------------
  const tenantId = nanoid();
  await db
    .insert(tenants)
    .values({
      id: tenantId,
      name: DEV_TENANT_NAME,
      slug: DEV_TENANT_SLUG,
      // ENG-020 — enable DIAN emission for the Colombia demo tenant so
      // every sale seeded through `sales.create` also produces a
      // fiscal_documents row. Real tenants opt in via the admin
      // habilitación wizard (stubbed in Fase E as placeholder UI).
      // ENG-035b — cuando SEED_COUNTRY=mx, también poblamos el
      // namespace `fiscal.mx.*` con valores de prueba para que el
      // adapter MexicoCFDIAdapter emita CFDI 4.0 estructuralmente
      // válido durante el smoke.
      // ENG-068 — every demo module starts ON for the demo tenant so
      // the existing UI tabs continue to look the same to the
      // operator. The admin tab `/company?tab=modules` is the lever to
      // flip them OFF for SaaS-style activation experiments.
      settings:
        countryCode === 'MX'
          ? {
              fiscal_dian_enabled: true,
              fiscal: {
                mx: {
                  enabled: true,
                  rfc: 'AAA010101AAA',
                  regimenFiscalCode: '601',
                  lugarExpedicion: '06700',
                  environment: 'sandbox',
                },
              },
              modules: {
                copilot: true,
                'operations-center': true,
                quotations: true,
                'anomaly-detection': true,
                'semantic-search': true,
              },
            }
          : {
              fiscal_dian_enabled: true,
              modules: {
                copilot: true,
                'operations-center': true,
                quotations: true,
                'anomaly-detection': true,
                'semantic-search': true,
              },
            },
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // ENG-017 — bootstrap this dev tenant with Colombia as its country
  // so `formatCurrency` renders COP with 0 display decimals and
  // `dd/MM/yyyy` dates out of the box. `INSERT OR IGNORE`-style
  // guard via the `on conflict do nothing` pattern keeps the seed
  // idempotent when re-running `seedDevData()` against an existing
  // DB.
  await db
    .insert(tenantLocaleSettings)
    .values({
      tenantId,
      // ENG-035b — countryCode parametrizable. CO usa COP/dd-MM-yyyy;
      // MX flippea a MXN/dd-MM-yyyy y dispatcha al MexicoCFDIAdapter.
      countryCode,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();

  // ----- 2. Users ---------------------------------------------------------
  const seedUsers = DEV_USER_PROFILES.map(profile => ({
    id: nanoid(),
    ...profile,
  }));
  const passwordHash = await argon2.hash(DEV_USER_PASSWORD);
  for (const u of seedUsers) {
    await db
      .insert(users)
      .values({
        id: u.id,
        tenantId,
        email: u.email,
        name: u.name,
        passwordHash,
        role: u.role,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  const adminUser = seedUsers.find(u => u.role === 'admin')!;
  const cashierUsers = seedUsers.filter(u => u.role === 'cashier');

  // ENG-052b — register a single seed device so the historical
  // batches below can drive critical procedures (sales, cash
  // sessions). Real desktop / web clients register their own devices
  // through `auth.registerDevice`; the seed-owned device stays as a
  // permanent row attributed to the admin user, which keeps the
  // operations log honest about who pumped the data.
  const seedDevice = await registerDeviceService(db, {
    tenantId,
    userId: adminUser.id,
    kind: 'web',
    name: 'puntovivo-seed-dev',
  });
  const seedDeviceId = seedDevice.deviceId;

  // ----- 3. Company + Sites ----------------------------------------------
  const companyId = nanoid();
  await db
    .insert(companies)
    .values({
      id: companyId,
      tenantId,
      name: DEV_COMPANY_NAME,
      taxId: DEV_COMPANY_TAX_ID,
      address: 'Cra 7 # 12-34, Bogotá',
      phone: '+57 320 555 1234',
      email: 'contacto@demo.co',
      logoId: null,
      logoUrl: null,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const siteRows: SeedDevSite[] = DEV_SITES.map(site => ({
    id: nanoid(),
    name: site.name,
  }));
  for (let i = 0; i < DEV_SITES.length; i += 1) {
    const profile = DEV_SITES[i]!;
    const row = siteRows[i]!;
    await db
      .insert(sites)
      .values({
        id: row.id,
        tenantId,
        companyId,
        name: row.name,
        address: profile.address,
        phone: profile.phone,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  // ----- 3b. Fiscal placeholders (ENG-020) --------------------------------
  // The orchestrator skips emission when no active numbering resolution
  // exists for the sale site. Seed one DEE range per site so the dev
  // environment can exercise the full CUFE round-trip across both
  // registers. ENG-021 swaps the technicalKey for a DIAN-issued value
  // and plugs a real Proveedor Tecnológico certificate.
  const devFiscalValidFrom = new Date();
  const devFiscalValidUntil = new Date(devFiscalValidFrom);
  devFiscalValidUntil.setFullYear(devFiscalValidUntil.getFullYear() + 1);
  for (const [index, site] of siteRows.entries()) {
    await db
      .insert(fiscalNumberingResolutions)
      .values({
        id: nanoid(),
        tenantId,
        siteId: site.id,
        kind: 'DEE',
        resolutionNumber: `1876000000${index + 1}`,
        prefix: `SE${index + 1}P`,
        fromNumber: 1,
        toNumber: 10_000,
        currentNumber: 0,
        technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
        validFrom: devFiscalValidFrom.toISOString(),
        validUntil: devFiscalValidUntil.toISOString(),
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  await db
    .insert(fiscalCertificates)
    .values({
      id: nanoid(),
      tenantId,
      alias: 'dev-mock-certificate',
      // Fase A ships a placeholder ref; Fase B wires a real p12 blob
      // via a storage service. The ref itself is non-secret.
      p12Ref: 'mock://certificates/demo-co.p12',
      passphraseRef: 'mock://vault/demo-co-passphrase',
      subjectDn: 'CN=Demo Retail Colombia, O=Puntovivo, C=CO',
      validFrom: devFiscalValidFrom.toISOString(),
      validUntil: devFiscalValidUntil.toISOString(),
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // ----- 4. Locations (tenant-wide) --------------------------------------
  const locationRows = DEV_LOCATIONS.map((loc, index) => ({
    id: nanoid(),
    code: `LOC-${String(index + 1).padStart(2, '0')}`,
    name: loc,
  }));
  for (const loc of locationRows) {
    await db
      .insert(locations)
      .values({
        id: loc.id,
        tenantId,
        code: loc.code,
        name: loc.name,
        description: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
  const defaultLocationId = locationRows[0]!.id;

  // ----- 5. Geography (Colombia → Cundinamarca → Bogotá) -----------------
  const countryId = nanoid();
  await db
    .insert(countries)
    .values({
      id: countryId,
      tenantId,
      code: 'CO',
      name: 'Colombia',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const departmentId = nanoid();
  await db
    .insert(departments)
    .values({
      id: departmentId,
      tenantId,
      countryId,
      code: '25',
      name: 'Cundinamarca',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  const cityId = nanoid();
  await db
    .insert(cities)
    .values({
      id: cityId,
      tenantId,
      departmentId,
      code: '11001',
      name: 'Bogotá D.C.',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  // ----- 6. Catalogs (VAT rates, units, identification types, ...) -------
  const vatRateIds: Record<string, string> = {};
  for (const rate of DEV_VAT_RATES) {
    const id = nanoid();
    vatRateIds[rate.name] = id;
    await db
      .insert(vatRates)
      .values({
        id,
        tenantId,
        name: rate.name,
        rate: rate.rate,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const unitIds: Record<string, string> = {};
  for (const unit of DEV_UNITS) {
    const id = nanoid();
    unitIds[unit.abbreviation] = id;
    await db
      .insert(units)
      .values({
        id,
        tenantId,
        name: unit.name,
        abbreviation: unit.abbreviation,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const identificationTypeIds: Record<string, string> = {};
  for (const type of DEV_IDENTIFICATION_TYPES) {
    const id = nanoid();
    identificationTypeIds[type.code] = id;
    await db
      .insert(identificationTypes)
      .values({
        id,
        tenantId,
        code: type.code,
        name: type.name,
        description: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const personTypeIds: Record<string, string> = {};
  for (const type of DEV_PERSON_TYPES) {
    const id = nanoid();
    personTypeIds[type.code] = id;
    await db
      .insert(personTypes)
      .values({
        id,
        tenantId,
        code: type.code,
        name: type.name,
        description: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  for (const type of DEV_REGIME_TYPES) {
    await db
      .insert(regimeTypes)
      .values({
        id: nanoid(),
        tenantId,
        code: type.code,
        name: type.name,
        description: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  for (const type of DEV_CLIENT_TYPES) {
    await db
      .insert(clientTypes)
      .values({
        id: nanoid(),
        tenantId,
        code: type.code,
        name: type.name,
        description: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  for (const activity of DEV_COMMERCIAL_ACTIVITIES) {
    await db
      .insert(commercialActivities)
      .values({
        id: nanoid(),
        tenantId,
        code: activity.code,
        name: activity.name,
        description: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  // ----- 7. Sequentials (one per document kind per site) ------------------
  // Prefixes must differ per site so the tenant-scoped
  // (tenant_id, sale_number) / (tenant_id, purchase_number) uniques
  // can never collide across sites. E.g. VTA-N-000001 for Sede Norte
  // and VTA-S-000001 for Sede Sur both live under the same tenant
  // without clashing. The suffix is the first letter of the site name
  // so the mapping is obvious in a printed receipt too.
  for (let siteIndex = 0; siteIndex < siteRows.length; siteIndex += 1) {
    const site = siteRows[siteIndex]!;
    const siteSuffix = deriveSiteSequentialSuffix(site.name, siteIndex);
    for (const seq of DEV_SEQUENTIALS) {
      await db
        .insert(sequentials)
        .values({
          id: nanoid(),
          tenantId,
          siteId: site.id,
          documentType: seq.documentType,
          prefix: `${seq.prefix}${siteSuffix}-`,
          currentValue: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
  }

  // ----- 8. Categories + providers ----------------------------------------
  const categoryIds: Record<string, string> = {};
  for (const cat of DEV_CATEGORIES) {
    const id = nanoid();
    categoryIds[cat.slug] = id;
    await db
      .insert(categories)
      .values({
        id,
        tenantId,
        name: cat.name,
        description: cat.description,
        parentId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  const providerRows = DEV_PROVIDERS.map(p => ({
    id: nanoid(),
    name: p.name,
    taxId: p.taxId,
  }));
  for (let i = 0; i < DEV_PROVIDERS.length; i += 1) {
    const profile = DEV_PROVIDERS[i]!;
    const row = providerRows[i]!;
    await db
      .insert(providers)
      .values({
        id: row.id,
        tenantId,
        name: profile.name,
        taxId: profile.taxId,
        phone: profile.phone,
        email: profile.email,
        address: profile.address,
        cityId,
        contactName: profile.contactName,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  // ----- 9. Customers ------------------------------------------------------
  const customerRows: Array<{ id: string; name: string }> = [];
  for (const profile of DEV_CUSTOMERS) {
    const id = nanoid();
    customerRows.push({ id, name: profile.name });
    await db
      .insert(customers)
      .values({
        id,
        tenantId,
        name: profile.name,
        email: profile.email,
        phone: profile.phone,
        address: profile.address,
        city: profile.city,
        state: profile.state,
        postalCode: profile.postalCode,
        country: profile.country,
        taxId: profile.taxId,
        identificationTypeId: identificationTypeIds[profile.idTypeCode],
        personTypeId: personTypeIds[profile.personTypeCode],
        regimeTypeId: null,
        clientTypeId: null,
        commercialActivityId: null,
        notes: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }

  // ----- 10. Products (with unit assignments + initial stock per site) ----
  const productCount = preset === 'large' ? target.largeProductTarget : target.defaultProductTarget;
  const productDefinitions = buildProductDefinitions(productCount);
  const productRows: Array<{
    id: string;
    sku: string;
    name: string;
    price: number;
    cost: number;
    baseUnitId: string;
    categorySlug: string;
    initialStock: number;
  }> = [];
  for (const def of productDefinitions) {
    const id = nanoid();
    const baseUnitId = unitIds[def.baseUnit]!;
    productRows.push({
      id,
      sku: def.sku,
      name: def.name,
      price: def.price,
      cost: def.cost,
      baseUnitId,
      categorySlug: def.categorySlug,
      initialStock: def.initialStock,
    });
    await insertProductRow(db, {
      id,
      tenantId,
      now,
      def,
      categoryId: categoryIds[def.categorySlug]!,
      vatRateId: vatRateIds[def.vatRateName]!,
      locationId: defaultLocationId,
      unitIds,
      defaultProviderId: providerRows[def.providerIndex % providerRows.length]!.id,
    });
  }

  // Initial stock: split across the two sites 60/40, distributed per
  // product according to the definition. Inserting directly into
  // `inventory_balances` keeps the seed fast; we sync `products.stock`
  // in one SQL pass at the end.
  await seedInitialBalances(db, tenantId, productRows, siteRows, adminUser.id, now);
  await syncProductsStockFromBalances(db, tenantId);

  // ----- 11. Receipt templates (one per kind, via service) ----------------
  const receiptTemplateLayouts = buildDefaultReceiptLayouts();
  for (const [kind, layout] of Object.entries(receiptTemplateLayouts)) {
    createReceiptTemplate(db, {
      tenantId,
      kind: kind as 'sale' | 'quotation' | 'fiscal_dee',
      name: layout.name,
      layout: layout.layout,
      isActive: true,
      createdBy: adminUser.id,
    });
  }

  // ----- 12. Historical operational data via tRPC caller ------------------
  // Purchases first so stock reflects what the service would produce
  // (same transaction path, same inventory invariant).
  const purchasesResult = await seedPurchases(db, {
    tenantId,
    adminUser,
    siteRows,
    providerRows,
    productRows,
    unitIds,
    targetPerSite: target.purchasesPerSite,
    deviceId: seedDeviceId,
  });

  // Cash sessions + sales per cashier/site combination. We assign each
  // cashier to a specific site so `requireActiveCashSession` returns
  // the session we just opened for that (cashier, site) pair.
  const salesResult = await seedSales(db, {
    tenantId,
    adminUser,
    cashierUsers,
    siteRows,
    customerRows,
    productRows,
    unitIds,
    targetPerCashier: target.salesPerCashier,
    deviceId: seedDeviceId,
  });

  // Quotations (no cash session required; admin role).
  const quotationsCount = await seedQuotations(db, {
    tenantId,
    adminUser,
    siteRows,
    customerRows,
    productRows,
    unitIds,
    target: target.quotations,
    deviceId: seedDeviceId,
  });

  // Inventory transfers between the two sites (if there are at least 2).
  const transfersCount =
    siteRows.length >= 2
      ? await seedTransfers(db, {
          tenantId,
          adminUser,
          siteRows,
          productRows,
          target: target.transfers,
          deviceId: seedDeviceId,
        })
      : 0;

  // Stock adjustments — exercise the `inventory.adjustStock` path so
  // audit_logs have some `inventory.adjust_stock` rows to render.
  const adjustmentsCount = await seedStockAdjustments(db, {
    tenantId,
    adminUser,
    siteRows,
    productRows,
    target: target.stockAdjustments,
    deviceId: seedDeviceId,
  });

  // ENG-052b — MEGA preset: layer 90 days of historical data on top
  // of the foundation we just built. Decoupled from the default
  // helpers above so the small-N path stays fast for tests.
  let megaCounts: import('./seed-mega/types.js').MegaCounts | null = null;
  if (preset === 'mega') {
    const { seedMegaData } = await import('./seed-mega/index.js');
    megaCounts = await seedMegaData({
      db,
      tenantId,
      companyId,
      adminUserId: adminUser.id,
    });
  }

  const counts: SeedDevCounts = {
    users: seedUsers.length,
    sites: siteRows.length,
    categories: Object.keys(categoryIds).length,
    providers: providerRows.length,
    customers: customerRows.length,
    products: productRows.length,
    receiptTemplates: Object.keys(receiptTemplateLayouts).length,
    purchases: purchasesResult + (megaCounts?.purchases ?? 0),
    sales: salesResult.sales + (megaCounts?.historicalSales ?? 0),
    quotations: quotationsCount + (megaCounts?.quotations ?? 0),
    inventoryTransfers: transfersCount + (megaCounts?.transfers ?? 0),
    cashSessions: salesResult.cashSessions + (megaCounts?.historicalCashSessions ?? 0),
    stockAdjustments: adjustmentsCount,
  };

  log.info({ counts, megaCounts }, 'dev seed complete');

  return {
    seeded: true,
    tenantId,
    companyId,
    users: seedUsers.map(u => ({
      email: u.email,
      password: DEV_USER_PASSWORD,
      name: u.name,
      role: u.role,
    })),
    sites: siteRows,
    counts,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers — preset, fixtures, insert utilities
// ---------------------------------------------------------------------------

interface PresetTarget {
  defaultProductTarget: number;
  largeProductTarget: number;
  purchasesPerSite: number;
  salesPerCashier: number;
  quotations: number;
  transfers: number;
  stockAdjustments: number;
}

function buildPreset(preset: 'default' | 'large' | 'mega'): PresetTarget {
  if (preset === 'large' || preset === 'mega') {
    // `mega` reuses the `large` foundation counts; the historical
    // depth comes from `seedMegaData()` afterward, so we don't need
    // a 3rd preset row here. The `large` baseline gives mega 500
    // products + 200 sales of "today" data — the historical layer
    // bulk-inserts the 90-day backlog on top.
    return {
      defaultProductTarget: 50,
      largeProductTarget: 500,
      purchasesPerSite: 6,
      salesPerCashier: 20,
      quotations: 10,
      transfers: 5,
      stockAdjustments: 6,
    };
  }
  return {
    defaultProductTarget: 50,
    largeProductTarget: 500,
    purchasesPerSite: 3,
    salesPerCashier: 10,
    quotations: 5,
    transfers: 3,
    stockAdjustments: 4,
  };
}

const DEV_COMPANY_TAX_ID = '900.123.456-7';

const DEV_USER_PROFILES: Array<{ email: string; name: string; role: UserRole }> = [
  { email: DEV_ADMIN_EMAIL, name: 'Administrador Demo', role: 'admin' },
  { email: 'manager.norte@demo.co', name: 'María Manager (Norte)', role: 'manager' },
  { email: 'manager.sur@demo.co', name: 'Mateo Manager (Sur)', role: 'manager' },
  { email: 'cashier.norte@demo.co', name: 'Carolina Cajera (Norte)', role: 'cashier' },
  { email: 'cashier.sur@demo.co', name: 'Camilo Cajero (Sur)', role: 'cashier' },
  { email: 'viewer@demo.co', name: 'Visor Demo', role: 'viewer' },
];

const DEV_SITES: Array<{ name: string; address: string; phone: string }> = [
  { name: 'Sede Norte', address: 'Calle 100 #10-23, Bogotá', phone: '+57 320 555 2001' },
  { name: 'Sede Sur', address: 'Cra 13 #38-45, Bogotá', phone: '+57 320 555 2002' },
];

const DEV_LOCATIONS = ['Principal', 'Bodega', 'Exhibición', 'Dañados'];

const DEV_VAT_RATES: Array<{ name: string; rate: number }> = [
  { name: 'IVA 0%', rate: 0 },
  { name: 'IVA 5%', rate: 5 },
  { name: 'IVA 19%', rate: 19 },
];

const DEV_UNITS: Array<{ name: string; abbreviation: string }> = [
  { name: 'Unidad', abbreviation: 'UND' },
  { name: 'Kilogramo', abbreviation: 'KG' },
  { name: 'Litro', abbreviation: 'LT' },
  { name: 'Gramo', abbreviation: 'GR' },
  { name: 'Paquete', abbreviation: 'PQTE' },
];

const DEV_IDENTIFICATION_TYPES: Array<{ code: string; name: string }> = [
  { code: 'CC', name: 'Cédula de ciudadanía' },
  { code: 'NIT', name: 'NIT' },
  { code: 'CE', name: 'Cédula de extranjería' },
  { code: 'PA', name: 'Pasaporte' },
  { code: 'TI', name: 'Tarjeta de identidad' },
];

const DEV_PERSON_TYPES: Array<{ code: string; name: string }> = [
  { code: 'natural', name: 'Persona natural' },
  { code: 'juridica', name: 'Persona jurídica' },
];

const DEV_REGIME_TYPES: Array<{ code: string; name: string }> = [
  { code: 'responsable_iva', name: 'Responsable de IVA' },
  { code: 'no_responsable_iva', name: 'No responsable de IVA' },
];

const DEV_CLIENT_TYPES: Array<{ code: string; name: string }> = [
  { code: 'retail', name: 'Cliente minorista' },
  { code: 'wholesale', name: 'Cliente mayorista' },
];

const DEV_COMMERCIAL_ACTIVITIES: Array<{ code: string; name: string }> = [
  { code: '4711', name: 'Comercio al por menor en establecimientos no especializados' },
  { code: '4723', name: 'Comercio al por menor de bebidas y productos del tabaco' },
];

const DEV_SEQUENTIALS = [
  { documentType: 'sale' as const, prefix: 'VTA-' },
  { documentType: 'purchase' as const, prefix: 'COM-' },
  { documentType: 'order' as const, prefix: 'PED-' },
  { documentType: 'quotation' as const, prefix: 'COT-' },
];

const DEV_CATEGORIES: Array<{ slug: string; name: string; description: string }> = [
  { slug: 'abarrotes', name: 'Abarrotes', description: 'Arroz, granos, aceites, pastas' },
  { slug: 'bebidas', name: 'Bebidas', description: 'Gaseosas, aguas, jugos, té, café' },
  { slug: 'lacteos', name: 'Lácteos', description: 'Leche, queso, yogurt, mantequilla' },
  { slug: 'panaderia', name: 'Panadería', description: 'Pan, arepas, empanadas, croissants' },
  { slug: 'carniceria', name: 'Carnicería', description: 'Res, pollo, cerdo, pescado' },
  { slug: 'limpieza', name: 'Limpieza', description: 'Detergentes, jabones, papel' },
  { slug: 'papeleria', name: 'Papelería', description: 'Cuadernos, lapiceros, útiles' },
  { slug: 'licores', name: 'Licores', description: 'Rones, cervezas, vinos, whisky' },
];

const DEV_PROVIDERS: Array<{
  name: string;
  taxId: string;
  phone: string;
  email: string;
  address: string;
  contactName: string;
}> = [
  {
    name: 'Distribuidora La Abundancia S.A.S.',
    taxId: '830.111.222-1',
    phone: '+57 601 555 3001',
    email: 'ventas@abundancia.co',
    address: 'Parque Industrial, Mosquera',
    contactName: 'Fernando Ruiz',
  },
  {
    name: 'Bebidas Andinas Ltda.',
    taxId: '830.222.333-2',
    phone: '+57 601 555 3002',
    email: 'pedidos@bebidasandinas.co',
    address: 'Av. Boyacá # 50-12, Bogotá',
    contactName: 'Laura Gómez',
  },
  {
    name: 'Lácteos El Campo',
    taxId: '900.333.444-3',
    phone: '+57 601 555 3003',
    email: 'info@elcampo.co',
    address: 'Km 5 Vía Zipaquirá',
    contactName: 'Daniel Pérez',
  },
  {
    name: 'Aseo Total S.A.',
    taxId: '900.444.555-4',
    phone: '+57 601 555 3004',
    email: 'soporte@aseototal.co',
    address: 'Cra 68 # 14-25, Bogotá',
    contactName: 'Sofía Rivera',
  },
  {
    name: 'Licores de la Sabana',
    taxId: '830.555.666-5',
    phone: '+57 601 555 3005',
    email: 'pedidos@sabanalicores.co',
    address: 'Chía, Cundinamarca',
    contactName: 'Andrés Torres',
  },
];

interface DevCustomerProfile {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  taxId: string | null;
  idTypeCode: 'CC' | 'NIT' | 'CE' | 'PA' | 'TI';
  personTypeCode: 'natural' | 'juridica';
}

const DEV_CUSTOMERS: DevCustomerProfile[] = buildCustomerFixtures();

function buildCustomerFixtures(): DevCustomerProfile[] {
  const naturalNames = [
    'Juan Pérez',
    'María López',
    'Carlos Rodríguez',
    'Ana Gómez',
    'Luis Martínez',
    'Laura Torres',
    'Jorge Ramírez',
    'Sofía Herrera',
    'Andrés Vargas',
    'Paola Jiménez',
    'Felipe Castro',
    'Valentina Díaz',
    'Daniel Morales',
    'Natalia Acosta',
    'Santiago Beltrán',
    'Camila Ortiz',
    'Diego Silva',
    'Lorena Medina',
    'Sebastián Rojas',
    'Manuela Cárdenas',
  ];
  const juridicalNames = [
    'Ferretería La 13 S.A.S.',
    'Panadería El Trigal Ltda.',
    'Restaurante Doña Lucha',
    'Droguería Salud Total',
    'Tienda Naturista Verde S.A.S.',
    'Café de los Andes S.A.S.',
    'Miscelánea Don Pedro',
  ];
  const passportNames = ['John Smith', 'María García (ES)'];

  const customers: DevCustomerProfile[] = [];
  for (let i = 0; i < naturalNames.length; i += 1) {
    const name = naturalNames[i]!;
    customers.push({
      name,
      email: `${name.toLowerCase().replace(/[^a-z]/g, '')}@correo.co`,
      phone: `+57 32${i % 10} 555 ${String(4100 + i).padStart(4, '0')}`,
      address: `Cra ${10 + (i % 30)} # ${20 + i}-${10 + i}`,
      city: 'Bogotá',
      state: 'Cundinamarca',
      postalCode: '110111',
      country: 'Colombia',
      taxId: String(1_000_000_000 + i * 37_393),
      idTypeCode: 'CC',
      personTypeCode: 'natural',
    });
  }
  for (let i = 0; i < juridicalNames.length; i += 1) {
    const name = juridicalNames[i]!;
    customers.push({
      name,
      email: `contacto@${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 10)}.co`,
      phone: `+57 601 555 ${String(5100 + i).padStart(4, '0')}`,
      address: `Av ${5 + i} # ${10 + i}-${20 + i}`,
      city: 'Bogotá',
      state: 'Cundinamarca',
      postalCode: '110111',
      country: 'Colombia',
      taxId: `8${String(30_000_000 + i * 123_457)}-${i % 10}`,
      idTypeCode: 'NIT',
      personTypeCode: 'juridica',
    });
  }
  for (let i = 0; i < passportNames.length; i += 1) {
    const name = passportNames[i]!;
    customers.push({
      name,
      email: null,
      phone: `+1 555 ${String(1000 + i).padStart(4, '0')}`,
      address: null,
      city: null,
      state: null,
      postalCode: null,
      country: i === 0 ? 'United States' : 'España',
      taxId: `P${String(10_000_000 + i)}`,
      idTypeCode: 'PA',
      personTypeCode: 'natural',
    });
  }
  // Consumidor final placeholder (anonymous sales bucket).
  customers.push({
    name: 'Consumidor final',
    email: null,
    phone: null,
    address: null,
    city: null,
    state: null,
    postalCode: null,
    country: 'Colombia',
    taxId: '222222222222',
    idTypeCode: 'CC',
    personTypeCode: 'natural',
  });
  return customers;
}

interface DevProductDefinition {
  sku: string;
  name: string;
  price: number;
  cost: number;
  baseUnit: string;
  categorySlug: string;
  vatRateName: string;
  barcode: string | null;
  initialStock: number;
  providerIndex: number;
}

function buildProductDefinitions(target: number): DevProductDefinition[] {
  const catalog: Array<Omit<DevProductDefinition, 'sku' | 'initialStock' | 'providerIndex'>> = [
    // Abarrotes (mostly 0% / 5% VAT, staple food in CO)
    { name: 'Arroz Diana 500g', price: 3200, cost: 2100, baseUnit: 'UND', categorySlug: 'abarrotes', vatRateName: 'IVA 0%', barcode: '7702011000101' },
    { name: 'Azúcar Incauca 1kg', price: 4500, cost: 3200, baseUnit: 'UND', categorySlug: 'abarrotes', vatRateName: 'IVA 0%', barcode: '7702011000102' },
    { name: 'Aceite Girasol 1L', price: 11900, cost: 8900, baseUnit: 'UND', categorySlug: 'abarrotes', vatRateName: 'IVA 19%', barcode: '7702011000103' },
    { name: 'Frijol Cargamanto 500g', price: 6400, cost: 4800, baseUnit: 'UND', categorySlug: 'abarrotes', vatRateName: 'IVA 0%', barcode: '7702011000104' },
    { name: 'Pasta Doria Espagueti', price: 3800, cost: 2700, baseUnit: 'UND', categorySlug: 'abarrotes', vatRateName: 'IVA 5%', barcode: '7702011000105' },
    { name: 'Lentejas 500g', price: 5200, cost: 3900, baseUnit: 'UND', categorySlug: 'abarrotes', vatRateName: 'IVA 0%', barcode: '7702011000106' },

    // Bebidas
    { name: 'Coca-Cola 1.5L', price: 6000, cost: 4200, baseUnit: 'UND', categorySlug: 'bebidas', vatRateName: 'IVA 19%', barcode: '7702011000201' },
    { name: 'Agua Manantial 600ml', price: 2500, cost: 1400, baseUnit: 'UND', categorySlug: 'bebidas', vatRateName: 'IVA 5%', barcode: '7702011000202' },
    { name: 'Jugo Hit Mora 1L', price: 4800, cost: 3300, baseUnit: 'UND', categorySlug: 'bebidas', vatRateName: 'IVA 19%', barcode: '7702011000203' },
    { name: 'Café Sello Rojo 250g', price: 9900, cost: 7200, baseUnit: 'UND', categorySlug: 'bebidas', vatRateName: 'IVA 0%', barcode: '7702011000204' },
    { name: 'Té Hindu 20 bolsitas', price: 5200, cost: 3700, baseUnit: 'UND', categorySlug: 'bebidas', vatRateName: 'IVA 19%', barcode: '7702011000205' },
    { name: 'Cerveza Águila 330ml', price: 3200, cost: 2200, baseUnit: 'UND', categorySlug: 'bebidas', vatRateName: 'IVA 19%', barcode: '7702011000206' },
    { name: 'Gatorade Uva 500ml', price: 4800, cost: 3400, baseUnit: 'UND', categorySlug: 'bebidas', vatRateName: 'IVA 19%', barcode: '7702011000207' },

    // Lácteos
    { name: 'Leche Alpina UHT 1L', price: 4900, cost: 3600, baseUnit: 'UND', categorySlug: 'lacteos', vatRateName: 'IVA 0%', barcode: '7702011000301' },
    { name: 'Queso Campesino 500g', price: 12800, cost: 9500, baseUnit: 'UND', categorySlug: 'lacteos', vatRateName: 'IVA 0%', barcode: '7702011000302' },
    { name: 'Yogurt Alpina Fresa 200g', price: 2800, cost: 1900, baseUnit: 'UND', categorySlug: 'lacteos', vatRateName: 'IVA 0%', barcode: '7702011000303' },
    { name: 'Mantequilla 250g', price: 6800, cost: 4900, baseUnit: 'UND', categorySlug: 'lacteos', vatRateName: 'IVA 0%', barcode: '7702011000304' },
    { name: 'Crema de leche 250ml', price: 4200, cost: 2900, baseUnit: 'UND', categorySlug: 'lacteos', vatRateName: 'IVA 0%', barcode: '7702011000305' },
    { name: 'Kumis Colanta 1L', price: 6300, cost: 4500, baseUnit: 'UND', categorySlug: 'lacteos', vatRateName: 'IVA 0%', barcode: '7702011000306' },

    // Panadería
    { name: 'Pan tajado integral', price: 5400, cost: 3700, baseUnit: 'UND', categorySlug: 'panaderia', vatRateName: 'IVA 0%', barcode: '7702011000401' },
    { name: 'Arepa Paisa x5', price: 6500, cost: 4400, baseUnit: 'PQTE', categorySlug: 'panaderia', vatRateName: 'IVA 0%', barcode: '7702011000402' },
    { name: 'Empanada de carne', price: 2800, cost: 1600, baseUnit: 'UND', categorySlug: 'panaderia', vatRateName: 'IVA 8%', barcode: null },
    { name: 'Pan Francés', price: 1200, cost: 600, baseUnit: 'UND', categorySlug: 'panaderia', vatRateName: 'IVA 0%', barcode: null },
    { name: 'Croissant', price: 3800, cost: 2200, baseUnit: 'UND', categorySlug: 'panaderia', vatRateName: 'IVA 0%', barcode: null },
    { name: 'Buñuelo', price: 1500, cost: 800, baseUnit: 'UND', categorySlug: 'panaderia', vatRateName: 'IVA 0%', barcode: null },

    // Carnicería
    { name: 'Carne de res molida 500g', price: 16800, cost: 12500, baseUnit: 'KG', categorySlug: 'carniceria', vatRateName: 'IVA 0%', barcode: null },
    { name: 'Pollo entero 2kg', price: 19500, cost: 13900, baseUnit: 'KG', categorySlug: 'carniceria', vatRateName: 'IVA 0%', barcode: null },
    { name: 'Chicharrón 500g', price: 14200, cost: 10700, baseUnit: 'KG', categorySlug: 'carniceria', vatRateName: 'IVA 0%', barcode: null },
    { name: 'Chorizo paisa x6', price: 9800, cost: 7100, baseUnit: 'PQTE', categorySlug: 'carniceria', vatRateName: 'IVA 0%', barcode: '7702011000503' },
    { name: 'Tilapia fresca 500g', price: 18200, cost: 13800, baseUnit: 'KG', categorySlug: 'carniceria', vatRateName: 'IVA 0%', barcode: null },
    { name: 'Costilla de cerdo 1kg', price: 22500, cost: 16900, baseUnit: 'KG', categorySlug: 'carniceria', vatRateName: 'IVA 0%', barcode: null },
    { name: 'Lomo fino de res 1kg', price: 38900, cost: 29800, baseUnit: 'KG', categorySlug: 'carniceria', vatRateName: 'IVA 0%', barcode: null },

    // Limpieza
    { name: 'Detergente Fab 1kg', price: 11500, cost: 8200, baseUnit: 'UND', categorySlug: 'limpieza', vatRateName: 'IVA 19%', barcode: '7702011000601' },
    { name: 'Jabón Rey x3', price: 7200, cost: 4900, baseUnit: 'PQTE', categorySlug: 'limpieza', vatRateName: 'IVA 19%', barcode: '7702011000602' },
    { name: 'Limpiador multiusos 1L', price: 6800, cost: 4200, baseUnit: 'UND', categorySlug: 'limpieza', vatRateName: 'IVA 19%', barcode: '7702011000603' },
    { name: 'Papel Higiénico x12', price: 18500, cost: 13400, baseUnit: 'PQTE', categorySlug: 'limpieza', vatRateName: 'IVA 19%', barcode: '7702011000604' },
    { name: 'Blanqueador 2L', price: 7900, cost: 5100, baseUnit: 'UND', categorySlug: 'limpieza', vatRateName: 'IVA 19%', barcode: '7702011000605' },
    { name: 'Esponja Scotch-Brite x2', price: 4800, cost: 3100, baseUnit: 'PQTE', categorySlug: 'limpieza', vatRateName: 'IVA 19%', barcode: '7702011000606' },

    // Papelería
    { name: 'Cuaderno cuadros 100h', price: 6500, cost: 4100, baseUnit: 'UND', categorySlug: 'papeleria', vatRateName: 'IVA 19%', barcode: '7702011000701' },
    { name: 'Lapicero BIC azul', price: 2200, cost: 1200, baseUnit: 'UND', categorySlug: 'papeleria', vatRateName: 'IVA 19%', barcode: '7702011000702' },
    { name: 'Borrador Pelikan', price: 1800, cost: 900, baseUnit: 'UND', categorySlug: 'papeleria', vatRateName: 'IVA 19%', barcode: '7702011000703' },
    { name: 'Regla 30cm', price: 3500, cost: 2100, baseUnit: 'UND', categorySlug: 'papeleria', vatRateName: 'IVA 19%', barcode: '7702011000704' },
    { name: 'Tijeras escolares', price: 6800, cost: 4400, baseUnit: 'UND', categorySlug: 'papeleria', vatRateName: 'IVA 19%', barcode: '7702011000705' },
    { name: 'Pegante barra Pritt', price: 4200, cost: 2700, baseUnit: 'UND', categorySlug: 'papeleria', vatRateName: 'IVA 19%', barcode: '7702011000706' },

    // Licores
    { name: 'Ron Medellín Añejo 3 años 750ml', price: 49900, cost: 34900, baseUnit: 'UND', categorySlug: 'licores', vatRateName: 'IVA 19%', barcode: '7702011000801' },
    { name: 'Aguardiente Antioqueño 750ml', price: 39900, cost: 27500, baseUnit: 'UND', categorySlug: 'licores', vatRateName: 'IVA 19%', barcode: '7702011000802' },
    { name: 'Cerveza Club Colombia 330ml', price: 4200, cost: 2800, baseUnit: 'UND', categorySlug: 'licores', vatRateName: 'IVA 19%', barcode: '7702011000803' },
    { name: 'Vodka Smirnoff 700ml', price: 69900, cost: 48500, baseUnit: 'UND', categorySlug: 'licores', vatRateName: 'IVA 19%', barcode: '7702011000804' },
    { name: 'Whisky Old Parr 750ml', price: 189900, cost: 139900, baseUnit: 'UND', categorySlug: 'licores', vatRateName: 'IVA 19%', barcode: '7702011000805' },
    { name: 'Gin Beefeater 700ml', price: 95000, cost: 68900, baseUnit: 'UND', categorySlug: 'licores', vatRateName: 'IVA 19%', barcode: '7702011000806' },
  ];

  // Assign initial stock deterministically: first product of each
  // category gets 0 (exercise stockout flows), the next few get
  // moderate stock, the rest high stock.
  const definitions: DevProductDefinition[] = [];
  const stockPattern = [0, 12, 28, 45, 72, 110, 180, 40, 95];
  for (let i = 0; i < catalog.length; i += 1) {
    const base = catalog[i]!;
    definitions.push({
      ...base,
      sku: buildSku(base.categorySlug, i),
      initialStock: stockPattern[i % stockPattern.length]!,
      providerIndex: i % 5,
    });
  }

  // Large preset: generate synthetic extra products until we reach
  // the target. Cost+price derive deterministically so outputs stay
  // stable across runs.
  for (let i = definitions.length; i < target; i += 1) {
    const base = catalog[i % catalog.length]!;
    const suffix = Math.floor(i / catalog.length) + 1;
    const stock = stockPattern[i % stockPattern.length]!;
    definitions.push({
      ...base,
      name: `${base.name} v${suffix}`,
      sku: buildSku(base.categorySlug, i),
      initialStock: stock,
      providerIndex: i % 5,
    });
  }

  return definitions.slice(0, target);
}

/**
 * Map a site name to a short unique suffix (1 letter, upper-cased)
 * for document-number prefixes. Falls back to a numeric index if two
 * sites happen to share a first letter (unlikely in this seed, but
 * safe under `--preset=large` or future extensions).
 */
function deriveSiteSequentialSuffix(name: string, index: number): string {
  const words = name.split(/\s+/).filter(Boolean);
  const candidate = words.length >= 2 ? words[1]! : words[0] ?? '';
  const firstLetter = candidate.charAt(0).toUpperCase();
  if (firstLetter.match(/[A-Z]/)) {
    return firstLetter;
  }
  return String(index + 1);
}

function buildSku(categorySlug: string, index: number): string {
  const prefixes: Record<string, string> = {
    abarrotes: 'ABR',
    bebidas: 'BEB',
    lacteos: 'LAC',
    panaderia: 'PAN',
    carniceria: 'CAR',
    limpieza: 'LIM',
    papeleria: 'PAP',
    licores: 'LIC',
  };
  const prefix = prefixes[categorySlug] ?? 'GEN';
  return `${prefix}-${String(index + 1).padStart(4, '0')}`;
}

async function insertProductRow(
  db: DatabaseInstance,
  args: {
    id: string;
    tenantId: string;
    now: string;
    def: DevProductDefinition;
    categoryId: string;
    vatRateId: string;
    locationId: string;
    unitIds: Record<string, string>;
    defaultProviderId: string;
  }
): Promise<void> {
  const { products, unitXProduct, productXProvider } = await import('./schema.js');
  const { id, tenantId, now, def, categoryId, vatRateId, locationId, unitIds, defaultProviderId } = args;
  const baseUnitId = unitIds[def.baseUnit]!;
  // Cost → price margin math is computed upstream in the service; for
  // the seed we store the raw cost and let margin fields stay 0 so
  // the product edit page shows an honest "no margin configured" state
  // until the operator tweaks it.
  await db
    .insert(products)
    .values({
      id,
      tenantId,
      categoryId,
      providerId: defaultProviderId,
      vatRateId,
      locationId,
      sku: def.sku,
      name: def.name,
      description: null,
      price: def.price,
      price2: Math.round(def.price * 1.05),
      price3: Math.round(def.price * 1.1),
      cost: def.cost,
      initialCost: def.cost,
      marginPercent1: 0,
      marginPercent2: 0,
      marginPercent3: 0,
      marginAmount1: 0,
      marginAmount2: 0,
      marginAmount3: 0,
      taxRate: def.vatRateName === 'IVA 19%' ? 19 : def.vatRateName === 'IVA 5%' ? 5 : 0,
      // products.stock is maintained by syncProductsStockFromBalances
      // at the end of the seed, so leave it at 0 here and let the sum
      // of inventory_balances.onHand populate it in one pass.
      stock: 0,
      minStock: 5,
      sellByFraction: false,
      fractionStep: null,
      fractionMinimum: null,
      barcode: def.barcode,
      imageUrl: null,
      isActive: true,
      syncStatus: 'pending',
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  await db
    .insert(unitXProduct)
    .values({
      id: nanoid(),
      productId: id,
      unitId: baseUnitId,
      equivalence: 1,
      price: def.price,
      isBase: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  await db
    .insert(productXProvider)
    .values({
      id: nanoid(),
      productId: id,
      providerId: defaultProviderId,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

async function seedInitialBalances(
  db: DatabaseInstance,
  tenantId: string,
  productRows: Array<{ id: string; initialStock: number }>,
  siteRows: SeedDevSite[],
  createdBy: string,
  now: string
): Promise<void> {
  const { inventoryBalances, inventoryMovements } = await import('./schema.js');
  for (const product of productRows) {
    // 60/40 split between primary and secondary site, with every
    // product also getting at least 1 row per site so the inventory
    // page lists both balances.
    const primaryShare = Math.ceil(product.initialStock * 0.6);
    const secondaryShare = product.initialStock - primaryShare;
    const shares = [primaryShare, secondaryShare];
    for (let i = 0; i < siteRows.length; i += 1) {
      const site = siteRows[i]!;
      const onHand = shares[i] ?? 0;
      await db
        .insert(inventoryBalances)
        .values({
          id: nanoid(),
          tenantId,
          siteId: site.id,
          productId: product.id,
          onHand,
          reserved: 0,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      if (onHand > 0) {
        // Also record an "initial" movement so the inventory
        // movements page has something to show and reports can
        // distinguish "pre-seed" stock from sales/purchases. The
        // movement is attributed to the admin who owns the seed.
        await db
          .insert(inventoryMovements)
          .values({
            id: nanoid(),
            tenantId,
            productId: product.id,
            type: 'adjustment',
            quantity: onHand,
            previousStock: 0,
            newStock: onHand,
            reference: 'dev-seed-initial',
            notes: 'Existencias iniciales (dev seed)',
            createdBy,
            syncStatus: 'pending',
            syncVersion: 1,
            createdAt: now,
          })
          .run();
      }
    }
  }
}

async function syncProductsStockFromBalances(
  db: DatabaseInstance,
  tenantId: string
): Promise<void> {
  // One SQL pass to set `products.stock` to Σ(on_hand) per product.
  // Matches the invariant maintained by the sales/purchase services.
  const { products, inventoryBalances } = await import('./schema.js');
  const rows = await db
    .select({
      productId: inventoryBalances.productId,
      total: sql<number>`COALESCE(SUM(${inventoryBalances.onHand}), 0)`,
    })
    .from(inventoryBalances)
    .where(eq(inventoryBalances.tenantId, tenantId))
    .groupBy(inventoryBalances.productId)
    .all();
  for (const row of rows) {
    await db
      .update(products)
      .set({ stock: row.total })
      .where(eq(products.id, row.productId))
      .run();
  }
}

// ---------------------------------------------------------------------------
// tRPC-backed insert helpers (historical purchases, sales, quotations, etc.)
// ---------------------------------------------------------------------------

function buildContext(
  db: DatabaseInstance,
  args: {
    user: SeedUser;
    tenantId: string;
    siteId: string | null;
    deviceId?: string | null;
  }
): Context {
  // We emulate the context that the Fastify layer would build at
  // request time; tRPC callers only touch a small subset (db, user,
  // tenantId, siteId) so the Fastify request/reply cast is fine.
  return {
    req: {
      server: { db } as unknown,
      headers: makeEnvelopeHeadersProxy({
        getDeviceId: () => args.deviceId,
        getSiteId: () => args.siteId,
      }),
      user: {
        userId: args.user.id,
        email: args.user.email,
        role: args.user.role,
        tenantId: args.tenantId,
      },
      jwtVerify: async () => {},
    } as unknown as Context['req'],
    res: {} as Context['res'],
    db,
    user: {
      id: args.user.id,
      email: args.user.email,
      role: args.user.role,
      tenantId: args.tenantId,
    },
    tenantId: args.tenantId,
    siteId: args.siteId,
  };
}

interface SeedUser {
  id: string;
  email: string;
  role: UserRole;
}

async function seedPurchases(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    adminUser: SeedUser;
    siteRows: SeedDevSite[];
    providerRows: Array<{ id: string; name: string }>;
    productRows: Array<{ id: string; sku: string; baseUnitId: string; cost: number }>;
    unitIds: Record<string, string>;
    targetPerSite: number;
    deviceId: string;
  }
): Promise<number> {
  let count = 0;
  for (const site of args.siteRows) {
    const caller = appRouter.createCaller(
      buildContext(db, {
        user: args.adminUser,
        tenantId: args.tenantId,
        siteId: site.id,
        deviceId: args.deviceId,
      })
    );
    for (let i = 0; i < args.targetPerSite; i += 1) {
      const provider = args.providerRows[i % args.providerRows.length]!;
      // 2–4 products per purchase, picked from deterministic offsets
      // so the seed stays stable across runs.
      const itemCount = 2 + (i % 3);
      const items = [];
      for (let j = 0; j < itemCount; j += 1) {
        const product = args.productRows[(i * 5 + j) % args.productRows.length]!;
        items.push({
          productId: product.id,
          unitId: product.baseUnitId,
          quantity: 10 + ((i + j) % 30),
          costPerUnit: product.cost,
        });
      }
      try {
        await caller.purchases.create({ providerId: provider.id, items });
        count += 1;
      } catch (error) {
        log.warn({ err: error, site: site.name }, 'dev seed purchase skipped');
      }
    }
  }
  return count;
}

async function seedSales(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    adminUser: SeedUser;
    cashierUsers: SeedUser[];
    siteRows: SeedDevSite[];
    customerRows: Array<{ id: string; name: string }>;
    productRows: Array<{
      id: string;
      sku: string;
      baseUnitId: string;
      price: number;
      initialStock: number;
    }>;
    unitIds: Record<string, string>;
    targetPerCashier: number;
    deviceId: string;
  }
): Promise<{ sales: number; cashSessions: number }> {
  // Only pick from products that have real stock to minimize stockout
  // churn during the historical batch. Stockout products stay in the
  // catalog so the inventory page exercises the "sin stock" banner,
  // but the seed does not try to sell them.
  const sellableProducts = args.productRows.filter(p => p.initialStock > 0);
  const products = sellableProducts.length > 0 ? sellableProducts : args.productRows;
  let salesCount = 0;
  let sessionsCount = 0;
  // Pair each cashier with a site. If there are fewer cashiers than
  // sites, cycle; if more, the extra cashiers also round-robin so
  // every site has at least one cashier-session.
  for (let i = 0; i < args.cashierUsers.length; i += 1) {
    const cashier = args.cashierUsers[i]!;
    const site = args.siteRows[i % args.siteRows.length]!;
    const caller = appRouter.createCaller(
      buildContext(db, {
        user: cashier,
        tenantId: args.tenantId,
        siteId: site.id,
        deviceId: args.deviceId,
      })
    );
    const registerName = `Caja ${cashier.email.split('@')[0]}`;
    // Split the target into two sessions: one closed (historical) and
    // one open (current shift). The UI then has something in both
    // states for report / dashboard testing.
    const closedTarget = Math.floor(args.targetPerCashier * 0.6);
    const openTarget = args.targetPerCashier - closedTarget;

    // Session 1 — closed historical shift
    try {
      await caller.cashSessions.open({
        registerName,
        openingFloat: 100_000,
        denominations: [{ value: 50_000, count: 2 }],
      });
      sessionsCount += 1;
      salesCount += await runSalesBatch(caller, {
        count: closedTarget,
        customers: args.customerRows,
        products,
        cashierIndex: i,
      });
      await caller.cashSessions.close({
        actualCount: 100_000,
        denominations: [{ value: 50_000, count: 2 }],
      });
    } catch (error) {
      log.warn({ err: error, cashier: cashier.email }, 'dev seed historical session failed');
    }

    // Session 2 — still open so the dashboard shows active cash
    try {
      await caller.cashSessions.open({
        registerName: `${registerName} (actual)`,
        openingFloat: 150_000,
        denominations: [{ value: 50_000, count: 3 }],
      });
      sessionsCount += 1;
      salesCount += await runSalesBatch(caller, {
        count: openTarget,
        customers: args.customerRows,
        products,
        cashierIndex: i + args.cashierUsers.length,
      });
    } catch (error) {
      log.warn({ err: error, cashier: cashier.email }, 'dev seed active session failed');
    }
  }
  return { sales: salesCount, cashSessions: sessionsCount };
}

async function runSalesBatch(
  caller: ReturnType<typeof appRouter.createCaller>,
  args: {
    count: number;
    customers: Array<{ id: string; name: string }>;
    products: Array<{ id: string; sku: string; baseUnitId: string; price: number }>;
    cashierIndex: number;
  }
): Promise<number> {
  let created = 0;
  for (let i = 0; i < args.count; i += 1) {
    // Mix of sale shapes:
    //  - every third sale uses a split tender (cash + card)
    //  - every fifth uses no customer (consumidor final path — null)
    //  - line count varies 1–3 items
    const useSplit = i % 3 === 0;
    const noCustomer = i % 5 === 0;
    const itemCount = 1 + (i % 3);
    const items = [];
    let subtotalEstimate = 0;
    for (let j = 0; j < itemCount; j += 1) {
      const product =
        args.products[
          (args.cashierIndex * 7 + i * 3 + j) % args.products.length
        ]!;
      const quantity = 1 + (j % 3);
      items.push({
        productId: product.id,
        unitId: product.baseUnitId,
        quantity,
        unitPrice: product.price,
        discount: 0,
      });
      subtotalEstimate += quantity * product.price;
    }
    try {
      if (useSplit) {
        const cashPart = Math.round(subtotalEstimate * 0.6);
        const cardPart = subtotalEstimate - cashPart;
        await caller.sales.create({
          customerId: noCustomer ? undefined : args.customers[i % args.customers.length]!.id,
          items,
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          status: 'completed',
          discountAmount: 0,
          payments: [
            { method: 'cash', amount: cashPart },
            { method: 'card', amount: cardPart, reference: `AUTH-${String(1000 + i).padStart(6, '0')}` },
          ],
        });
      } else {
        await caller.sales.create({
          customerId: noCustomer ? undefined : args.customers[i % args.customers.length]!.id,
          items,
          paymentMethod: 'cash',
          paymentStatus: 'paid',
          status: 'completed',
          discountAmount: 0,
          amountReceived: subtotalEstimate,
        });
      }
      created += 1;
    } catch (error) {
      // Stockouts are expected for some products (preset seeds a 0
      // initial stock for the first product of every category). The
      // seed should log + continue so one stockout doesn't abort the
      // rest of the shift.
      log.warn({ err: error, index: i }, 'dev seed sale skipped');
    }
  }
  return created;
}

async function seedQuotations(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    adminUser: SeedUser;
    siteRows: SeedDevSite[];
    customerRows: Array<{ id: string; name: string }>;
    productRows: Array<{ id: string; sku: string; baseUnitId: string; price: number }>;
    unitIds: Record<string, string>;
    target: number;
    deviceId: string;
  }
): Promise<number> {
  const caller = appRouter.createCaller(
    buildContext(db, {
      user: args.adminUser,
      tenantId: args.tenantId,
      siteId: args.siteRows[0]!.id,
      deviceId: args.deviceId,
    })
  );
  let count = 0;
  for (let i = 0; i < args.target; i += 1) {
    const product1 = args.productRows[i % args.productRows.length]!;
    const product2 = args.productRows[(i + 3) % args.productRows.length]!;
    try {
      const quote = await caller.quotations.create({
        customerId: args.customerRows[i % args.customerRows.length]!.id,
        items: [
          {
            productId: product1.id,
            quantity: 2 + (i % 4),
            unitPrice: product1.price,
            discount: 0,
            taxRate: 0,
          },
          {
            productId: product2.id,
            quantity: 1 + (i % 3),
            unitPrice: product2.price,
            discount: i % 2 === 0 ? 5 : 0,
            taxRate: 0,
          },
        ],
        notes: `Cotización de muestra #${i + 1}`,
      });
      // Distribute across states so the page shows every filter
      // meaningfully: draft → sent → accepted → rejected → expired.
      const targetState = ['sent', 'accepted', 'rejected', 'expired', 'sent'][i % 5]!;
      if (targetState !== 'draft') {
        await caller.quotations.updateStatus({ id: quote.id, status: 'sent' });
        if (targetState !== 'sent') {
          await caller.quotations.updateStatus({
            id: quote.id,
            status: targetState as 'accepted' | 'rejected' | 'expired',
          });
        }
      }
      count += 1;
    } catch (error) {
      log.warn({ err: error, index: i }, 'dev seed quotation skipped');
    }
  }
  return count;
}

async function seedTransfers(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    adminUser: SeedUser;
    siteRows: SeedDevSite[];
    productRows: Array<{ id: string; sku: string }>;
    target: number;
    deviceId: string;
  }
): Promise<number> {
  const caller = appRouter.createCaller(
    buildContext(db, {
      user: args.adminUser,
      tenantId: args.tenantId,
      siteId: args.siteRows[0]!.id,
      deviceId: args.deviceId,
    })
  );
  let count = 0;
  for (let i = 0; i < args.target; i += 1) {
    const fromSite = args.siteRows[i % args.siteRows.length]!;
    const toSite = args.siteRows[(i + 1) % args.siteRows.length]!;
    if (fromSite.id === toSite.id) continue;
    const product = args.productRows[(i * 4) % args.productRows.length]!;
    try {
      await caller.transfers.create({
        fromSiteId: fromSite.id,
        toSiteId: toSite.id,
        items: [{ productId: product.id, quantity: 2 + (i % 5) }],
        notes: `Traslado demo ${i + 1}`,
      });
      count += 1;
    } catch (error) {
      log.warn({ err: error, index: i }, 'dev seed transfer skipped');
    }
  }
  return count;
}

async function seedStockAdjustments(
  db: DatabaseInstance,
  args: {
    tenantId: string;
    adminUser: SeedUser;
    siteRows: SeedDevSite[];
    productRows: Array<{ id: string; sku: string }>;
    target: number;
    deviceId: string;
  }
): Promise<number> {
  let count = 0;
  for (let i = 0; i < args.target; i += 1) {
    const site = args.siteRows[i % args.siteRows.length]!;
    const product = args.productRows[(i * 6) % args.productRows.length]!;
    const caller = appRouter.createCaller(
      buildContext(db, {
        user: args.adminUser,
        tenantId: args.tenantId,
        siteId: site.id,
        deviceId: args.deviceId,
      })
    );
    try {
      // Bump stock by a small amount so the audit row has a non-zero
      // delta and the inventory invariant stays positive.
      const { products } = await import('./schema.js');
      const current = await db
        .select({ stock: products.stock })
        .from(products)
        .where(eq(products.id, product.id))
        .get();
      const baseline = current?.stock ?? 0;
      const newStock = Math.max(0, baseline + (i % 2 === 0 ? 5 : -3));
      await caller.inventory.adjustStock({
        productId: product.id,
        newStock,
        notes: `Ajuste demo ${i + 1}`,
        siteId: site.id,
      });
      count += 1;
    } catch (error) {
      log.warn({ err: error, index: i }, 'dev seed stock adjustment skipped');
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Receipt template default layouts for the seed
// ---------------------------------------------------------------------------

function buildDefaultReceiptLayouts(): Record<
  'sale' | 'quotation' | 'fiscal_dee',
  { name: string; layout: ReceiptLayout }
> {
  return {
    sale: {
      name: 'Recibo de venta — 80mm',
      layout: {
        paperWidth: '80mm',
        blocks: [
          { type: 'logo', align: 'center', maxHeightMm: 18 },
          { type: 'text', value: '{{company.name}}', style: 'title', align: 'center' },
          { type: 'text', value: 'NIT {{company.taxId}}', style: 'muted', align: 'center' },
          { type: 'text', value: '{{company.address}}', style: 'muted', align: 'center' },
          { type: 'separator' },
          { type: 'text', value: 'Venta {{sale.saleNumber}}' },
          { type: 'text', value: 'Cajero: {{sale.cashier}}', style: 'muted' },
          { type: 'text', value: 'Cliente: {{sale.customer}}', style: 'muted' },
          { type: 'separator' },
          { type: 'itemsTable', columns: ['name', 'qty', 'unitPrice', 'total'] },
          { type: 'separator' },
          { type: 'totalsBlock', show: ['subtotal', 'taxTotal', 'grandTotal'] },
          { type: 'separator' },
          { type: 'tendersTable', showChange: true },
          { type: 'separator' },
          { type: 'text', value: 'Gracias por tu compra', align: 'center', style: 'muted' },
          // ENG-016 pass 1 (item #5) — Puntovivo-branded footer block.
          // Admins can toggle `show: false` to hide without deleting.
          { type: 'appFooter', show: true, align: 'center' },
        ],
      },
    },
    quotation: {
      name: 'Cotización — Carta',
      layout: {
        paperWidth: 'letter',
        blocks: [
          { type: 'text', value: '{{company.name}}', style: 'title', align: 'center' },
          { type: 'text', value: 'Cotización {{sale.saleNumber}}', style: 'subtitle', align: 'center' },
          { type: 'text', value: 'Cliente: {{sale.customer}}' },
          { type: 'separator' },
          {
            type: 'itemsTable',
            columns: ['name', 'qty', 'unitPrice', 'discount', 'total'],
          },
          { type: 'separator' },
          { type: 'totalsBlock', show: ['subtotal', 'discount', 'taxTotal', 'grandTotal'] },
          { type: 'appFooter', show: true, align: 'center' },
        ],
      },
    },
    fiscal_dee: {
      name: 'DEE fiscal placeholder — 80mm',
      layout: {
        paperWidth: '80mm',
        blocks: [
          { type: 'text', value: '{{company.name}}', style: 'title', align: 'center' },
          { type: 'text', value: 'NIT {{company.taxId}}', style: 'muted', align: 'center' },
          { type: 'text', value: 'Resolución {{fiscal.resolution}}', style: 'muted', align: 'center' },
          { type: 'separator' },
          { type: 'text', value: '{{fiscal.documentNumber}}', style: 'subtitle', align: 'center' },
          { type: 'separator' },
          { type: 'itemsTable', columns: ['name', 'qty', 'unitPrice', 'taxPercent', 'total'] },
          { type: 'totalsBlock', show: ['subtotal', 'taxTotal', 'grandTotal'] },
          { type: 'separator' },
          { type: 'qr', source: '{{fiscal.qrUrl}}', sizeMm: 25 },
          { type: 'text', value: 'CUFE {{fiscal.cufe}}', style: 'monospace', align: 'center' },
          { type: 'appFooter', show: true, align: 'center' },
        ],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Tenant summary for the idempotent short-circuit branch
// ---------------------------------------------------------------------------

async function summarizeTenant(
  db: DatabaseInstance,
  tenantId: string
): Promise<{ companyId: string; counts: SeedDevCounts }> {
  const {
    products,
    purchases,
    sales,
    quotations,
    transferOrders,
    cashSessions,
  } = await import('./schema.js');
  const [company, catCount, provCount, custCount, prodCount, siteCount, saleCount, purchCount, quoteCount, trCount, sessCount, tplCount, userCount] = await Promise.all([
    db.select({ id: companies.id }).from(companies).where(eq(companies.tenantId, tenantId)).get(),
    db.select({ c: sql<number>`count(*)` }).from(categories).where(eq(categories.tenantId, tenantId)).get(),
    db.select({ c: sql<number>`count(*)` }).from(providers).where(eq(providers.tenantId, tenantId)).get(),
    db.select({ c: sql<number>`count(*)` }).from(customers).where(eq(customers.tenantId, tenantId)).get(),
    db.select({ c: sql<number>`count(*)` }).from(products).where(eq(products.tenantId, tenantId)).get(),
    db.select({ c: sql<number>`count(*)` }).from(sites).where(eq(sites.tenantId, tenantId)).get(),
    db.select({ c: sql<number>`count(*)` }).from(sales).where(eq(sales.tenantId, tenantId)).get(),
    db.select({ c: sql<number>`count(*)` }).from(purchases).where(eq(purchases.tenantId, tenantId)).get(),
    db.select({ c: sql<number>`count(*)` }).from(quotations).where(eq(quotations.tenantId, tenantId)).get(),
    db.select({ c: sql<number>`count(*)` }).from(transferOrders).where(eq(transferOrders.tenantId, tenantId)).get(),
    db.select({ c: sql<number>`count(*)` }).from(cashSessions).where(eq(cashSessions.tenantId, tenantId)).get(),
    db.select({ c: sql<number>`count(*)` }).from((await import('./schema.js')).receiptTemplates).where(eq((await import('./schema.js')).receiptTemplates.tenantId, tenantId)).get(),
    db.select({ c: sql<number>`count(*)` }).from(users).where(eq(users.tenantId, tenantId)).get(),
  ]);
  return {
    companyId: company?.id ?? '',
    counts: {
      users: userCount?.c ?? 0,
      sites: siteCount?.c ?? 0,
      categories: catCount?.c ?? 0,
      providers: provCount?.c ?? 0,
      customers: custCount?.c ?? 0,
      products: prodCount?.c ?? 0,
      receiptTemplates: tplCount?.c ?? 0,
      purchases: purchCount?.c ?? 0,
      sales: saleCount?.c ?? 0,
      quotations: quoteCount?.c ?? 0,
      inventoryTransfers: trCount?.c ?? 0,
      cashSessions: sessCount?.c ?? 0,
      stockAdjustments: 0,
    },
  };
}

// Silence unused-import warning for `and` until the service uses it.
void and;
