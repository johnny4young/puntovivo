import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { hashStaffPin } from '../../../packages/server/src/security/staffPins.js';

const DB_PATH = join(process.cwd(), 'packages/server/data/local.db');
const SQLITE_BUSY_TIMEOUT_MS = 5_000;

export const E2E_MANAGER_APPROVAL_PIN = '975310';

export interface SeedManagerApprovalOptions {
  reason: string;
  label: string;
  amount?: number;
  currencyCode?: string;
}

export interface ManagerApprovalState {
  status: string;
  decidedBy: string | null;
  decisionReason: string | null;
}

function openDb() {
  const db = new Database(DB_PATH);
  db.pragma(`busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
  return db;
}

function cleanApprovalRows(db: Database.Database, tenantId: string) {
  db.prepare(
    `delete from sync_outbox
     where tenant_id = ?
       and entity_type = 'manager_approval_requests'
       and entity_id glob 'e2e_approval_*'`
  ).run(tenantId);
  db.prepare(
    `delete from audit_logs
     where tenant_id = ?
       and resource_type = 'manager_approval'
       and resource_id glob 'e2e_approval_*'`
  ).run(tenantId);
  db.prepare(
    `delete from manager_approval_requests
     where tenant_id = ? and id glob 'e2e_approval_*'`
  ).run(tenantId);
}

/** Seed one deterministic pending request while preserving production PIN hashing. */
export async function seedManagerApprovalRequest(
  options: SeedManagerApprovalOptions
): Promise<{ requestId: string; managerId: string }> {
  const db = openDb();
  try {
    const manager = db
      .prepare(
        `select id, tenant_id as tenantId
         from users
         where email = 'e2e.manager@local.test' and is_active = 1`
      )
      .get() as { id: string; tenantId: string } | undefined;
    const cashier = db
      .prepare(
        `select id
         from users
         where email = 'e2e.cashier@local.test' and is_active = 1`
      )
      .get() as { id: string } | undefined;
    if (!manager || !cashier) {
      throw new Error('Manager approval E2E template users are missing');
    }
    const site = db
      .prepare(
        `select id
         from sites
         where tenant_id = ? and is_active = 1
         order by name asc, id asc
         limit 1`
      )
      .get(manager.tenantId) as { id: string } | undefined;
    if (!site) throw new Error('Manager approval E2E requires an active site');

    const pinHash = await hashStaffPin(E2E_MANAGER_APPROVAL_PIN);
    const requestId = `e2e_approval_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
    const now = new Date();
    const requestedAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
    const summary = JSON.stringify({
      label: options.label,
      ...(options.amount !== undefined && options.currencyCode
        ? { amount: options.amount, currencyCode: options.currencyCode }
        : {}),
    });

    db.transaction(() => {
      cleanApprovalRows(db, manager.tenantId);
      db.prepare('update users set staff_pin_hash = ?, updated_at = ? where id = ?').run(
        pinHash,
        requestedAt,
        manager.id
      );
      db.prepare(
        `insert into manager_approval_requests (
          id, tenant_id, site_id, requester_id, action, status, reason,
          resource_type, resource_id, summary, requested_at, expires_at,
          created_at, updated_at
        ) values (?, ?, ?, ?, 'sale_discount', 'pending', ?, 'sale', ?, ?, ?, ?, ?, ?)`
      ).run(
        requestId,
        manager.tenantId,
        site.id,
        cashier.id,
        options.reason,
        `e2e_sale_${randomUUID().slice(0, 8)}`,
        summary,
        requestedAt,
        expiresAt,
        requestedAt,
        requestedAt
      );
    })();

    return { requestId, managerId: manager.id };
  } finally {
    db.close();
  }
}

export function getManagerApprovalState(requestId: string): ManagerApprovalState | null {
  const db = openDb();
  try {
    const row = db
      .prepare(
        `select status, decided_by as decidedBy, decision_reason as decisionReason
         from manager_approval_requests
         where id = ?`
      )
      .get(requestId) as ManagerApprovalState | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

/** Restore the shared template manager to the no-PIN baseline after retries. */
export function resetManagerApprovalScenario(): void {
  const db = openDb();
  try {
    const manager = db
      .prepare(
        `select id, tenant_id as tenantId
         from users
         where email = 'e2e.manager@local.test'`
      )
      .get() as { id: string; tenantId: string } | undefined;
    if (!manager) return;
    db.transaction(() => {
      cleanApprovalRows(db, manager.tenantId);
      db.prepare('update users set staff_pin_hash = null, updated_at = ? where id = ?').run(
        new Date().toISOString(),
        manager.id
      );
    })();
  } finally {
    db.close();
  }
}
