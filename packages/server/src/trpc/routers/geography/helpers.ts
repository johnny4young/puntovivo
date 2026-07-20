/**
 * Geography routers shared helpers (uniqueness + existence guards + read
 * projections).
 *
 * extracted verbatim from the former flat `trpc/routers/geography.ts`
 * (878 LOC) during the megafile decomposition. Holds the country / department /
 * city uniqueness + existence validators and the join-aware selection builders
 * shared by the three sibling routers. Import leaf: depends only on the schema +
 * drizzle, never on the router modules.
 *
 * @module trpc/routers/geography/helpers
 */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../../db/index.js';
import { cities, countries, departments } from '../../../db/schema.js';

export async function ensureCountryUniqueness(
  db: DatabaseInstance,
  tenantId: string,
  values: {
    // explicit `| undefined` on Zod-optional fields.
    id?: string | undefined;
    code?: string | undefined;
    name?: string | undefined;
  }
) {
  if (values.code) {
    const existing = await db
      .select({ id: countries.id })
      .from(countries)
      .where(and(eq(countries.tenantId, tenantId), eq(countries.code, values.code)))
      .get();

    if (existing && existing.id !== values.id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A country with this code already exists',
      });
    }
  }

  if (values.name) {
    const existing = await db
      .select({ id: countries.id })
      .from(countries)
      .where(and(eq(countries.tenantId, tenantId), eq(countries.name, values.name)))
      .get();

    if (existing && existing.id !== values.id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A country with this name already exists',
      });
    }
  }
}

export async function ensureCountryExists(
  db: DatabaseInstance,
  tenantId: string,
  countryId: string
) {
  const country = await db
    .select({ id: countries.id, isActive: countries.isActive })
    .from(countries)
    .where(and(eq(countries.tenantId, tenantId), eq(countries.id, countryId)))
    .get();

  if (!country || country.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected country was not found or is inactive',
    });
  }

  return country.id;
}

export async function ensureDepartmentUniqueness(
  db: DatabaseInstance,
  tenantId: string,
  values: {
    // explicit `| undefined` on Zod-optional fields.
    id?: string | undefined;
    code?: string | undefined;
    name?: string | undefined;
  }
) {
  if (values.code) {
    const existing = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.tenantId, tenantId), eq(departments.code, values.code)))
      .get();

    if (existing && existing.id !== values.id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A department with this code already exists',
      });
    }
  }

  if (values.name) {
    const existing = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.tenantId, tenantId), eq(departments.name, values.name)))
      .get();

    if (existing && existing.id !== values.id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A department with this name already exists',
      });
    }
  }
}

export async function ensureDepartmentExists(
  db: DatabaseInstance,
  tenantId: string,
  departmentId: string
) {
  const department = await db
    .select({ id: departments.id, isActive: departments.isActive })
    .from(departments)
    .where(and(eq(departments.tenantId, tenantId), eq(departments.id, departmentId)))
    .get();

  if (!department || department.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected department was not found or is inactive',
    });
  }

  return department.id;
}

export async function ensureCityUniqueness(
  db: DatabaseInstance,
  tenantId: string,
  values: {
    // explicit `| undefined` on Zod-optional fields.
    id?: string | undefined;
    departmentId: string;
    code?: string | undefined;
    name?: string | undefined;
  }
) {
  if (values.code) {
    const existing = await db
      .select({ id: cities.id })
      .from(cities)
      .where(and(eq(cities.tenantId, tenantId), eq(cities.code, values.code)))
      .get();

    if (existing && existing.id !== values.id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A city with this code already exists',
      });
    }
  }

  if (values.name) {
    const existing = await db
      .select({ id: cities.id })
      .from(cities)
      .where(
        and(
          eq(cities.tenantId, tenantId),
          eq(cities.departmentId, values.departmentId),
          eq(cities.name, values.name)
        )
      )
      .get();

    if (existing && existing.id !== values.id) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A city with this name already exists in the selected department',
      });
    }
  }
}

export function buildDepartmentSelection() {
  return {
    id: departments.id,
    tenantId: departments.tenantId,
    countryId: departments.countryId,
    countryCode: countries.code,
    countryName: countries.name,
    code: departments.code,
    name: departments.name,
    isActive: departments.isActive,
    createdAt: departments.createdAt,
    updatedAt: departments.updatedAt,
  };
}

export function buildCitySelection() {
  return {
    id: cities.id,
    tenantId: cities.tenantId,
    departmentId: cities.departmentId,
    countryId: departments.countryId,
    countryName: countries.name,
    departmentCode: departments.code,
    departmentName: departments.name,
    code: cities.code,
    name: cities.name,
    isActive: cities.isActive,
    createdAt: cities.createdAt,
    updatedAt: cities.updatedAt,
  };
}
