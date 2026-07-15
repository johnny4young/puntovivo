/** ENG-123b — Canonical provider create use-case. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { providers } from '../../db/schema.js';
import { ensureCityExists } from '../../services/geography/city-validation.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import type { CreateProviderInput } from '../../trpc/schemas/providers.js';
import type { ProviderMutationContext } from './types.js';

export async function createProvider(ctx: ProviderMutationContext, input: CreateProviderInput) {
  const now = new Date().toISOString();
  const id = nanoid();
  const cityId = await ensureCityExists(ctx.db, ctx.tenantId, input.cityId ?? null);

  await ctx.db.insert(providers).values({
    id,
    tenantId: ctx.tenantId,
    name: input.name,
    taxId: input.taxId,
    phone: input.phone,
    email: input.email,
    address: input.address,
    cityId,
    contactName: input.contactName,
    isActive: input.isActive,
    createdAt: now,
    updatedAt: now,
  });

  await enqueueSync(ctx, {
    entityType: 'providers',
    entityId: id,
    operation: 'create',
    data: { id, ...input, cityId },
  });

  const created = await ctx.db
    .select()
    .from(providers)
    .where(and(eq(providers.id, id), eq(providers.tenantId, ctx.tenantId)))
    .get();

  return created!;
}
