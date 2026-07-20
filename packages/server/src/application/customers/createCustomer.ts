/** Canonical customer-profile create use-case. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import {
  clientTypes,
  commercialActivities,
  customers,
  identificationTypes,
  personTypes,
  regimeTypes,
} from '../../db/schema.js';
import { resolveTenantCurrency } from '../../lib/currency.js';
import { roundMoney } from '../../lib/money.js';
import { validateCustomerCatalogCode } from '../../services/customers/catalog-validation.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import type { CreateCustomerInput } from '../../trpc/schemas/customers.js';
import type { CustomerMutationContext } from './types.js';

export async function createCustomer(ctx: CustomerMutationContext, input: CreateCustomerInput) {
  const now = new Date().toISOString();
  const id = nanoid();
  const [
    identificationTypeCode,
    personTypeCode,
    regimeTypeCode,
    clientTypeCode,
    commercialActivityCode,
  ] = await Promise.all([
    validateCustomerCatalogCode(
      ctx.db,
      ctx.tenantId,
      identificationTypes,
      input.identificationTypeId,
      'identification type'
    ),
    validateCustomerCatalogCode(
      ctx.db,
      ctx.tenantId,
      personTypes,
      input.personTypeId,
      'person type'
    ),
    validateCustomerCatalogCode(
      ctx.db,
      ctx.tenantId,
      regimeTypes,
      input.regimeTypeId,
      'regime type'
    ),
    validateCustomerCatalogCode(
      ctx.db,
      ctx.tenantId,
      clientTypes,
      input.clientTypeId,
      'client type'
    ),
    validateCustomerCatalogCode(
      ctx.db,
      ctx.tenantId,
      commercialActivities,
      input.commercialActivityId,
      'commercial activity'
    ),
  ]);

  // stamp credit_limit_currency_code only when the customer
  // actually has a credit limit. `0 = sin cupo` is the legacy sentinel;
  // setting a currency on a customer with no active limit would be misleading.
  const normalizedCreditLimit = roundMoney(input.creditLimit ?? 0);
  const creditLimitCurrencyCode =
    normalizedCreditLimit > 0 ? resolveTenantCurrency(ctx.db, ctx.tenantId) : null;

  await ctx.db.insert(customers).values({
    id,
    tenantId: ctx.tenantId,
    name: input.name,
    email: input.email,
    phone: input.phone,
    address: input.address,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country,
    taxId: input.taxId,
    identificationTypeId: identificationTypeCode,
    personTypeId: personTypeCode,
    regimeTypeId: regimeTypeCode,
    clientTypeId: clientTypeCode,
    commercialActivityId: commercialActivityCode,
    notes: input.notes,
    // default cupo to 0 (sin cupo) when the operator did not pick
    // a value; the persistence-layer NOT NULL guard protects the column.
    creditLimit: normalizedCreditLimit,
    creditLimitCurrencyCode,
    isActive: input.isActive,
    syncStatus: 'pending',
    syncVersion: 1,
    createdAt: now,
    updatedAt: now,
  });

  await enqueueSync(ctx, {
    entityType: 'customers',
    entityId: id,
    operation: 'create',
    data: { id, ...input },
  });

  const created = await ctx.db
    .select()
    .from(customers)
    .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
    .get();

  return created!;
}
