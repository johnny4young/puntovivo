import { and, count, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import type { VerticalPresetId } from '../../../services/modules/presets.js';
import { VERTICAL_PRESET_IDS } from '../../../services/modules/presets.js';
import type { DatabaseInstance } from '../../../db/index.js';
import {
  inventoryTransformationRecipes,
  kdsStations,
  pharmacyProfessionalAuthorizations,
  pharmacyProductProfiles,
  products,
  restaurantTables,
  sitePeripherals,
  tenants,
  units,
  unitXProduct,
  users,
} from '../../../db/schema.js';
import { resolveModulesState } from '../../../services/modules/manifest.js';
import { resolvePharmacyPolicy } from '../../../services/pharmacy/policy.js';
import { wedgeScannerConfigSchema } from '../../../services/peripherals/drivers/keyboard-wedge-scanner.js';
import { resolveTenantBusinessClock } from '../../../services/pharmacy/business-clock.js';
import { inspectPharmacyAuthorizationSnapshot } from '../../../application/pharmacy/authorizations.js';
import type {
  VerticalReadinessCheckId,
  VerticalReadinessOutput,
  VerticalReadinessProfile,
} from '../../schemas/setupReadiness.js';

type ReadinessCheck = VerticalReadinessOutput['checks'][number];

function profileFor(businessType: VerticalPresetId | null): VerticalReadinessProfile | null {
  if (businessType === null) return null;
  if (businessType === 'pharmacy' || businessType === 'hardware' || businessType === 'butchery') {
    return businessType;
  }
  if (businessType === 'restaurant' || businessType === 'quickservice') return 'restaurant';
  return 'retail';
}

function check(
  id: VerticalReadinessCheckId,
  status: ReadinessCheck['status'],
  configuredCount: number,
  cta: ReadinessCheck['cta']
): ReadinessCheck {
  return { id, status, configuredCount: Math.max(0, Math.trunc(configuredCount)), cta };
}

function configured(
  id: VerticalReadinessCheckId,
  configuredCount: number,
  cta: NonNullable<ReadinessCheck['cta']>
): ReadinessCheck {
  return check(id, configuredCount > 0 ? 'ready' : 'attention', configuredCount, cta);
}

/**
 * Build a tenant-scoped, non-blocking checklist from existing source tables.
 * Counts are evidence, not certification: no row is created or inferred here.
 */
export async function buildVerticalReadiness(args: {
  db: DatabaseInstance;
  tenantId: string;
  businessDate?: string;
}): Promise<VerticalReadinessOutput> {
  const clock = await resolveTenantBusinessClock(args.db, args.tenantId);
  const businessDate = args.businessDate ?? clock.businessDate;
  const [tenantRow, productSignals, unitSignals, pharmacySignals, authSignals] = await Promise.all([
    args.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, args.tenantId))
      .get(),
    args.db
      .select({
        total: count(products.id),
        fractional:
          sql<number>`coalesce(sum(case when ${products.sellByFraction} = 1 then 1 else 0 end), 0)`.mapWith(
            Number
          ),
        lots: sql<number>`coalesce(sum(case when ${products.tracksLots} = 1 then 1 else 0 end), 0)`.mapWith(
          Number
        ),
        serials:
          sql<number>`coalesce(sum(case when ${products.tracksSerials} = 1 then 1 else 0 end), 0)`.mapWith(
            Number
          ),
      })
      .from(products)
      .where(and(eq(products.tenantId, args.tenantId), eq(products.isActive, true)))
      .get(),
    args.db
      .select({ total: sql<number>`count(distinct ${products.id})`.mapWith(Number) })
      .from(products)
      .innerJoin(unitXProduct, eq(unitXProduct.productId, products.id))
      .innerJoin(
        units,
        and(
          eq(units.id, unitXProduct.unitId),
          eq(units.tenantId, args.tenantId),
          eq(units.isActive, true)
        )
      )
      .where(and(eq(products.tenantId, args.tenantId), eq(products.isActive, true)))
      .get(),
    args.db
      .select({
        classification: pharmacyProductProfiles.classification,
        total: count(pharmacyProductProfiles.productId),
        lotTracked:
          sql<number>`coalesce(sum(case when ${products.tracksLots} = 1 then 1 else 0 end), 0)`.mapWith(
            Number
          ),
        registered:
          sql<number>`coalesce(sum(case when length(trim(coalesce(${pharmacyProductProfiles.sanitaryRegistration}, ''))) > 0 and (${pharmacyProductProfiles.registrationExpiresAt} is null or ${pharmacyProductProfiles.registrationExpiresAt} >= ${businessDate}) then 1 else 0 end), 0)`.mapWith(
            Number
          ),
        unexpired:
          sql<number>`coalesce(sum(case when ${pharmacyProductProfiles.registrationExpiresAt} is null or ${pharmacyProductProfiles.registrationExpiresAt} >= ${businessDate} then 1 else 0 end), 0)`.mapWith(
            Number
          ),
      })
      .from(pharmacyProductProfiles)
      .innerJoin(
        products,
        and(
          eq(products.id, pharmacyProductProfiles.productId),
          eq(products.tenantId, pharmacyProductProfiles.tenantId)
        )
      )
      .where(and(eq(pharmacyProductProfiles.tenantId, args.tenantId), eq(products.isActive, true)))
      .groupBy(pharmacyProductProfiles.classification)
      .all(),
    args.db
      .select({
        id: pharmacyProfessionalAuthorizations.id,
        tenantId: pharmacyProfessionalAuthorizations.tenantId,
        userId: pharmacyProfessionalAuthorizations.userId,
        userIsActive: users.isActive,
        siteId: pharmacyProfessionalAuthorizations.siteId,
        countryCode: pharmacyProfessionalAuthorizations.countryCode,
        credentialType: pharmacyProfessionalAuthorizations.credentialType,
        credentialDigest: pharmacyProfessionalAuthorizations.credentialDigest,
        sealedCredential: pharmacyProfessionalAuthorizations.sealedCredential,
        validFrom: pharmacyProfessionalAuthorizations.validFrom,
        validUntil: pharmacyProfessionalAuthorizations.validUntil,
        status: pharmacyProfessionalAuthorizations.status,
      })
      .from(pharmacyProfessionalAuthorizations)
      .innerJoin(
        users,
        and(
          eq(users.id, pharmacyProfessionalAuthorizations.userId),
          eq(users.tenantId, args.tenantId),
          eq(users.isActive, true)
        )
      )
      .where(
        and(
          eq(pharmacyProfessionalAuthorizations.tenantId, args.tenantId),
          eq(pharmacyProfessionalAuthorizations.status, 'active'),
          lte(pharmacyProfessionalAuthorizations.validFrom, businessDate),
          or(
            isNull(pharmacyProfessionalAuthorizations.validUntil),
            gte(pharmacyProfessionalAuthorizations.validUntil, businessDate)
          )
        )
      )
      .all(),
  ]);

  const settings =
    tenantRow?.settings && typeof tenantRow.settings === 'object'
      ? (tenantRow.settings as Record<string, unknown>)
      : {};
  const rawBusinessType = settings['businessType'];
  const businessType = VERTICAL_PRESET_IDS.includes(rawBusinessType as VerticalPresetId)
    ? (rawBusinessType as VerticalPresetId)
    : null;
  const profile = profileFor(businessType);
  if (profile === null) {
    return { businessType, profile, checks: [], readyCount: 0, attentionCount: 0 };
  }

  const modulesBlob =
    settings['modules'] && typeof settings['modules'] === 'object'
      ? (settings['modules'] as Record<string, unknown>)
      : undefined;
  const modules = resolveModulesState(modulesBlob);
  const productCount = Number(productSignals?.total ?? 0);
  const productUnitCount = Number(unitSignals?.total ?? 0);
  const fractionalCount = Number(productSignals?.fractional ?? 0);
  const lotCount = Number(productSignals?.lots ?? 0);
  const serialCount = Number(productSignals?.serials ?? 0);

  const recipeKinds =
    profile === 'restaurant'
      ? (['recipe', 'assembly'] as const)
      : profile === 'hardware'
        ? (['cut', 'assembly'] as const)
        : profile === 'butchery'
          ? (['cut', 'disassembly'] as const)
          : ([] as const);
  const [scannerRows, recipeSignals, tableSignals, stationSignals] = await Promise.all([
    args.db
      .select({ config: sitePeripherals.config })
      .from(sitePeripherals)
      .where(
        and(
          eq(sitePeripherals.tenantId, args.tenantId),
          eq(sitePeripherals.kind, 'scanner'),
          eq(sitePeripherals.driver, 'wedge'),
          eq(sitePeripherals.isActive, true)
        )
      )
      .all(),
    args.db
      .select({ total: count(inventoryTransformationRecipes.id) })
      .from(inventoryTransformationRecipes)
      .where(
        and(
          eq(inventoryTransformationRecipes.tenantId, args.tenantId),
          eq(inventoryTransformationRecipes.isActive, true),
          recipeKinds.length > 0
            ? inArray(inventoryTransformationRecipes.kind, recipeKinds)
            : sql`0 = 1`
        )
      )
      .get(),
    args.db
      .select({ total: count(restaurantTables.id) })
      .from(restaurantTables)
      .where(and(eq(restaurantTables.tenantId, args.tenantId), eq(restaurantTables.isActive, true)))
      .get(),
    args.db
      .select({ total: count(kdsStations.id) })
      .from(kdsStations)
      .where(and(eq(kdsStations.tenantId, args.tenantId), eq(kdsStations.isActive, true)))
      .get(),
  ]);
  const weightedBarcodeCount = scannerRows.filter(row => {
    const parsed = wedgeScannerConfigSchema.safeParse(row.config ?? {});
    return parsed.success && parsed.data.gs1Scheme !== 'none';
  }).length;
  const recipeCount = Number(recipeSignals?.total ?? 0);

  const common = [
    configured('catalog', productCount, { route: '/products' }),
    check(
      'productUnits',
      productCount > 0 && productUnitCount === productCount ? 'ready' : 'attention',
      productUnitCount,
      { route: '/products' }
    ),
  ];
  const customerDisplay = check(
    'customerDisplay',
    modules['customer-display'] ? 'ready' : 'not-applicable',
    modules['customer-display'] ? 1 : 0,
    modules['customer-display'] ? { route: '/sales' } : null
  );

  let checks: ReadinessCheck[];
  if (profile === 'pharmacy') {
    const profileCounts = { otc: 0, prescription: 0, controlled: 0 };
    const registeredCounts = { otc: 0, prescription: 0, controlled: 0 };
    const unexpiredCounts = { otc: 0, prescription: 0, controlled: 0 };
    let pharmacyLotCount = 0;
    for (const signal of pharmacySignals) {
      profileCounts[signal.classification] = Number(signal.total);
      registeredCounts[signal.classification] = Number(signal.registered);
      unexpiredCounts[signal.classification] = Number(signal.unexpired);
      pharmacyLotCount += Number(signal.lotTracked);
    }
    const pharmacyCount = Object.values(profileCounts).reduce((total, value) => total + value, 0);
    const countryCode = clock.countryCode;
    const supportedCount = (Object.keys(profileCounts) as Array<keyof typeof profileCounts>).reduce(
      (total, classification) => {
        const policy = resolvePharmacyPolicy(countryCode, businessDate, classification);
        if (!policy.allowed) return total;
        return (
          total +
          (policy.requiredProductFields.includes('sanitaryRegistration')
            ? registeredCounts[classification]
            : unexpiredCounts[classification])
        );
      },
      0
    );
    const regulatedCount = profileCounts.prescription + profileCounts.controlled;
    const authorizationCount = authSignals.filter(
      authorization =>
        authorization.countryCode === countryCode &&
        inspectPharmacyAuthorizationSnapshot(authorization, {
          tenantId: args.tenantId,
          siteId: authorization.siteId,
          countryCode,
          businessDate,
        }) === null
    ).length;
    checks = [
      ...common,
      configured('pharmacyCatalog', pharmacyCount, { route: '/products' }),
      check(
        'lotTracking',
        pharmacyCount > 0 && pharmacyLotCount === pharmacyCount ? 'ready' : 'attention',
        pharmacyLotCount,
        { route: '/inventory?view=pharmacy' }
      ),
      check(
        'pharmacyPolicy',
        pharmacyCount > 0 && supportedCount === pharmacyCount ? 'ready' : 'attention',
        supportedCount,
        { route: '/inventory?view=pharmacy' }
      ),
      check(
        'pharmacyAuthorizations',
        regulatedCount === 0 ? 'not-applicable' : authorizationCount > 0 ? 'ready' : 'attention',
        authorizationCount,
        regulatedCount === 0 ? null : { route: '/inventory?view=pharmacy' }
      ),
      customerDisplay,
    ];
  } else if (profile === 'hardware') {
    checks = [
      ...common,
      configured('fractionalSales', fractionalCount, { route: '/products' }),
      configured('serializedInventory', serialCount, { route: '/products' }),
      configured('transformationRecipes', recipeCount, {
        route: '/inventory?view=transformations',
      }),
      customerDisplay,
    ];
  } else if (profile === 'butchery') {
    checks = [
      ...common,
      configured('fractionalSales', fractionalCount, { route: '/products' }),
      configured('lotTracking', lotCount, { route: '/inventory?view=stock' }),
      configured('weightedBarcode', weightedBarcodeCount, { route: '/peripherals' }),
      configured('transformationRecipes', recipeCount, {
        route: '/inventory?view=transformations',
      }),
      customerDisplay,
    ];
  } else if (profile === 'restaurant') {
    const tableCount = Number(tableSignals?.total ?? 0);
    const stationCount = Number(stationSignals?.total ?? 0);
    checks = [
      ...common,
      check(
        'restaurantTables',
        modules['dine-in'] ? (tableCount > 0 ? 'ready' : 'attention') : 'not-applicable',
        tableCount,
        modules['dine-in'] ? { route: '/restaurants/tables' } : null
      ),
      check(
        'kdsStations',
        modules.kds ? (stationCount > 0 ? 'ready' : 'attention') : 'not-applicable',
        stationCount,
        modules.kds ? { route: '/kds' } : null
      ),
      configured('transformationRecipes', recipeCount, {
        route: '/inventory?view=transformations',
      }),
      customerDisplay,
    ];
  } else {
    checks = [...common, customerDisplay];
  }

  return {
    businessType,
    profile,
    checks,
    readyCount: checks.filter(item => item.status === 'ready').length,
    attentionCount: checks.filter(item => item.status === 'attention').length,
  };
}
