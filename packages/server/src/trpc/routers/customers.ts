/**
 * Customers tRPC Router
 *
 * CRUD and search operations for customers with tenant isolation.
 *
 * Procedures:
 * - customers.list      (tenant) - List customers with pagination
 * - customers.getById   (tenant) - Get a single customer
 * - customers.create    (tenant) - Create a new customer
 * - customers.update    (tenant) - Update a customer
 * - customers.delete    (tenant, admin) - Delete a customer
 * - customers.search    (tenant) - Search customers by name/email/phone
 *
 * @module trpc/routers/customers
 */

import { TRPCError } from '@trpc/server';
import { eq, and, sql, like, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { customers, syncQueue } from '../../db/schema.js';
import {
  listCustomersInput,
  getCustomerInput,
  createCustomerInput,
  updateCustomerInput,
  deleteCustomerInput,
  searchCustomersInput,
} from '../schemas/customers.js';

export const customersRouter = router({
  /**
   * List customers for the current tenant with pagination
   */
  list: tenantProcedure.input(listCustomersInput).query(async ({ ctx, input }) => {
    const { page, perPage, search, isActive } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(customers.tenantId, ctx.tenantId)];
    if (search) {
      conditions.push(
        or(
          like(customers.name, `%${search}%`),
          like(customers.email, `%${search}%`),
          like(customers.phone, `%${search}%`)
        )!
      );
    }
    if (isActive !== undefined) {
      conditions.push(eq(customers.isActive, isActive));
    }

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db.select().from(customers).where(where).limit(perPage).offset(offset).all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(customers)
        .where(where)
        .get(),
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

  /**
   * Get a single customer by ID
   */
  getById: tenantProcedure.input(getCustomerInput).query(async ({ ctx, input }) => {
    const customer = await ctx.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.id), eq(customers.tenantId, ctx.tenantId)))
      .get();

    if (!customer) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found' });
    }

    return customer;
  }),

  /**
   * Create a new customer
   */
  create: tenantProcedure.input(createCustomerInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();
    const id = nanoid();

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
      notes: input.notes,
      isActive: input.isActive,
      syncStatus: 'pending',
      syncVersion: 1,
      createdAt: now,
      updatedAt: now,
    });

    // Add to sync queue
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'customers',
      entityId: id,
      operation: 'create',
      data: { id, ...input },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const created = await ctx.db.select().from(customers).where(eq(customers.id, id)).get();

    return created!;
  }),

  /**
   * Update an existing customer
   */
  update: tenantProcedure.input(updateCustomerInput).mutation(async ({ ctx, input }) => {
    const { id, ...updates } = input;

    const existing = await ctx.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, id), eq(customers.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found' });
    }

    const now = new Date().toISOString();
    const updateData: Record<string, unknown> = {
      updatedAt: now,
      syncStatus: 'pending',
      syncVersion: (existing.syncVersion ?? 0) + 1,
    };

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.email !== undefined) updateData.email = updates.email;
    if (updates.phone !== undefined) updateData.phone = updates.phone;
    if (updates.address !== undefined) updateData.address = updates.address;
    if (updates.city !== undefined) updateData.city = updates.city;
    if (updates.state !== undefined) updateData.state = updates.state;
    if (updates.postalCode !== undefined) updateData.postalCode = updates.postalCode;
    if (updates.country !== undefined) updateData.country = updates.country;
    if (updates.taxId !== undefined) updateData.taxId = updates.taxId;
    if (updates.notes !== undefined) updateData.notes = updates.notes;
    if (updates.isActive !== undefined) updateData.isActive = updates.isActive;

    await ctx.db.update(customers).set(updateData).where(eq(customers.id, id));

    // Add to sync queue
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'customers',
      entityId: id,
      operation: 'update',
      data: { id, ...updateData },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    const updated = await ctx.db.select().from(customers).where(eq(customers.id, id)).get();

    return updated!;
  }),

  /**
   * Delete a customer (admin only)
   */
  delete: tenantProcedure.input(deleteCustomerInput).mutation(async ({ ctx, input }) => {
    if (ctx.user!.role !== 'admin') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only administrators can delete customers',
      });
    }

    const existing = await ctx.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, input.id), eq(customers.tenantId, ctx.tenantId)))
      .get();

    if (!existing) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Customer not found' });
    }

    await ctx.db.delete(customers).where(eq(customers.id, input.id));

    const now = new Date().toISOString();
    await ctx.db.insert(syncQueue).values({
      id: nanoid(),
      tenantId: ctx.tenantId,
      entityType: 'customers',
      entityId: input.id,
      operation: 'delete',
      data: { id: input.id },
      localVersion: 1,
      attempts: 0,
      createdAt: now,
    });

    return { success: true, id: input.id };
  }),

  /**
   * Search customers by name, email, or phone
   */
  search: tenantProcedure.input(searchCustomersInput).query(async ({ ctx, input }) => {
    const items = await ctx.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.tenantId, ctx.tenantId),
          or(
            like(customers.name, `%${input.q}%`),
            like(customers.email, `%${input.q}%`),
            like(customers.phone, `%${input.q}%`)
          )
        )
      )
      .limit(input.limit)
      .all();

    return { items };
  }),
});
