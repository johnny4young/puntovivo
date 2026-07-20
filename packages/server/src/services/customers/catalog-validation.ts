/** Shared customer-catalog validation for canonical profile writes. */
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';

import type { DatabaseInstance } from '../../db/index.js';
import {
  clientTypes,
  commercialActivities,
  identificationTypes,
  personTypes,
  regimeTypes,
} from '../../db/schema.js';

export type CustomerCatalogTable =
  | typeof identificationTypes
  | typeof personTypes
  | typeof regimeTypes
  | typeof clientTypes
  | typeof commercialActivities;

export async function validateCustomerCatalogCode(
  db: DatabaseInstance,
  tenantId: string,
  table: CustomerCatalogTable,
  code: string | null | undefined,
  label: string
) {
  if (!code) return code ?? null;

  const item = await db
    .select({ code: table.code, isActive: table.isActive })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), eq(table.code, code)))
    .get();

  if (!item || item.isActive === false) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Selected ${label.toLowerCase()} was not found or is inactive`,
    });
  }

  return item.code;
}
