/**
 * What's-New tRPC Router —
 *
 * Per-release announcement records. Tenant-scoped or product-wide
 * (tenant_id IS NULL). Auth-checked users see unseen entries; the
 * Overlay primitive () surfaces the most recent unseen one,
 * and `markSeen` writes an ack so the same release does not repeat.
 *
 * Procedures:
 * - whatsNew.listUnseen (auth)     — entries the user hasn't acked
 * - whatsNew.markSeen   (auth)     — write an ack
 * - whatsNew.publish    (admin)    — create a new entry
 *
 * @module trpc/routers/whatsNew
 */

import { and, desc, eq, isNull, notInArray, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure } from '../middleware/roles.js';
import { whatsNewAcks, whatsNewEntries } from '../../db/schema.js';

const publishInput = z.object({
  tenantScope: z.enum(['tenant', 'product-wide']).default('tenant'),
  version: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
});

const markSeenInput = z.object({
  entryId: z.string().min(1),
});

export const whatsNewRouter = router({
  listUnseen: tenantProcedure.query(async ({ ctx }) => {
    // Read every entry visible to this tenant (own + product-wide)
    // and remove the ones the current user has already acked.
    // surfaces only the most recent unseen one to the
    // Overlay, but the listing returns the full set so a Settings
    // → Novedades archive can render history later.
    const ackedRows = await ctx.db
      .select({ entryId: whatsNewAcks.entryId })
      .from(whatsNewAcks)
      .where(eq(whatsNewAcks.userId, ctx.user!.id));
    const ackedIds = ackedRows.map(r => r.entryId);

    const tenantFilter = or(
      eq(whatsNewEntries.tenantId, ctx.tenantId),
      isNull(whatsNewEntries.tenantId)
    );
    const conditions = ackedIds.length
      ? and(tenantFilter, notInArray(whatsNewEntries.id, ackedIds))
      : tenantFilter;

    return ctx.db
      .select()
      .from(whatsNewEntries)
      .where(conditions)
      .orderBy(desc(whatsNewEntries.publishedAt))
      .limit(20);
  }),

  markSeen: tenantProcedure.input(markSeenInput).mutation(async ({ ctx, input }) => {
    // Idempotent: the unique (entry_id, user_id) index makes the
    // second insert noop via ON CONFLICT DO NOTHING.
    await ctx.db
      .insert(whatsNewAcks)
      .values({
        id: nanoid(),
        entryId: input.entryId,
        userId: ctx.user!.id,
      })
      .onConflictDoNothing();
    return { ok: true };
  }),

  publish: adminProcedure.input(publishInput).mutation(async ({ ctx, input }) => {
    const id = nanoid();
    await ctx.db.insert(whatsNewEntries).values({
      id,
      tenantId: input.tenantScope === 'tenant' ? ctx.tenantId : null,
      version: input.version,
      title: input.title,
      body: input.body,
    });
    return { id };
  }),
});
