import { TRPCError } from '@trpc/server';
import { and, eq, like, or, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { criticalCommandAdminProcedure } from '../middleware/criticalCommand.js';
import { users } from '../../db/schema.js';
import { enqueueSync } from '../../services/sync/enqueue.js';
import { clearRefreshCookie } from '../../security/authTokens.js';
import {
  createUserInput,
  listUsersInput,
  resetUserPasswordInput,
  updateUserInput,
} from '../schemas/users.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { hashPasswordSecurely } from '../../security/passwords.js';
import { rateLimitFor } from '../middleware/procedureRateLimit.js';

export const usersRouter = router({
  list: adminProcedure.input(listUsersInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, isActive } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(users.tenantId, ctx.tenantId)];
    if (search) {
      conditions.push(
        or(like(users.name, `%${search}%`), like(users.email, `%${search}%`))!
      );
    }
    if (isActive !== undefined) {
      conditions.push(eq(users.isActive, isActive));
    }

    const where = and(...conditions);
    const [items, countResult] = await Promise.all([
      ctx.db
        .select({
          id: users.id,
          tenantId: users.tenantId,
          email: users.email,
          name: users.name,
          role: users.role,
          isActive: users.isActive,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(where)
        .limit(perPage)
        .offset(offset)
        .all(),
      ctx.db.select({ count: sql<number>`count(*)` }).from(users).where(where).get(),
    ]);

    const totalItems = countResult?.count ?? 0;

    return {
      items,
      page,
      perPage,
      totalItems,
      totalPages: Math.ceil(totalItems / perPage),
    };
  }),

  create: criticalCommandAdminProcedure
    .use(
      // ENG-166 — cap admin user creation at 20/hour per actor so a
      // stolen admin token cannot enumerate or seed accounts quickly.
      rateLimitFor({
        name: 'users.create',
        max: 20,
        windowMs: 60 * 60_000,
        keyBy: ['userId'],
      })
    )
    .input(createUserInput)
    .mutation(async ({ ctx, input }) => {
    const existing = await ctx.db.select().from(users).where(eq(users.email, input.email)).get();
    if (existing) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A user with this email already exists',
      });
    }

    const now = new Date().toISOString();
    const id = nanoid();
    // Must hash BEFORE the sync transaction — better-sqlite3 transactions
    // are synchronous and cannot await argon2.
    const passwordHash = await hashPasswordSecurely(input.password);
    const actorId = ctx.user!.id;

    // ENG-007 — user lifecycle writes plus their audit row share a single
    // atomic boundary, same pattern as cashSessions.close.
    ctx.db.transaction(tx => {
      tx.insert(users)
        .values({
          id,
          tenantId: ctx.tenantId,
          email: input.email,
          name: input.name,
          passwordHash,
          role: input.role,
          isActive: input.isActive,
          createdAt: now,
          updatedAt: now,
        })
        .run();

      // New-account snapshot — PII stays in `after` only because `before`
      // is null for a create. Password hash is intentionally never recorded.
      writeAuditLog({
        tx,
        tenantId: ctx.tenantId,
        actorId,
        action: 'user.create',
        resourceType: 'user',
        resourceId: id,
        before: null,
        after: {
          email: input.email,
          name: input.name,
          role: input.role,
          isActive: input.isActive,
        },
        metadata: null,
      });
    });

    await enqueueSync(ctx, {
      entityType: 'users',
      entityId: id,
      operation: 'create',
      data: {
        id,
        email: input.email,
        name: input.name,
        role: input.role,
        isActive: input.isActive,
      },
    });

    return (
      await ctx.db
        .select({
          id: users.id,
          tenantId: users.tenantId,
          email: users.email,
          name: users.name,
          role: users.role,
          isActive: users.isActive,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .get()
    )!;
  }),

  update: criticalCommandAdminProcedure.input(updateUserInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;
    const existing = await ctx.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), eq(users.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
    }

    if (updates.email && updates.email !== existing.email) {
      const duplicate = await ctx.db.select().from(users).where(eq(users.email, updates.email)).get();
      if (duplicate) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'A user with this email already exists',
        });
      }
    }

    if (existing.id === ctx.user!.id && updates.isActive === false) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'You cannot deactivate your own account',
      });
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = { updatedAt: now };
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.role !== undefined) updateData.role = updates.role;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
    const actorId = ctx.user!.id;

    // ENG-007 — only audit genuinely sensitive changes. Name/email edits
    // are bookkeeping; role escalation and disable/enable are security
    // events. Detecting change against the `existing` snapshot keeps the
    // audit timeline free of noise when an admin reopens the form and
    // saves without touching role/isActive.
    const roleChanged =
      updates.role !== undefined && updates.role !== existing.role;
    const activeChanged =
      updates.isActive !== undefined && updates.isActive !== existing.isActive;
    const shouldAudit = roleChanged || activeChanged;

    ctx.db.transaction(tx => {
      tx.update(users).set(updateData).where(eq(users.id, id)).run();

      if (shouldAudit) {
        writeAuditLog({
          tx,
          tenantId: ctx.tenantId,
          actorId,
          action: 'user.update',
          resourceType: 'user',
          resourceId: id,
          // Snapshot ONLY the fields that actually changed so auditors
          // don't see spurious email/name noise next to a role escalation.
          before: {
            ...(roleChanged ? { role: existing.role } : {}),
            ...(activeChanged ? { isActive: existing.isActive } : {}),
          },
          after: {
            ...(roleChanged ? { role: updates.role } : {}),
            ...(activeChanged ? { isActive: updates.isActive } : {}),
          },
          metadata: {
            email: existing.email,
            ...(roleChanged ? { roleChanged: true } : {}),
            ...(activeChanged ? { activeChanged: true } : {}),
          },
        });
      }
    });

    await enqueueSync(ctx, {
      entityType: 'users',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
    });

    return (
      await ctx.db
        .select({
          id: users.id,
          tenantId: users.tenantId,
          email: users.email,
          name: users.name,
          role: users.role,
          isActive: users.isActive,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .get()
    )!;
  }),

  resetPassword: adminProcedure
    .use(
      // ENG-166 — cap admin password resets at 10/hour per actor. Same
      // rationale as `users.create`: throttles credential spraying via a
      // compromised admin session.
      rateLimitFor({
        name: 'users.resetPassword',
        max: 10,
        windowMs: 60 * 60_000,
        keyBy: ['userId'],
      })
    )
    .input(resetUserPasswordInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select()
        .from(users)
        .where(and(eq(users.id, input.id), eq(users.tenantId, ctx.tenantId)))
        .get();

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }

      const now = new Date().toISOString();
      const passwordHash = await hashPasswordSecurely(input.newPassword);

      await ctx.db
        .update(users)
        .set({
          passwordHash,
          sessionVersion: sql`${users.sessionVersion} + 1`,
          updatedAt: now,
        })
        .where(eq(users.id, input.id));

      if (input.id === ctx.user!.id) {
        clearRefreshCookie(ctx.req, ctx.res);
      }

      await enqueueSync(ctx, {
        entityType: 'users',
        entityId: input.id,
        operation: 'update',
        data: { id: input.id, passwordReset: true, updatedAt: now },
      });

      return { success: true, id: input.id };
    }),
});
