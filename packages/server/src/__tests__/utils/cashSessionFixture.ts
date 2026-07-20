/**
 * committed-sale cash-session fixture.
 *
 * The `sales` table now enforces `CHECK (cash_session_id IS NOT NULL OR
 * status = 'draft')`, so any test that inserts a committed sale DIRECTLY
 * (bypassing the application layer, which always binds an active
 * session) must give that row a real `cash_sessions` id. This helper
 * mints the minimal chain a fixture needs — a closed session, plus a
 * company + site when the caller does not already own one — and returns
 * the session id to stamp on the fixture sale(s).
 *
 * The session is deliberately `status: 'closed'`: these fixtures model
 * historical sales, not an open shift, and nothing in the helper depends
 * on the session being open.
 */

import { nanoid } from 'nanoid';
import { getDatabase } from '../../db/index.js';
import { cashSessions, companies, sites } from '../../db/schema.js';

/** Arguments for {@link seedCommittedSaleSession}. */
export interface SeedCommittedSaleSessionOpts {
  /** Tenant the session (and its sale) belong to. */
  tenantId: string;
  /** User id recorded as the session's cashier (any existing user). */
  cashierId: string;
  /**
   * Existing site to anchor the session to. When omitted, the helper
   * mints a throwaway company + site under `tenantId` (for fixtures that
   * never set up a site of their own).
   */
  siteId?: string;
}

/**
 * Create a closed cash session (and a company + site when `siteId` is
 * not supplied) and return its id.
 */
export async function seedCommittedSaleSession(
  opts: SeedCommittedSaleSessionOpts
): Promise<string> {
  const db = getDatabase();
  const now = new Date().toISOString();

  let { siteId } = opts;
  if (!siteId) {
    const companyId = nanoid();
    siteId = nanoid();
    await db.insert(companies).values({
      id: companyId,
      tenantId: opts.tenantId,
      name: `CS Fixture Co ${companyId.slice(0, 6)}`,
      createdAt: now,
      updatedAt: now,
    });
    await db.insert(sites).values({
      id: siteId,
      tenantId: opts.tenantId,
      companyId,
      name: `CS Fixture Site ${siteId.slice(0, 6)}`,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  const cashSessionId = nanoid();
  await db.insert(cashSessions).values({
    id: cashSessionId,
    tenantId: opts.tenantId,
    siteId,
    cashierId: opts.cashierId,
    registerName: `cs-fixture-${cashSessionId.slice(0, 4)}`,
    openingFloat: 0,
    openingCountDenominations: [],
    expectedBalance: 0,
    status: 'closed',
    openedAt: now,
    closedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return cashSessionId;
}
