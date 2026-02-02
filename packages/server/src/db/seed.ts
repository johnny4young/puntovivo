/**
 * Database Seed Module
 *
 * Seeds the database with default data including:
 * - Default tenant
 * - Admin user (admin@localhost / admin123)
 *
 * @module db/seed
 */

import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import * as argon2 from 'argon2';
import type { DatabaseInstance } from './index.js';
import { tenants, users } from './schema.js';

/**
 * Default admin credentials
 * IMPORTANT: Change these on first login in production!
 */
export const DEFAULT_ADMIN = {
  email: 'admin@localhost',
  password: 'admin123',
  name: 'Administrator',
};

export const DEFAULT_TENANT = {
  name: 'Default Business',
  slug: 'default',
};

/**
 * Seed default data if the database is empty
 */
export async function seedDefaultData(db: DatabaseInstance): Promise<void> {
  // Check if default tenant exists
  const existingTenant = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, DEFAULT_TENANT.slug))
    .get();

  if (existingTenant) {
    // Already seeded
    return;
  }

  console.log('[Database] Seeding default data...');

  const now = new Date().toISOString();
  const tenantId = nanoid();
  const userId = nanoid();

  // Create default tenant
  await db.insert(tenants).values({
    id: tenantId,
    name: DEFAULT_TENANT.name,
    slug: DEFAULT_TENANT.slug,
    settings: {},
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  // Hash the default password
  const passwordHash = await argon2.hash(DEFAULT_ADMIN.password);

  // Create admin user
  await db.insert(users).values({
    id: userId,
    tenantId: tenantId,
    email: DEFAULT_ADMIN.email,
    name: DEFAULT_ADMIN.name,
    passwordHash: passwordHash,
    role: 'admin',
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  console.log('[Database] Default data seeded successfully');
  console.log(`[Database] Admin user: ${DEFAULT_ADMIN.email} / ${DEFAULT_ADMIN.password}`);
  console.log('[Database] ⚠️  Please change the default password after first login!');
}
