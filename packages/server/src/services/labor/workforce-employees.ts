import type { UserRole } from '@puntovivo/shared/roles';
import { and, asc, eq, gt, ne, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { users } from '../../db/schema.js';

/** Minimal active employee choices; does not expose email, PIN, compensation or administrative user metadata. */
export function listWorkforceEmployees(
  db: DatabaseInstance,
  tenantId: string,
  role: UserRole,
  input: { search: string; cursor?: string | undefined; limit: number }
) {
  const escaped = input.search.replace(/[\\%_]/g, character => `\\${character}`);
  const rows = db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(
      and(
        eq(users.tenantId, tenantId),
        eq(users.isActive, true),
        ...(role === 'admin' ? [] : [ne(users.role, 'admin')]),
        ...(input.search ? [sql`${users.name} LIKE ${`%${escaped}%`} ESCAPE '\\'`] : []),
        ...(input.cursor ? [gt(users.id, input.cursor)] : [])
      )
    )
    .orderBy(asc(users.id))
    .limit(input.limit + 1)
    .all();
  const items = rows.slice(0, input.limit);
  return { items, nextCursor: rows.length > input.limit ? items.at(-1)!.id : null };
}
