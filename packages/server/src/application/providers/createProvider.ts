/** Canonical provider create use-case. */
import { and, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { providers } from '../../db/schema.js';
import { ensureCityExists } from '../../services/geography/city-validation.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import type { CreateProviderInput } from '../../trpc/schemas/providers.js';
import type { ProviderMutationContext } from './types.js';

export async function createProvider(ctx: ProviderMutationContext, input: CreateProviderInput) {
  const now = new Date().toISOString();
  const id = nanoid();
  const cityId = await ensureCityExists(ctx.db, ctx.tenantId, input.cityId ?? null);

  return ctx.db.transaction(
    tx => {
      tx.insert(providers)
        .values({
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
        })
        .run();

      enqueueSyncInTransaction(
        { ...ctx, db: tx },
        {
          entityType: 'providers',
          entityId: id,
          operation: 'create',
          data: { id, ...input, cityId },
        }
      );

      const created = tx
        .select()
        .from(providers)
        .where(and(eq(providers.id, id), eq(providers.tenantId, ctx.tenantId)))
        .get();

      return created!;
    },
    { behavior: 'immediate' }
  );
}
