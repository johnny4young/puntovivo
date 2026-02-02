/**
 * Authentication Routes
 *
 * Handles user authentication with JWT tokens.
 *
 * Endpoints:
 * - POST /api/auth/login - Authenticate user
 * - POST /api/auth/logout - Invalidate token (client-side)
 * - POST /api/auth/refresh - Refresh JWT token
 * - GET /api/auth/me - Get current user info
 *
 * @module routes/auth
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eq } from 'drizzle-orm';
import * as argon2 from 'argon2';
import { users, tenants } from '../db/schema.js';

interface LoginBody {
  email: string;
  password: string;
}

interface TokenPayload {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * POST /api/auth/login
   * Authenticate user with email and password
   */
  app.post<{ Body: LoginBody }>('/login', {
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', format: 'email' },
          password: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: async (request, reply) => {
      const { email, password } = request.body;

      // Find user by email
      const user = await app.db.select().from(users).where(eq(users.email, email)).get();

      if (!user) {
        return reply.status(401).send({
          error: 'Invalid credentials',
          message: 'Email or password is incorrect',
        });
      }

      // Check if user is active
      if (!user.isActive) {
        return reply.status(401).send({
          error: 'Account disabled',
          message: 'Your account has been disabled. Please contact an administrator.',
        });
      }

      // Verify password
      const isValidPassword = await argon2.verify(user.passwordHash, password);
      if (!isValidPassword) {
        return reply.status(401).send({
          error: 'Invalid credentials',
          message: 'Email or password is incorrect',
        });
      }

      // Get tenant info
      const tenant = await app.db.select().from(tenants).where(eq(tenants.id, user.tenantId)).get();

      if (!tenant || !tenant.isActive) {
        return reply.status(401).send({
          error: 'Tenant disabled',
          message: 'Your organization has been disabled. Please contact support.',
        });
      }

      // Generate JWT token
      const tokenPayload: TokenPayload = {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        role: user.role,
      };

      const token = app.jwt.sign(tokenPayload);

      return {
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
        },
        tenant: {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
        },
      };
    },
  });

  /**
   * POST /api/auth/logout
   * Logout is handled client-side by removing the token.
   * This endpoint is provided for API completeness.
   */
  app.post('/logout', async () => {
    return { success: true, message: 'Logged out successfully' };
  });

  /**
   * POST /api/auth/refresh
   * Refresh the JWT token
   */
  app.post('/refresh', {
    preHandler: [authenticate],
    handler: async request => {
      const payload = request.user as TokenPayload;

      // Verify user still exists and is active
      const user = await app.db.select().from(users).where(eq(users.id, payload.userId)).get();

      if (!user || !user.isActive) {
        throw { statusCode: 401, message: 'User not found or disabled' };
      }

      // Generate new token
      const newPayload: TokenPayload = {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        role: user.role,
      };

      const token = app.jwt.sign(newPayload);

      return { token };
    },
  });

  /**
   * GET /api/auth/me
   * Get current authenticated user info
   */
  app.get('/me', {
    preHandler: [authenticate],
    handler: async request => {
      const payload = request.user as TokenPayload;

      // Get full user info
      const user = await app.db.select().from(users).where(eq(users.id, payload.userId)).get();

      if (!user) {
        throw { statusCode: 404, message: 'User not found' };
      }

      // Get tenant info
      const tenant = await app.db.select().from(tenants).where(eq(tenants.id, user.tenantId)).get();

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          tenantId: user.tenantId,
          isActive: user.isActive,
          createdAt: user.createdAt,
        },
        tenant: tenant
          ? {
              id: tenant.id,
              name: tenant.name,
              slug: tenant.slug,
              settings: tenant.settings,
            }
          : null,
      };
    },
  });

  /**
   * PUT /api/auth/password
   * Change password for current user
   */
  app.put<{ Body: { currentPassword: string; newPassword: string } }>('/password', {
    preHandler: [authenticate],
    schema: {
      body: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: { type: 'string', minLength: 1 },
          newPassword: { type: 'string', minLength: 6 },
        },
      },
    },
    handler: async (request, reply) => {
      const payload = request.user as TokenPayload;
      const { currentPassword, newPassword } = request.body;

      // Get user
      const user = await app.db.select().from(users).where(eq(users.id, payload.userId)).get();

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      // Verify current password
      const isValidPassword = await argon2.verify(user.passwordHash, currentPassword);
      if (!isValidPassword) {
        return reply.status(401).send({ error: 'Current password is incorrect' });
      }

      // Hash new password
      const newPasswordHash = await argon2.hash(newPassword);

      // Update password
      await app.db
        .update(users)
        .set({
          passwordHash: newPasswordHash,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(users.id, payload.userId));

      return { success: true, message: 'Password changed successfully' };
    },
  });

  /**
   * Authentication preHandler hook
   */
  async function authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      await request.jwtVerify();

      // Set tenant ID from token
      const payload = request.user as TokenPayload;
      request.tenantId = payload.tenantId;
    } catch (err) {
      reply.status(401).send({ error: 'Unauthorized', message: 'Invalid or expired token' });
    }
  }
}
