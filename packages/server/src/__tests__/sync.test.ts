/**
 * Sync Routes Tests
 *
 * @module __tests__/sync.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type OpenYojobServer } from '../index';
import { getDatabase } from '../db';
import { users, tenants, syncQueue } from '../db/schema';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';

let server: OpenYojobServer;
let testTenantId: string;
let authToken: string;
const testDbPath = ':memory:';

describe('Sync Routes', () => {
  beforeAll(async () => {
    // Create server (initializes database automatically)
    server = await createServer({
      dbPath: testDbPath,
      verbose: false,
    });

    const db = getDatabase();

    // Create test tenant
    testTenantId = nanoid();
    await db.insert(tenants).values({
      id: testTenantId,
      name: 'Test Tenant',
      slug: 'test-tenant',
      settings: '{}',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create test user
    const testUserId = nanoid();
    const passwordHash = await hash('testpassword123');
    await db.insert(users).values({
      id: testUserId,
      tenantId: testTenantId,
      email: 'test@example.com',
      passwordHash,
      name: 'Test User',
      role: 'admin',
      active: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Get auth token
    const response = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'test@example.com',
        password: 'testpassword123',
      },
    });
    const body = JSON.parse(response.body);
    authToken = body.token;
  });

  afterAll(async () => {
    await server.close();
  });

  describe('GET /api/sync/status', () => {
    it('should return sync status', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/sync/status',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.pendingCount).toBeDefined();
      expect(body.conflictsCount).toBeDefined();
      expect(body.externalSyncEnabled).toBe(false);
      expect(body.status).toBe('synced');
    });
  });

  describe('POST /api/sync/queue', () => {
    it('should add item to sync queue', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/sync/queue',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
        payload: {
          entityType: 'products',
          entityId: 'test-product-1',
          operation: 'create',
          data: { name: 'Test Product', price: 100 },
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
      expect(body.entityType).toBe('products');
      expect(body.operation).toBe('create');
    });

    it('should require all fields', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/sync/queue',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
        payload: {
          entityType: 'products',
          // missing entityId, operation, data
        },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/sync/queue', () => {
    it('should return pending sync items', async () => {
      // Add some items first
      await server.app.inject({
        method: 'POST',
        url: '/api/sync/queue',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
        payload: {
          entityType: 'customers',
          entityId: 'test-customer-1',
          operation: 'create',
          data: { name: 'Test Customer' },
        },
      });

      const response = await server.app.inject({
        method: 'GET',
        url: '/api/sync/queue',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeDefined();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.count).toBeGreaterThanOrEqual(1);
    });

    it('should support limit parameter', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/sync/queue?limit=5',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBeLessThanOrEqual(5);
    });
  });

  describe('DELETE /api/sync/queue/:id', () => {
    let queueItemId: string;

    beforeAll(async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/sync/queue',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
        payload: {
          entityType: 'products',
          entityId: 'test-product-delete',
          operation: 'update',
          data: { name: 'Updated Product' },
        },
      });
      const body = JSON.parse(response.body);
      queueItemId = body.id;
    });

    it('should delete sync queue item', async () => {
      const response = await server.app.inject({
        method: 'DELETE',
        url: `/api/sync/queue/${queueItemId}`,
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });

    it('should return 404 for non-existent ID', async () => {
      const response = await server.app.inject({
        method: 'DELETE',
        url: '/api/sync/queue/non-existent-id',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /api/sync/push (501 Stub)', () => {
    it('should return 501 Not Implemented', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/sync/push',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(501);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Not Implemented');
      expect(body.message).toContain('Phase 2');
    });
  });

  describe('GET /api/sync/pull (501 Stub)', () => {
    it('should return 501 Not Implemented', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/sync/pull',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(501);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Not Implemented');
    });
  });

  describe('POST /api/sync/resolve (501 Stub)', () => {
    it('should return 501 Not Implemented', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/sync/resolve',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
        payload: {
          conflictId: 'test-conflict-1',
          resolution: 'local',
        },
      });

      expect(response.statusCode).toBe(501);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Not Implemented');
    });
  });

  describe('GET /api/sync/conflicts', () => {
    it('should return empty conflicts list', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/sync/conflicts',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeDefined();
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.count).toBeDefined();
    });
  });
});
