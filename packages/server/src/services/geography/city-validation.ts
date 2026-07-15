/** ENG-123b — Shared tenant-city validation for provider write use-cases. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import { cities } from '../../db/schema.js';

export async function ensureCityExists(
  db: DatabaseInstance,
  tenantId: string,
  cityId: string | null | undefined
) {
  if (!cityId) return null;

  const city = await db
    .select({ id: cities.id, isActive: cities.isActive })
    .from(cities)
    .where(and(eq(cities.tenantId, tenantId), eq(cities.id, cityId)))
    .get();

  if (!city || city.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'Selected city was not found or is inactive',
    });
  }

  return city.id;
}
