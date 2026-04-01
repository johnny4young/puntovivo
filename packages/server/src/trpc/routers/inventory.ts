/**
 * Inventory tRPC Router
 *
 * Inventory movement tracking and stock management with tenant isolation.
 *
 * Procedures:
 * - inventory.listMovements   (tenant) - List inventory movements
 * - inventory.getMovement     (tenant) - Get a single movement
 * - inventory.createMovement  (tenant) - Create movement + update product stock (transaction)
 * - inventory.adjustStock     (tenant, admin) - Set absolute stock level
 * - inventory.productStock    (tenant) - Get current stock for a product
 *
 * @module trpc/routers/inventory
 */

import { TRPCError } from '@trpc/server';
import { eq, and, sql, gte, lte } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { inventoryMovements, products, syncQueue } from '../../db/schema.js';
import {
  listMovementsInput,
  getMovementInput,
  createMovementInput,
  adjustStockInput,
  productStockInput,
} from '../schemas/inventory.js';

export const inventoryRouter = router({
  /**
   * List inventory movements for the current tenant
   */
  listMovements: tenantProcedure.input(listMovementsInput).query(async ({ ctx, input }) => {
    const { page, perPage, productId, type, fromDate, toDate } = input;
    const offset = (page - 1) * perPage;

    const conditions = [eq(inventoryMovements.tenantId, ctx.tenantId)];
    if (productId) conditions.push(eq(inventoryMovements.productId, productId));
    if (type) conditions.push(eq(inventoryMovements.type, type));
    if (fromDate) conditions.push(gte(inventoryMovements.createdAt, fromDate));
    if (toDate) conditions.push(lte(inventoryMovements.createdAt, toDate));

    const where = and(...conditions);

    const [items, countResult] = await Promise.all([
      ctx.db.select().from(inventoryMovements).where(where).limit(perPage).offset(offset).all(),
      ctx.db
        .select({ count: sql<number>`count(*)` })
        .from(inventoryMovements)
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
   * Get a single inventory movement by ID
   */
  getMovement: tenantProcedure.input(getMovementInput).query(async ({ ctx, input }) => {
    const movement = await ctx.db
      .select()
      .from(inventoryMovements)
      .where(
        and(eq(inventoryMovements.id, input.id), eq(inventoryMovements.tenantId, ctx.tenantId))
      )
      .get();

    if (!movement) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Inventory movement not found' });
    }

    return movement;
  }),

  /**
   * Create an inventory movement and update product stock atomically.
   *
   * - For 'purchase'/'return': adds quantity to stock
   * - For 'sale'/'transfer': subtracts quantity from stock
   * - For 'adjustment': treated as an add (use adjustStock for absolute set)
   */
  createMovement: tenantProcedure.input(createMovementInput).mutation(async ({ ctx, input }) => {
    const now = new Date().toISOString();

    // Validate product belongs to tenant
    const product = await ctx.db
      .select()
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!product) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    // Determine stock change direction
    const isDeduction = input.type === 'sale' || input.type === 'transfer';
    const newStock = isDeduction ? product.stock - input.quantity : product.stock + input.quantity;

    if (newStock < 0) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Insufficient stock. Available: ${product.stock}, requested: ${input.quantity}`,
      });
    }

    const movementId = nanoid();

    // better-sqlite3 requires a synchronous transaction callback
    ctx.db.transaction(tx => {
      // Create movement record
      tx.insert(inventoryMovements)
        .values({
          id: movementId,
          tenantId: ctx.tenantId,
          productId: input.productId,
          type: input.type,
          quantity: input.quantity,
          previousStock: product.stock,
          newStock,
          reference: input.reference,
          notes: input.notes,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();

      // Update product stock
      tx.update(products)
        .set({
          stock: newStock,
          syncStatus: 'pending',
          syncVersion: (product.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(products.id, input.productId))
        .run();

      // Add to sync queue
      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          entityType: 'inventory_movements',
          entityId: movementId,
          operation: 'create',
          data: { id: movementId, productId: input.productId, newStock },
          localVersion: 1,
          attempts: 0,
          createdAt: now,
        })
        .run();
    });

    const created = await ctx.db
      .select()
      .from(inventoryMovements)
      .where(eq(inventoryMovements.id, movementId))
      .get();

    return created!;
  }),

  /**
   * Set a product's stock to an absolute value (admin only).
   * Creates an 'adjustment' movement record.
   */
  adjustStock: tenantProcedure.input(adjustStockInput).mutation(async ({ ctx, input }) => {
    if (ctx.user!.role !== 'admin' && ctx.user!.role !== 'manager') {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Only administrators and managers can adjust stock',
      });
    }

    const product = await ctx.db
      .select()
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!product) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    const now = new Date().toISOString();
    const movementId = nanoid();
    const quantity = Math.abs(input.newStock - product.stock);

    // better-sqlite3 requires a synchronous transaction callback
    ctx.db.transaction(tx => {
      tx.insert(inventoryMovements)
        .values({
          id: movementId,
          tenantId: ctx.tenantId,
          productId: input.productId,
          type: 'adjustment',
          quantity,
          previousStock: product.stock,
          newStock: input.newStock,
          reference: 'manual-adjustment',
          notes: input.notes,
          createdBy: ctx.user!.id,
          syncStatus: 'pending',
          syncVersion: 1,
          createdAt: now,
        })
        .run();

      tx.update(products)
        .set({
          stock: input.newStock,
          syncStatus: 'pending',
          syncVersion: (product.syncVersion ?? 0) + 1,
          updatedAt: now,
        })
        .where(eq(products.id, input.productId))
        .run();

      tx.insert(syncQueue)
        .values({
          id: nanoid(),
          tenantId: ctx.tenantId,
          entityType: 'inventory_movements',
          entityId: movementId,
          operation: 'create',
          data: { id: movementId, productId: input.productId, newStock: input.newStock },
          localVersion: 1,
          attempts: 0,
          createdAt: now,
        })
        .run();
    });

    const updatedProduct = await ctx.db
      .select()
      .from(products)
      .where(eq(products.id, input.productId))
      .get();

    return { product: updatedProduct!, movementId };
  }),

  /**
   * Get current stock level for a product
   */
  productStock: tenantProcedure.input(productStockInput).query(async ({ ctx, input }) => {
    const product = await ctx.db
      .select({
        id: products.id,
        name: products.name,
        stock: products.stock,
        minStock: products.minStock,
      })
      .from(products)
      .where(and(eq(products.id, input.productId), eq(products.tenantId, ctx.tenantId)))
      .get();

    if (!product) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Product not found' });
    }

    return {
      productId: product.id,
      name: product.name,
      stock: product.stock,
      minStock: product.minStock,
      isLowStock: product.stock <= product.minStock,
    };
  }),
});
