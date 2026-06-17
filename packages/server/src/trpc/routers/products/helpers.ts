/**
 * Products router mutation-side resolvers and validators.
 *
 * ENG-178 — extracted verbatim from the former flat `trpc/routers/products.ts`
 * (1280 LOC) during the megafile decomposition. Holds the unit / provider /
 * tax / location resolution + validation helpers shared by `create` and
 * `update`. Import leaf: depends only on the schema + drizzle + input-schema
 * types, never on the sibling procedure modules or `product-read`.
 *
 * @module trpc/routers/products/helpers
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  locations,
  productXProvider,
  providers,
  unitXProduct,
  units,
  vatRates,
} from '../../../db/schema.js';
import type { Context } from '../../context.js';
import type { CreateProductInput, UpdateProductInput } from '../../schemas/products.js';

/**
 * Provider-assignment array as accepted by the create/update inputs — the
 * non-null element shape of `CreateProductInput['providerAssignments']`.
 */
export type ProductProviderAssignmentInput = NonNullable<CreateProductInput['providerAssignments']>;

export function validateUnitAssignments(
  input:
    | NonNullable<CreateProductInput['unitAssignments']>
    | NonNullable<UpdateProductInput['unitAssignments']>
) {
  const baseAssignments = input.filter(assignment => assignment.isBase);

  if (baseAssignments.length !== 1) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Exactly one product unit must be marked as base',
    });
  }

  // The `length !== 1` guard above asserts exactly one base assignment,
  // so `[0]` is guaranteed; `!` narrows for `noUncheckedIndexedAccess`.
  // reason: post-length-check invariant.
  if (baseAssignments[0]!.equivalence !== 1) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'The base unit must use an equivalence of 1',
    });
  }

  const unitIds = new Set<string>();
  for (const assignment of input) {
    if (unitIds.has(assignment.unitId)) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'Each unit can only be assigned once per product',
      });
    }

    unitIds.add(assignment.unitId);
  }
}

export async function resolveUnitAssignments(
  db: Context['db'],
  tenantId: string,
  input:
    | NonNullable<CreateProductInput['unitAssignments']>
    | NonNullable<UpdateProductInput['unitAssignments']>
) {
  validateUnitAssignments(input);

  const availableUnits = await db
    .select({
      id: units.id,
      tenantId: units.tenantId,
      isActive: units.isActive,
    })
    .from(units)
    .where(eq(units.tenantId, tenantId))
    .all();

  const unitMap = new Map(availableUnits.map(unit => [unit.id, unit]));
  for (const assignment of input) {
    const unit = unitMap.get(assignment.unitId);
    if (!unit || unit.isActive === false) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'One of the selected units was not found or is inactive',
      });
    }
  }

  return input;
}

export function getUniqueProviderIds(providerIds: string[]) {
  return [...new Set(providerIds)];
}

export async function resolveProviderAssignments(
  db: Context['db'],
  tenantId: string,
  input: ProductProviderAssignmentInput
) {
  const providerIds = input.map(assignment => assignment.providerId);
  if (getUniqueProviderIds(providerIds).length !== providerIds.length) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'Each provider can only be assigned once per product',
    });
  }

  const availableProviders = await db
    .select({
      id: providers.id,
      isActive: providers.isActive,
    })
    .from(providers)
    .where(eq(providers.tenantId, tenantId))
    .all();

  const providerMap = new Map(availableProviders.map(provider => [provider.id, provider]));
  for (const assignment of input) {
    const provider = providerMap.get(assignment.providerId);
    if (!provider || provider.isActive === false) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'One of the selected providers was not found or is inactive',
      });
    }
  }

  return input;
}

export async function getDefaultUnitAssignments(
  db: Context['db'],
  tenantId: string,
  price: number
): Promise<NonNullable<CreateProductInput['unitAssignments']>> {
  const now = new Date().toISOString();
  const availableUnits = await db
    .select({
      id: units.id,
      abbreviation: units.abbreviation,
      isActive: units.isActive,
    })
    .from(units)
    .where(eq(units.tenantId, tenantId))
    .all();

  const defaultUnit =
    availableUnits.find(unit => unit.abbreviation === 'UND' && unit.isActive !== false) ??
    availableUnits.find(unit => unit.isActive !== false);

  if (!defaultUnit || defaultUnit.isActive === false) {
    const createdUnitId = nanoid();
    await db.insert(units).values({
      id: createdUnitId,
      tenantId,
      name: 'Unidad',
      abbreviation: 'UND',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    return [
      {
        unitId: createdUnitId,
        equivalence: 1,
        price,
        isBase: true,
      },
    ];
  }

  return [
    {
      unitId: defaultUnit.id,
      equivalence: 1,
      price,
      isBase: true,
    },
  ];
}

export async function replaceUnitAssignments(
  db: Context['db'],
  productId: string,
  unitAssignmentsInput:
    | NonNullable<CreateProductInput['unitAssignments']>
    | NonNullable<UpdateProductInput['unitAssignments']>,
  now: string
) {
  await db.delete(unitXProduct).where(eq(unitXProduct.productId, productId));

  for (const assignment of unitAssignmentsInput) {
    await db.insert(unitXProduct).values({
      id: nanoid(),
      productId,
      unitId: assignment.unitId,
      equivalence: assignment.equivalence,
      price: assignment.price,
      isBase: assignment.isBase,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export async function getExistingUnitAssignments(db: Context['db'], productId: string) {
  const existingAssignments = await db
    .select({
      unitId: unitXProduct.unitId,
      equivalence: unitXProduct.equivalence,
      price: unitXProduct.price,
      isBase: unitXProduct.isBase,
    })
    .from(unitXProduct)
    .where(eq(unitXProduct.productId, productId))
    .all();

  return existingAssignments.map(assignment => ({
    ...assignment,
    isBase: assignment.isBase ?? false,
  }));
}

export async function getExistingProviderAssignments(db: Context['db'], productId: string) {
  const existingAssignments = await db
    .select({
      providerId: productXProvider.providerId,
    })
    .from(productXProvider)
    .where(eq(productXProvider.productId, productId))
    .all();

  return existingAssignments.map(assignment => assignment.providerId);
}

export async function replaceProviderAssignments(
  db: Context['db'],
  productId: string,
  providerAssignmentsInput: ProductProviderAssignmentInput,
  now: string
) {
  await db.delete(productXProvider).where(eq(productXProvider.productId, productId));

  for (const assignment of providerAssignmentsInput) {
    await db.insert(productXProvider).values({
      id: nanoid(),
      productId,
      providerId: assignment.providerId,
      createdAt: now,
      updatedAt: now,
    });
  }
}

export function normalizeProviderState({
  providerId,
  providerAssignments,
  existingProviderIds = [],
}: {
  providerId: string | null | undefined;
  providerAssignments: ProductProviderAssignmentInput | undefined;
  existingProviderIds?: string[];
}) {
  if (providerAssignments === undefined && providerId === undefined) {
    return null;
  }

  if (providerAssignments !== undefined) {
    const submittedProviderIds = providerAssignments.map(assignment => assignment.providerId);
    const normalizedProviderIds = providerId
      ? [providerId, ...submittedProviderIds.filter(candidateId => candidateId !== providerId)]
      : submittedProviderIds;
    const uniqueProviderIds = getUniqueProviderIds(normalizedProviderIds);

    return {
      providerId: uniqueProviderIds[0] ?? null,
      providerAssignments: uniqueProviderIds.map(candidateId => ({ providerId: candidateId })),
    };
  }

  if (!providerId) {
    return {
      providerId: null,
      providerAssignments: [],
    };
  }

  const uniqueProviderIds = getUniqueProviderIds([
    providerId,
    ...existingProviderIds.filter(candidateId => candidateId !== providerId),
  ]);
  return {
    providerId: uniqueProviderIds[0] ?? null,
    providerAssignments: uniqueProviderIds.map(candidateId => ({ providerId: candidateId })),
  };
}

export async function resolveTaxRate(
  db: Context['db'],
  tenantId: string,
  vatRateId: string | null | undefined,
  fallbackTaxRate: number | undefined
) {
  if (!vatRateId) {
    return {
      vatRateId: vatRateId ?? null,
      taxRate: fallbackTaxRate ?? 0,
    };
  }

  const vatRate = await db
    .select({ id: vatRates.id, rate: vatRates.rate })
    .from(vatRates)
    .where(and(eq(vatRates.id, vatRateId), eq(vatRates.tenantId, tenantId)))
    .get();

  if (!vatRate) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected VAT rate was not found',
    });
  }

  return {
    vatRateId: vatRate.id,
    taxRate: vatRate.rate,
  };
}

export async function resolveLocationId(
  db: Context['db'],
  tenantId: string,
  locationId: string | null | undefined
) {
  if (!locationId) {
    return null;
  }

  const location = await db
    .select({
      id: locations.id,
      isActive: locations.isActive,
    })
    .from(locations)
    .where(and(eq(locations.id, locationId), eq(locations.tenantId, tenantId)))
    .get();

  if (!location || location.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected location was not found or is inactive',
    });
  }

  return location.id;
}
