/**
 * Collections Routes Tests
 *
 * @module __tests__/collections.test
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type OpenYojobServer } from '../index';
import { getDatabase } from '../db';
import { users, tenants, products, categories } from '../db/schema';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';

let server: OpenYojobServer;
let testTenantId: string;
let testUserId: string;
let authToken: string;
let testCategoryId: string;
const testDbPath = ':memory:';

describe('Collections Routes', () => {
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
      settings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create test user
    testUserId = nanoid();
    const passwordHash = await hash('testpassword123');
    await db.insert(users).values({
      id: testUserId,
      tenantId: testTenantId,
      email: 'test@example.com',
      passwordHash,
      name: 'Test User',
      role: 'admin',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create test category
    testCategoryId = nanoid();
    await db.insert(categories).values({
      id: testCategoryId,
      tenantId: testTenantId,
      name: 'Test Category',
      description: 'A test category',
      parentId: null,
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

  describe('GET /api/collections/:collection', () => {
    it('should list products for tenant', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/collections/products',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toBeDefined();
      expect(body.page).toBe(1);
      expect(body.perPage).toBe(50);
      expect(body.totalItems).toBeDefined();
      expect(body.totalPages).toBeDefined();
    });

    it('should list categories for tenant', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/collections/categories',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items.length).toBeGreaterThanOrEqual(1);
      expect(body.items[0].name).toBe('Test Category');
    });

    it('should support pagination', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/collections/products?page=1&perPage=10',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.page).toBe(1);
      expect(body.perPage).toBe(10);
    });

    it('should reject unknown collection', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/collections/unknown',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(404);
      const body = JSON.parse(response.body);
      expect(body.error).toContain('Collection not found');
    });

    it('should require authentication', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/collections/products',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/collections/:collection', () => {
    it('should create a new product', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/collections/products',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
        payload: {
          name: 'New Product',
          sku: 'SKU-001',
          barcode: '1234567890',
          categoryId: testCategoryId,
          price: 99.99,
          cost: 50.0,
          taxRate: 19.0,
          stockQuantity: 100,
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
      expect(body.name).toBe('New Product');
      expect(body.sku).toBe('SKU-001');
      expect(body.tenantId).toBe(testTenantId);
    });

    it('should create a new category', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/collections/categories',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
        payload: {
          name: 'New Category',
          description: 'A new test category',
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.body);
      expect(body.id).toBeDefined();
      expect(body.name).toBe('New Category');
    });
  });

  describe('GET /api/collections/:collection/:id', () => {
    let productId: string;

    beforeAll(async () => {
      // Create a product to fetch
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/collections/products',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
        payload: {
          name: 'Fetchable Product',
          sku: 'SKU-FETCH',
          price: 50.0,
          cost: 25.0,
        },
      });
      const body = JSON.parse(response.body);
      productId = body.id;
    });

    it('should get a single product by ID', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: `/api/collections/products/${productId}`,
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.id).toBe(productId);
      expect(body.name).toBe('Fetchable Product');
    });

    it('should return 404 for non-existent ID', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/collections/products/non-existent-id',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /api/collections/:collection/:id', () => {
    let productId: string;

    beforeAll(async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/collections/products',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
        payload: {
          name: 'Updatable Product',
          sku: 'SKU-UPDATE',
          price: 100.0,
          cost: 50.0,
        },
      });
      const body = JSON.parse(response.body);
      productId = body.id;
    });

    it('should update a product', async () => {
      const response = await server.app.inject({
        method: 'PUT',
        url: `/api/collections/products/${productId}`,
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
        payload: {
          name: 'Updated Product Name',
          price: 150.0,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.name).toBe('Updated Product Name');
      expect(body.price).toBe(150.0);
    });

    it('should return 404 for non-existent ID', async () => {
      const response = await server.app.inject({
        method: 'PUT',
        url: '/api/collections/products/non-existent-id',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
        payload: {
          name: 'Will Fail',
        },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /api/collections/:collection/:id', () => {
    let productId: string;

    beforeEach(async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/collections/products',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
        payload: {
          name: 'Deletable Product',
          sku: `SKU-DELETE-${nanoid(6)}`,
          price: 75.0,
          cost: 35.0,
        },
      });
      const body = JSON.parse(response.body);
      productId = body.id;
    });

    it('should delete a product', async () => {
      const response = await server.app.inject({
        method: 'DELETE',
        url: `/api/collections/products/${productId}`,
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
      expect(body.id).toBe(productId);

      // Verify it's deleted
      const getResponse = await server.app.inject({
        method: 'GET',
        url: `/api/collections/products/${productId}`,
        headers: {
          Authorization: `Bearer ${authToken}`,
          'X-Tenant-ID': testTenantId,
        },
      });
      expect(getResponse.statusCode).toBe(404);
    });
  });
});
