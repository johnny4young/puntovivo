import { TRPCError } from '@trpc/server';
import { and, eq, like, or, sql } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { adminProcedure } from '../middleware/roles.js';
import { syncQueue, users } from '../../db/schema.js';
import {
  createUserInput,
  listUsersInput,
  resetUserPasswordInput,
  updateUserInput,
} from '../schemas/users.js';

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

  create: adminProcedure.input(createUserInput).mutation(async ({ ctx, input }) => {
    const existing = await ctx.db.select().from(users).where(eq(users.email, input.email)).get();
    if (existing) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'A user with this email already exists',
      });
    }

    const now = new Date().toISOString();
    const id = nanoid();
    const passwordHash = await argon2.hash(input.password);

    await ctx.db.insert(users).values({
      id,
      tenantId: ctx.tenantId,
      email: input.email,
      name: input.name,
      passwordHash,
      role: input.role,
      isActive: input.isActive,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'users',
      entityId: id,
      operation: 'create',
      data: { id, email: input.email, name: input.name, role: input.role, isActive: input.isActive },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
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

  update: adminProcedure.input(updateUserInput).mutation(async ({ ctx, input }) => {
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

    await ctx.db.update(users).set(updateData).where(eq(users.id, id));

    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'users',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
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
      const passwordHash = await argon2.hash(input.newPassword);

      await ctx.db
        .update(users)
        .set({
          passwordHash,
          updatedAt: now,
        })
        .where(eq(users.id, input.id));

      await ctx.db.insert(syncQueue).values({
        id: nanoid(),
        tenantId: ctx.tenantId,
        entityType: 'users',
        entityId: input.id,
        operation: 'update',
        data: { id: input.id, passwordReset: true, updatedAt: now },
        localVersion: 1,
        attempts: 0,
        createdAt: now,
      });

      return { success: true, id: input.id };
    }),
});
