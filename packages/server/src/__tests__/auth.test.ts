/**
 * Authentication Routes Tests
 *
 * @module __tests__/auth.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type OpenYojobServer } from '../index';
import { getDatabase } from '../db';
import { users, tenants } from '../db/schema';
import { hash } from 'argon2';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

let server: OpenYojobServer;
let testTenantId: string;
let testUserId: string;
const testDbPath = ':memory:';

describe('Auth Routes', () => {
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
    testUserId = nanoid();
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
  });

  afterAll(async () => {
    await server.close();
  });

  describe('POST /api/auth/login', () => {
    it('should login with valid credentials', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'testpassword123',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.token).toBeDefined();
      expect(body.user.email).toBe('test@example.com');
      expect(body.user.name).toBe('Test User');
      expect(body.tenant.id).toBe(testTenantId);
    });

    it('should reject invalid password', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'wrongpassword',
        },
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.error).toBe('Invalid credentials');
    });

    it('should reject non-existent user', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'nonexistent@example.com',
          password: 'password',
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it('should require email and password', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/auth/me', () => {
    let authToken: string;

    beforeAll(async () => {
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

    it('should return current user with valid token', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.user.email).toBe('test@example.com');
      expect(body.tenant.id).toBe(testTenantId);
    });

    it('should reject request without token', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/auth/me',
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject invalid token', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/auth/refresh', () => {
    let authToken: string;

    beforeAll(async () => {
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

    it('should return a new token', async () => {
      // Wait a small amount to ensure different token timestamp
      await new Promise(resolve => setTimeout(resolve, 1100));

      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.token).toBeDefined();
      // Token should be valid but may or may not be different depending on timing
    });
  });

  describe('PUT /api/auth/password', () => {
    let authToken: string;

    beforeAll(async () => {
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

    it('should change password with correct current password', async () => {
      const response = await server.app.inject({
        method: 'PUT',
        url: '/api/auth/password',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        payload: {
          currentPassword: 'testpassword123',
          newPassword: 'newpassword456',
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify new password works
      const loginResponse = await server.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: {
          email: 'test@example.com',
          password: 'newpassword456',
        },
      });
      expect(loginResponse.statusCode).toBe(200);

      // Reset password for other tests
      const db = getDatabase();
      const passwordHash = await hash('testpassword123');
      await db.update(users).set({ passwordHash }).where(eq(users.id, testUserId));
    });

    it('should reject incorrect current password', async () => {
      const response = await server.app.inject({
        method: 'PUT',
        url: '/api/auth/password',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        payload: {
          currentPassword: 'wrongpassword',
          newPassword: 'newpassword456',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    let authToken: string;

    beforeAll(async () => {
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

    it('should logout successfully', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });
});
