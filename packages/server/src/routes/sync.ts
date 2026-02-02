/**
 * Sync Routes
 *
 * Handles local sync queue management and external sync operations.
 *
 * LOCAL QUEUE (Implemented - Phase 1):
 * - POST   /api/sync/queue          - Add operation to local sync queue
 * - GET    /api/sync/queue          - Get pending operations
 * - DELETE /api/sync/queue/:id      - Remove operation from queue
 * - GET    /api/sync/status         - Get sync status
 *
 * EXTERNAL SYNC (Returns 501 - Phase 2):
 * - POST   /api/sync/push           - Push local changes to remote server
 * - GET    /api/sync/pull           - Pull remote changes
 * - POST   /api/sync/resolve        - Resolve sync conflict
 *
 * @module routes/sync
 *
 * ============================================================================
 * PHASE 2 IMPLEMENTATION NOTES
 * ============================================================================
 *
 * When implementing external sync, the following endpoints need to be completed:
 *
 * 1. POST /api/sync/push
 *    - Accept array of sync queue items
 *    - For each item:
 *      a. Send to remote server
 *      b. Handle conflicts (version mismatch)
 *      c. Update local sync_status to 'synced' or 'conflict'
 *      d. Remove from sync_queue on success
 *    - Request body: { changes: SyncChange[], clientTimestamp: string }
 *    - Response: { success: boolean, synced: number, conflicts: SyncConflict[] }
 *
 * 2. GET /api/sync/pull
 *    - Accept ?since=timestamp parameter
 *    - Fetch changes from remote server since that timestamp
 *    - Apply changes to local database
 *    - Handle conflicts with local pending changes
 *    - Response: { changes: SyncChange[], serverTimestamp: string, hasMore: boolean }
 *
 * 3. POST /api/sync/resolve
 *    - Accept conflict resolution: { conflictId: string, resolution: 'local_wins' | 'remote_wins' | 'merged', mergedData?: object }
 *    - Apply resolution to sync_conflicts table
 *    - Update the entity with resolved data
 *    - Response: { success: boolean, entity: object }
 *
 * Configuration needed for Phase 2:
 * - Remote server URL (e.g., SYNC_SERVER_URL env var)
 * - Authentication token for remote server
 * - Sync interval (for background sync)
 * - Retry policy (exponential backoff)
 *
 * Suggested libraries:
 * - node-fetch or undici for HTTP requests
 * - p-retry for retry logic
 * - cron or node-schedule for background sync
 *
 * ============================================================================
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq, and, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { syncQueue, syncConflicts } from '../db/schema.js';

interface TokenPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
}

interface SyncQueueBody {
  entityType: string;
  entityId: string;
  operation: 'create' | 'update' | 'delete';
  data?: Record<string, unknown>;
}

export async function syncRoutes(app: FastifyInstance): Promise<void> {
  // Authentication hook for all sync routes
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
      const payload = request.user as TokenPayload;
      request.tenantId = payload.tenantId;
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
    }
  });

  // ============================================================================
  // LOCAL SYNC QUEUE ENDPOINTS (Phase 1 - Implemented)
  // ============================================================================

  /**
   * POST /api/sync/queue
   * Add an operation to the local sync queue
   */
  app.post<{ Body: SyncQueueBody }>('/queue', {
    schema: {
      body: {
        type: 'object',
        required: ['entityType', 'entityId', 'operation'],
        properties: {
          entityType: { type: 'string' },
          entityId: { type: 'string' },
          operation: { type: 'string', enum: ['create', 'update', 'delete'] },
          data: { type: 'object' },
        },
      },
    },
    handler: async (request, reply) => {
      const { entityType, entityId, operation, data } = request.body;
      const tenantId = request.tenantId;

      if (!tenantId) {
        return reply.status(400).send({ error: 'Tenant ID required' });
      }

      const now = new Date().toISOString();
      const id = nanoid();

      await app.db.insert(syncQueue).values({
        id,
        tenantId,
        entityType,
        entityId,
        operation,
        data: data || {},
        localVersion: 1,
        attempts: 0,
        createdAt: now,
      });

      return reply.status(201).send({
        id,
        entityType,
        entityId,
        operation,
        createdAt: now,
      });
    },
  });

  /**
   * GET /api/sync/queue
   * Get pending operations from the sync queue
   */
  app.get<{ Querystring: { limit?: string } }>('/queue', async (request, reply) => {
    const tenantId = request.tenantId;
    const limit = Math.min(100, parseInt(request.query.limit || '50', 10));

    if (!tenantId) {
      return reply.status(400).send({ error: 'Tenant ID required' });
    }

    const items = await app.db
      .select()
      .from(syncQueue)
      .where(eq(syncQueue.tenantId, tenantId))
      .orderBy(syncQueue.createdAt)
      .limit(limit)
      .all();

    return {
      items,
      count: items.length,
    };
  });

  /**
   * DELETE /api/sync/queue/:id
   * Remove an operation from the sync queue (after successful sync)
   */
  app.delete<{ Params: { id: string } }>('/queue/:id', async (request, reply) => {
    const { id } = request.params;
    const tenantId = request.tenantId;

    if (!tenantId) {
      return reply.status(400).send({ error: 'Tenant ID required' });
    }

    // Verify the item belongs to the tenant
    const item = await app.db
      .select()
      .from(syncQueue)
      .where(and(eq(syncQueue.id, id), eq(syncQueue.tenantId, tenantId)))
      .get();

    if (!item) {
      return reply.status(404).send({ error: 'Sync queue item not found' });
    }

    await app.db.delete(syncQueue).where(eq(syncQueue.id, id));

    return { success: true, id };
  });

  /**
   * GET /api/sync/status
   * Get the current sync status
   */
  app.get('/status', async (request, reply) => {
    const tenantId = request.tenantId;

    if (!tenantId) {
      return reply.status(400).send({ error: 'Tenant ID required' });
    }

    // Count pending queue items
    const queueItems = await app.db
      .select()
      .from(syncQueue)
      .where(eq(syncQueue.tenantId, tenantId))
      .all();

    // Count unresolved conflicts
    const conflicts = await app.db
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.tenantId, tenantId), eq(syncConflicts.status, 'pending')))
      .all();

    return {
      pendingCount: queueItems.length,
      conflictsCount: conflicts.length,
      externalSyncEnabled: false, // Phase 2: Change to true when implemented
      lastSyncAt: null, // Phase 2: Store and return last sync timestamp
      status: queueItems.length === 0 ? 'synced' : 'pending',
    };
  });

  /**
   * GET /api/sync/conflicts
   * Get unresolved sync conflicts
   */
  app.get('/conflicts', async (request, reply) => {
    const tenantId = request.tenantId;

    if (!tenantId) {
      return reply.status(400).send({ error: 'Tenant ID required' });
    }

    const conflicts = await app.db
      .select()
      .from(syncConflicts)
      .where(and(eq(syncConflicts.tenantId, tenantId), eq(syncConflicts.status, 'pending')))
      .orderBy(desc(syncConflicts.createdAt))
      .all();

    return {
      items: conflicts,
      count: conflicts.length,
    };
  });

  // ============================================================================
  // EXTERNAL SYNC ENDPOINTS (Phase 2 - Returns 501 Not Implemented)
  // ============================================================================

  /**
   * POST /api/sync/push
   * Push local changes to remote server
   *
   * PHASE 2 TODO:
   * - Accept SyncPushRequest with changes array
   * - Send each change to remote server
   * - Handle version conflicts
   * - Update local sync_status
   * - Remove successfully synced items from queue
   */
  app.post('/push', async (_request, reply) => {
    return reply.status(501).send({
      error: 'Not Implemented',
      message: 'External sync push will be available in Phase 2',
      phase: 2,
      endpoint: 'POST /api/sync/push',
      expectedRequest: {
        changes: [
          {
            entityType: 'products',
            entityId: 'abc123',
            operation: 'create|update|delete',
            data: {},
            localVersion: 1,
          },
        ],
        clientTimestamp: '2024-01-01T00:00:00.000Z',
      },
      expectedResponse: {
        success: true,
        synced: 5,
        conflicts: [],
        errors: [],
      },
    });
  });

  /**
   * GET /api/sync/pull
   * Pull remote changes from server
   *
   * PHASE 2 TODO:
   * - Accept ?since=timestamp query parameter
   * - Fetch changes from remote server
   * - Apply changes to local database
   * - Detect conflicts with local pending changes
   */
  app.get('/pull', async (_request, reply) => {
    return reply.status(501).send({
      error: 'Not Implemented',
      message: 'External sync pull will be available in Phase 2',
      phase: 2,
      endpoint: 'GET /api/sync/pull?since=timestamp',
      expectedResponse: {
        changes: [
          {
            entityType: 'products',
            entityId: 'abc123',
            operation: 'create|update|delete',
            data: {},
            remoteVersion: 2,
          },
        ],
        serverTimestamp: '2024-01-01T00:00:00.000Z',
        hasMore: false,
      },
    });
  });

  /**
   * POST /api/sync/resolve
   * Resolve a sync conflict
   *
   * PHASE 2 TODO:
   * - Accept conflict ID and resolution strategy
   * - Apply resolution (local_wins, remote_wins, or merged data)
   * - Update entity with resolved data
   * - Mark conflict as resolved
   */
  app.post('/resolve', async (_request, reply) => {
    return reply.status(501).send({
      error: 'Not Implemented',
      message: 'Conflict resolution will be available in Phase 2',
      phase: 2,
      endpoint: 'POST /api/sync/resolve',
      expectedRequest: {
        conflictId: 'conflict_abc123',
        resolution: 'local_wins|remote_wins|merged',
        mergedData: {},
      },
      expectedResponse: {
        success: true,
        entity: {},
        resolution: 'local_wins',
      },
    });
  });
}
