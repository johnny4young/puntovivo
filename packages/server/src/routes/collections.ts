/**
 * Collections CRUD Routes
 *
 * Generic CRUD endpoints for all database collections with tenant isolation.
 *
 * Endpoints pattern:
 * - GET    /api/collections/:collection          - List items
 * - GET    /api/collections/:collection/:id      - Get single item
 * - POST   /api/collections/:collection          - Create item
 * - PUT    /api/collections/:collection/:id      - Update item
 * - DELETE /api/collections/:collection/:id      - Delete item
 *
 * @module routes/collections
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  products,
  categories,
  customers,
  sales,
  saleItems,
  inventoryMovements,
  tenants,
  users,
  syncQueue,
} from '../db/schema.js';

// Map collection names to their Drizzle tables
const COLLECTIONS = {
  products,
  categories,
  customers,
  sales,
  sale_items: saleItems,
  inventory_movements: inventoryMovements,
  tenants,
  users,
} as const;

type CollectionName = keyof typeof COLLECTIONS;

// Collections that require tenant isolation
const TENANT_ISOLATED_COLLECTIONS: CollectionName[] = [
  'products',
  'categories',
  'customers',
  'sales',
  'inventory_movements',
];

interface ListQuery {
  page?: string;
  perPage?: string;
  filter?: string;
  sort?: string;
  search?: string;
}

interface TokenPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
}

export async function collectionsRoutes(app: FastifyInstance): Promise<void> {
  // Authentication hook for all collection routes
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const payload = request.user as TokenPayload;
      request.tenantId = payload.tenantId;
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
    }
  });

  /**
   * GET /api/collections/:collection
   * List items with pagination, filtering, and sorting
   */
  app.get<{
    Params: { collection: string };
    Querystring: ListQuery;
  }>('/:collection', async (request, reply) => {
    const { collection } = request.params;
    const { page = '1', perPage = '50' } = request.query;

    if (!isValidCollection(collection)) {
      return reply.status(404).send({ error: 'Collection not found' });
    }

    const table = COLLECTIONS[collection];
    const pageNum = Math.max(1, parseInt(page, 10));
    const limit = Math.min(100, Math.max(1, parseInt(perPage, 10)));
    const offset = (pageNum - 1) * limit;

    try {
      // Build query with tenant isolation
      let query = app.db.select().from(table);

      // Apply tenant filter for isolated collections (mandatory)
      if (TENANT_ISOLATED_COLLECTIONS.includes(collection)) {
        if (!request.tenantId) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'Tenant context required for this operation',
          });
        }
        // @ts-ignore - Dynamic table access
        query = query.where(eq(table.tenantId, request.tenantId));
      }

      // Get total count
      const countResult = await app.db
        .select({ count: sql<number>`count(*)` })
        .from(table)
        .where(
          TENANT_ISOLATED_COLLECTIONS.includes(collection) && request.tenantId
            ? // @ts-ignore - Dynamic table access
              eq(table.tenantId, request.tenantId)
            : undefined
        )
        .get();

      const totalItems = countResult?.count ?? 0;
      const totalPages = Math.ceil(totalItems / limit);

      // Apply pagination
      // @ts-ignore - Dynamic table access
      const items = await query.limit(limit).offset(offset).all();

      return {
        items,
        page: pageNum,
        perPage: limit,
        totalItems,
        totalPages,
      };
    } catch (err) {
      console.error('[Collections] List error:', err);
      return reply.status(500).send({ error: 'Failed to fetch items' });
    }
  });

  /**
   * GET /api/collections/:collection/:id
   * Get a single item by ID
   */
  app.get<{
    Params: { collection: string; id: string };
  }>('/:collection/:id', async (request, reply) => {
    const { collection, id } = request.params;

    if (!isValidCollection(collection)) {
      return reply.status(404).send({ error: 'Collection not found' });
    }

    const table = COLLECTIONS[collection];

    try {
      // Apply tenant filter for isolated collections (mandatory)
      if (TENANT_ISOLATED_COLLECTIONS.includes(collection)) {
        if (!request.tenantId) {
          return reply.status(403).send({
            error: 'Forbidden',
            message: 'Tenant context required for this operation',
          });
        }
        // @ts-ignore - Dynamic table access
        const item = await app.db
          .select()
          .from(table)
          // @ts-ignore - Dynamic table access
          .where(and(eq(table.id, id), eq(table.tenantId, request.tenantId)))
          .get();

        if (!item) {
          return reply.status(404).send({ error: 'Item not found' });
        }

        return item;
      }

      // For non-isolated collections
      // @ts-ignore - Dynamic table access
      const item = await app.db.select().from(table).where(eq(table.id, id)).get();

      if (!item) {
        return reply.status(404).send({ error: 'Item not found' });
      }

      return item;
    } catch (err) {
      console.error('[Collections] Get error:', err);
      return reply.status(500).send({ error: 'Failed to fetch item' });
    }
  });

  /**
   * POST /api/collections/:collection
   * Create a new item
   */
  app.post<{
    Params: { collection: string };
    Body: Record<string, unknown>;
  }>('/:collection', async (request, reply) => {
    const { collection } = request.params;
    const body = request.body;

    if (!isValidCollection(collection)) {
      return reply.status(404).send({ error: 'Collection not found' });
    }

    // Prevent direct creation of tenants and users via this endpoint
    if (collection === 'tenants' || collection === 'users') {
      return reply
        .status(403)
        .send({ error: 'Cannot create items in this collection via this endpoint' });
    }

    const table = COLLECTIONS[collection];
    const now = new Date().toISOString();
    const id = nanoid();

    try {
      // Prepare data with required fields
      const data: Record<string, unknown> = {
        ...body,
        id,
        createdAt: now,
        updatedAt: now,
      };

      // Add tenant ID for isolated collections
      if (TENANT_ISOLATED_COLLECTIONS.includes(collection) && request.tenantId) {
        data.tenantId = request.tenantId;
      }

      // Set sync status for syncable collections
      // @ts-ignore - Dynamic property check
      if ('syncStatus' in (table as unknown as Record<string, unknown>)) {
        data.syncStatus = 'pending';
        data.syncVersion = 1;
      }

      // @ts-ignore - Dynamic table access
      await app.db.insert(table).values(data);

      // Add to sync queue
      if (TENANT_ISOLATED_COLLECTIONS.includes(collection) && request.tenantId) {
        await addToSyncQueue(app, request.tenantId, collection, id, 'create', data);
      }

      // Broadcast SSE event
      app.sse.broadcast(`${collection}.create`, { id, ...data });

      // Return created item
      // @ts-ignore - Dynamic table access
      const created = await app.db.select().from(table).where(eq(table.id, id)).get();

      return reply.status(201).send(created);
    } catch (err) {
      console.error('[Collections] Create error:', err);
      return reply.status(500).send({ error: 'Failed to create item' });
    }
  });

  /**
   * PUT /api/collections/:collection/:id
   * Update an existing item
   */
  app.put<{
    Params: { collection: string; id: string };
    Body: Record<string, unknown>;
  }>('/:collection/:id', async (request, reply) => {
    const { collection, id } = request.params;
    const body = request.body;

    if (!isValidCollection(collection)) {
      return reply.status(404).send({ error: 'Collection not found' });
    }

    // Prevent direct modification of tenants via this endpoint
    if (collection === 'tenants') {
      return reply
        .status(403)
        .send({ error: 'Cannot modify items in this collection via this endpoint' });
    }

    const table = COLLECTIONS[collection];
    const now = new Date().toISOString();

    try {
      // Check item exists and belongs to tenant
      // @ts-ignore - Dynamic table access
      let existing = await app.db.select().from(table).where(eq(table.id, id)).get();

      if (!existing) {
        return reply.status(404).send({ error: 'Item not found' });
      }

      // Check tenant access for isolated collections
      if (
        TENANT_ISOLATED_COLLECTIONS.includes(collection) &&
        request.tenantId &&
        // @ts-ignore - Dynamic property access
        existing.tenantId !== request.tenantId
      ) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // Prepare update data
      const data: Record<string, unknown> = {
        ...body,
        updatedAt: now,
      };

      // Remove fields that shouldn't be updated
      delete data.id;
      delete data.createdAt;
      delete data.tenantId;

      // Increment sync version
      // @ts-ignore - Dynamic property access
      if (existing.syncVersion !== undefined) {
        // @ts-ignore - Dynamic property access
        data.syncVersion = (existing.syncVersion || 0) + 1;
        data.syncStatus = 'pending';
      }

      // @ts-ignore - Dynamic table access
      await app.db.update(table).set(data).where(eq(table.id, id));

      // Add to sync queue
      if (TENANT_ISOLATED_COLLECTIONS.includes(collection) && request.tenantId) {
        await addToSyncQueue(app, request.tenantId, collection, id, 'update', data);
      }

      // Broadcast SSE event
      app.sse.broadcast(`${collection}.update`, { id, ...data });

      // Return updated item
      // @ts-ignore - Dynamic table access
      const updated = await app.db.select().from(table).where(eq(table.id, id)).get();

      return updated;
    } catch (err) {
      console.error('[Collections] Update error:', err);
      return reply.status(500).send({ error: 'Failed to update item' });
    }
  });

  /**
   * DELETE /api/collections/:collection/:id
   * Delete an item
   */
  app.delete<{
    Params: { collection: string; id: string };
  }>('/:collection/:id', async (request, reply) => {
    const { collection, id } = request.params;
    const payload = request.user as TokenPayload;

    if (!isValidCollection(collection)) {
      return reply.status(404).send({ error: 'Collection not found' });
    }

    // Prevent deletion of tenants and users via this endpoint
    if (collection === 'tenants') {
      return reply
        .status(403)
        .send({ error: 'Cannot delete items in this collection via this endpoint' });
    }

    // Only admins can delete
    if (payload.role !== 'admin') {
      return reply.status(403).send({ error: 'Only administrators can delete items' });
    }

    const table = COLLECTIONS[collection];

    try {
      // Check item exists and belongs to tenant
      // @ts-ignore - Dynamic table access
      const existing = await app.db.select().from(table).where(eq(table.id, id)).get();

      if (!existing) {
        return reply.status(404).send({ error: 'Item not found' });
      }

      // Check tenant access for isolated collections
      if (
        TENANT_ISOLATED_COLLECTIONS.includes(collection) &&
        request.tenantId &&
        // @ts-ignore - Dynamic property access
        existing.tenantId !== request.tenantId
      ) {
        return reply.status(403).send({ error: 'Access denied' });
      }

      // @ts-ignore - Dynamic table access
      await app.db.delete(table).where(eq(table.id, id));

      // Add to sync queue
      if (TENANT_ISOLATED_COLLECTIONS.includes(collection) && request.tenantId) {
        await addToSyncQueue(app, request.tenantId, collection, id, 'delete', { id });
      }

      // Broadcast SSE event
      app.sse.broadcast(`${collection}.delete`, { id });

      return { success: true, id };
    } catch (err) {
      console.error('[Collections] Delete error:', err);
      return reply.status(500).send({ error: 'Failed to delete item' });
    }
  });
}

/**
 * Check if a collection name is valid
 */
function isValidCollection(name: string): name is CollectionName {
  return name in COLLECTIONS;
}

/**
 * Add an operation to the sync queue
 */
async function addToSyncQueue(
  app: FastifyInstance,
  tenantId: string,
  entityType: string,
  entityId: string,
  operation: 'create' | 'update' | 'delete',
  data: Record<string, unknown>
): Promise<void> {
  const now = new Date().toISOString();
  await app.db.insert(syncQueue).values({
    id: nanoid(),
    tenantId,
    entityType,
    entityId,
    operation,
    data,
    localVersion: 1,
    attempts: 0,
    createdAt: now,
  });
}
