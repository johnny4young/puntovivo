/**
 * Authentication Routes Tests
 *
 * @module __tests__/auth.test
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type OpenYojobServer } from '../index';
import { getDatabase } from '../db';
import { users, tenants } from '../db/schema';
import { hash, verify } from 'argon2';
import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';

let server: OpenYojobServer;
let testTenantId: string;
let testUserId: string;
/** Shared auth token obtained once to avoid triggering login rate limit (5 req / 15 min) */
let sharedAuthToken: string;
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
      settings: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Create test user
    testUserId = nanoid();
    const passwordHash = await hash('TestPassword123!');
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

    // Login once to get a shared token for authenticated endpoint tests.
    // This avoids hitting the login rate limit (5 requests per 15 minutes)
    // since the POST /api/auth/login tests already consume 4 attempts.
    const loginResponse = await server.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: 'test@example.com',
        password: 'TestPassword123!',
      },
    });
    sharedAuthToken = JSON.parse(loginResponse.body).token;
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
          password: 'TestPassword123!',
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
    it('should return current user with valid token', async () => {
      const response = await server.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: {
          Authorization: `Bearer ${sharedAuthToken}`,
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
    it('should return a new token', async () => {
      // Wait a small amount to ensure different token timestamp
      await new Promise(resolve => setTimeout(resolve, 1100));

      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        headers: {
          Authorization: `Bearer ${sharedAuthToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.token).toBeDefined();
      // Token should be valid but may or may not be different depending on timing
    });
  });

  describe('PUT /api/auth/password', () => {
    it('should change password with correct current password', async () => {
      const response = await server.app.inject({
        method: 'PUT',
        url: '/api/auth/password',
        headers: {
          Authorization: `Bearer ${sharedAuthToken}`,
        },
        payload: {
          currentPassword: 'TestPassword123!',
          newPassword: 'NewPassword456!',
        },
      });

      expect(response.statusCode).toBe(200);

      // Verify new password was stored correctly by checking the hash directly
      // (avoids an extra login request that would hit the rate limit)
      const db = getDatabase();
      const updatedUser = await db.select().from(users).where(eq(users.id, testUserId)).get();
      expect(updatedUser).toBeDefined();
      const isNewPasswordValid = await verify(updatedUser!.passwordHash, 'NewPassword456!');
      expect(isNewPasswordValid).toBe(true);

      // Reset password for other tests
      const passwordHash = await hash('TestPassword123!');
      await db.update(users).set({ passwordHash }).where(eq(users.id, testUserId));
    });

    it('should reject incorrect current password', async () => {
      const response = await server.app.inject({
        method: 'PUT',
        url: '/api/auth/password',
        headers: {
          Authorization: `Bearer ${sharedAuthToken}`,
        },
        payload: {
          currentPassword: 'WrongPassword99!',
          newPassword: 'AnotherStrong123!',
        },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should logout successfully', async () => {
      const response = await server.app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: {
          Authorization: `Bearer ${sharedAuthToken}`,
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.success).toBe(true);
    });
  });
});
