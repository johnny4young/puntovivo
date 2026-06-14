/**
 * Sales router shared helpers.
 *
 * ENG-178 — function bodies extracted verbatim from the former flat
 * `trpc/routers/sales.ts` during the megafile decomposition. The helpers
 * are exported from this leaf only so the sales procedure modules
 * (queries / lifecycle / drafts / splitDraft) can share them; the procedure
 * bodies themselves are unchanged.
 *
 * @module trpc/routers/sales/helpers
 */
import { and, eq, sql } from 'drizzle-orm';

import { cashSessions, restaurantTables, sales } from '../../../db/schema.js';
import { throwServerError } from '../../../lib/errorCodes.js';
import type { Context } from '../../context.js';
import { asCriticalCommandContext } from '../../middleware/commandEnvelope.js';
import type { CompleteSaleContext } from '../../../application/sales/types.js';
import type { KdsHookContext } from '../../../services/kds/types.js';

/**
 * Adapt the tRPC `Context` to the `CompleteSaleContext` shape the
 * use-case services consume. ENG-179c — the parameter is typed
 * `CriticalCommandContext` (the augmented shape the `commandEnvelope`
 * middleware injects), so `ctx.envelope` / `ctx.deviceId` are read
 * directly. Only critical-command procedures call this helper.
 */
export function buildLifecycleContext(ctx: Context): CompleteSaleContext {
  const cc = asCriticalCommandContext(ctx);
  return {
    db: cc.db,
    tenantId: cc.tenantId,
    siteId: cc.siteId ?? '',
    user: { id: cc.user.id, role: cc.user.role },
    envelope: cc.envelope,
    deviceId: cc.deviceId,
    log: cc.req?.server?.log,
    sse: cc.req?.server?.sse ?? null,
  };
}

/**
 * ENG-098 — build the structural context shape consumed by the KDS
 * post-tx hooks. The SSE manager is read off the FastifyInstance
 * decorated at boot (`realtime/sse.ts`). When `req` is absent (unit
 * tests, internal callers) the helpers skip the broadcast silently.
 */
export function buildKdsHookContext(ctx: Context): KdsHookContext {
  return {
    db: ctx.db,
    tenantId: ctx.tenantId!,
    siteId: ctx.siteId ?? null,
    user: ctx.user ? { id: ctx.user.id } : null,
    sse: ctx.req?.server?.sse ?? null,
    log: ctx.req?.server?.log,
  };
}

export function assertCanCreateCreditSale(ctx: Context): void {
  const role = ctx.user!.role;
  if (role === 'admin' || role === 'manager') {
    return;
  }

  throwServerError({
    trpcCode: 'FORBIDDEN',
    errorCode: 'CREDIT_SALE_FORBIDDEN',
    message: 'Only managers and administrators can create credit sales',
  });
}

export function inputCarriesCreditTender(input: {
  paymentMethod: string;
  // ENG-179b — explicit `| undefined` so the Zod-parsed input shape
  // (which carries an explicit-undefined `payments` field when absent)
  // assigns cleanly under `exactOptionalPropertyTypes`.
  payments?: Array<{ method: string }> | undefined;
}): boolean {
  return (
    input.paymentMethod === 'credit' ||
    (input.payments?.some(payment => payment.method === 'credit') ?? false)
  );
}

/**
 * ENG-039c — resolve a `restaurant_tables` row for the tenant, asserting
 * it belongs to `ctx.tenantId` and is active. Cross-tenant hits collapse
 * to `RESTAURANT_TABLE_NOT_FOUND` so the lookup never leaks existence.
 * Archived rows are also rejected so a draft cannot anchor to a table
 * that the operator removed from the dropdown.
 */
export async function resolveActiveRestaurantTable(
  db: Context['db'],
  tenantId: string,
  tableId: string,
  expectedSiteId?: string | null
): Promise<{ id: string; name: string; siteId: string }> {
  const row = await db
    .select({
      id: restaurantTables.id,
      name: restaurantTables.name,
      siteId: restaurantTables.siteId,
      isActive: restaurantTables.isActive,
    })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.id, tableId),
        eq(restaurantTables.tenantId, tenantId)
      )
    )
    .get();
  if (
    !row ||
    row.isActive === false ||
    (expectedSiteId !== null &&
      expectedSiteId !== undefined &&
      row.siteId !== expectedSiteId)
  ) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: `Restaurant table ${tableId} not found for this tenant`,
      details: { tenantId, tableId, siteId: expectedSiteId ?? null },
    });
  }
  return { id: row.id, name: row.name, siteId: row.siteId };
}

export async function resolveSaleSiteId(
  db: Context['db'],
  tenantId: string,
  cashSessionId: string | null,
  fallbackSiteId: string | null
): Promise<string | null> {
  if (!cashSessionId) {
    return fallbackSiteId;
  }

  const session = await db
    .select({ siteId: cashSessions.siteId })
    .from(cashSessions)
    .where(
      and(eq(cashSessions.id, cashSessionId), eq(cashSessions.tenantId, tenantId))
    )
    .get();

  return session?.siteId ?? fallbackSiteId;
}

// ENG-054 / ENG-055 — every sale lifecycle helper that used to live
// inline (validateCustomer, getSaleSequentialContext, resolveSaleItems,
// assertCashSessionStillOpen, insertCashMovement,
// getNormalizedSaleQuantity, buildVoided/ReturnedSaleNotes,
// getPersistedCashContribution, safelyEmitFiscalForCtx) is now in
// `application/sales/` (use-cases + policies) or `services/cash-session`
// (cross-use-case primitives). The router only retains
// `getRevenueEligibleSaleConditions` because it is a pure read filter
// used by the `summary` and dashboard procedures.
export function getRevenueEligibleSaleConditions(tenantId: string) {
  return [
    eq(sales.tenantId, tenantId),
    eq(sales.status, 'completed'),
    sql`${sales.paymentStatus} != 'refunded'`,
  ] as const;
}
