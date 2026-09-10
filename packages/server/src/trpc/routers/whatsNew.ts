/**
 * What's-New tRPC Router —
 *
 * Per-release announcement records, always scoped to the publishing tenant.
 *
 * A product-wide scope used to exist here: `publish` accepted
 * tenantScope: 'product-wide' and wrote tenant_id NULL, while `listUnseen`
 * served NULL rows to every tenant. But `admin` is a per-tenant role and this
 * install has no platform role above it, so any tenant's admin could publish
 * attacker-authored title and body into the What's-New overlay of every other
 * tenant on the install. The scope is gone rather than gated, and the read
 * refuses NULL rows so any row a previous build wrote stays invisible.
 *
 * Auth-checked users see unseen entries; the
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

import { TRPCError } from '@trpc/server';
import { and, desc, eq, notInArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { adminProcedure } from '../middleware/roles.js';
import { whatsNewAcks, whatsNewEntries } from '../../db/schema.js';

const publishInput = z.object({
  version: z.string().min(1),
  title: z.string().min(1),
  body: z.string().min(1),
});

const markSeenInput = z.object({
  entryId: z.string().min(1),
});

export const whatsNewRouter = router({
  listUnseen: tenantProcedure.query(async ({ ctx }) => {
    // Read this tenant's own entries and remove the ones the current user
    // has already acked. NULL-tenant rows are deliberately not visible.
    // surfaces only the most recent unseen one to the
    // Overlay, but the listing returns the full set so a Settings
    // → Novedades archive can render history later.
    const ackedRows = await ctx.db
      .select({ entryId: whatsNewAcks.entryId })
      .from(whatsNewAcks)
      .where(eq(whatsNewAcks.userId, ctx.user!.id));
    const ackedIds = ackedRows.map(r => r.entryId);

    const tenantFilter = eq(whatsNewEntries.tenantId, ctx.tenantId);
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
    // The ack carried no predicate tying the entry to the caller's tenant, so
    // a user could ack another tenant's private entry id. Nothing reads acks
    // back across tenants today, which is the only reason it was not a
    // disclosure - resolve the entry first so it cannot become one.
    const entry = await ctx.db
      .select({ id: whatsNewEntries.id })
      .from(whatsNewEntries)
      .where(and(eq(whatsNewEntries.id, input.entryId), eq(whatsNewEntries.tenantId, ctx.tenantId)))
      .get();
    if (!entry) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'WHATS_NEW_ENTRY_NOT_FOUND' });
    }
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
      tenantId: ctx.tenantId,
      version: input.version,
      title: input.title,
      body: input.body,
    });
    return { id };
  }),
});
