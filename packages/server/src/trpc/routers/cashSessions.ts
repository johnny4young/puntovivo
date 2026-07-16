import { and, desc, eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { cashMovements, cashSessions, sites, users } from '../../db/schema.js';
import {
  closeCashSession,
  getPendingChecksForSession,
  openCashSession,
  recordCashMovement,
  type CashSessionContext,
} from '../../application/cash-sessions/index.js';
import {
  ensureRegisterAssignmentTemplatesForSite,
  getActiveCashSessionForCashier,
  normalizeRegisterName,
} from '../../services/cash-session.js';
import type { Context } from '../context.js';
import { asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { router } from '../init.js';
import { roundMoney } from '../../lib/money.js';
import { tenantProcedure } from '../middleware/tenant.js';
import { cashierManagerOrAdminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { criticalCommandProcedure } from '../middleware/criticalCommand.js';
import { computeDayCloseSummary } from '../../services/reports/day-close.js';
import { computeCashierPace } from '../../services/cashier-pace.js';
import {
  cashSessionMovementsInput,
  cashSessionReportInput,
  closeCashSessionInput,
  dayCloseSummaryInput,
  getActiveCashSessionInput,
  openCashSessionInput,
  pendingChecksInput,
  recordCashMovementInput,
} from '../schemas/cashSessions.js';

const CASH_SESSION_REVIEW_EPSILON = 0.009;
const EMPTY_PENDING_CHECKS_RESPONSE = {
  pendingFiscalDocuments: 0,
  pendingPaymentSales: 0,
  fiscalSamples: [],
  paymentSamples: [],
} as const;

const cashSessionRecordSelection = {
  id: cashSessions.id,
  tenantId: cashSessions.tenantId,
  siteId: cashSessions.siteId,
  siteName: sites.name,
  cashierId: cashSessions.cashierId,
  cashierName: users.name,
  registerName: cashSessions.registerName,
  openingFloat: cashSessions.openingFloat,
  openingCountDenominations: cashSessions.openingCountDenominations,
  expectedBalance: cashSessions.expectedBalance,
  actualCount: cashSessions.actualCount,
  actualCountDenominations: cashSessions.actualCountDenominations,
  overShort: cashSessions.overShort,
  status: cashSessions.status,
  openedAt: cashSessions.openedAt,
  closedAt: cashSessions.closedAt,
  createdAt: cashSessions.createdAt,
  updatedAt: cashSessions.updatedAt,
} as const;

function isPrivilegedCashSessionRole(role: string | undefined) {
  return role === 'admin' || role === 'manager';
}

/**
 * ENG-194 — enforce blind close at the API boundary, not only in JSX.
 * Cashiers may inspect browser data, so an open session must not serialize
 * its expected balance to them. Managers/admins keep the live value and every
 * role may see it after the session is closed and the final count is locked.
 */
function presentCashSessionRecord<T extends { expectedBalance: number; status: 'open' | 'closed' }>(
  record: T,
  role: string | undefined
): Omit<T, 'expectedBalance'> & {
  expectedBalance: number | null;
} {
  return {
    ...record,
    expectedBalance:
      record.status === 'open' && !isPrivilegedCashSessionRole(role)
        ? null
        : record.expectedBalance,
  };
}

const roundCurrencyAmount = roundMoney;

function getCashSessionDiscrepancy(value: number | null | undefined) {
  return Math.abs(value ?? 0);
}

function buildCashSessionReportSummary(
  activeSessions: Array<{ registerName: string }>,
  recentClosures: Array<{ overShort: number | null }>
) {
  const reviewSessions = recentClosures.filter(
    session => getCashSessionDiscrepancy(session.overShort) > CASH_SESSION_REVIEW_EPSILON
  );

  return {
    activeSessionCount: activeSessions.length,
    activeRegisterCount: new Set(activeSessions.map(session => session.registerName)).size,
    recentClosureCount: recentClosures.length,
    reviewCount: reviewSessions.length,
    netOverShort: roundCurrencyAmount(
      recentClosures.reduce(
        (sum, session) => roundCurrencyAmount(sum + (session.overShort ?? 0)),
        0
      )
    ),
    largestDiscrepancy: roundCurrencyAmount(
      reviewSessions.reduce(
        (max, session) => Math.max(max, getCashSessionDiscrepancy(session.overShort)),
        0
      )
    ),
  };
}

async function getCashSessionRecord(db: DatabaseInstance, tenantId: string, id: string) {
  return db
    .select(cashSessionRecordSelection)
    .from(cashSessions)
    .innerJoin(sites, eq(cashSessions.siteId, sites.id))
    .innerJoin(users, eq(cashSessions.cashierId, users.id))
    .where(and(eq(cashSessions.id, id), eq(cashSessions.tenantId, tenantId)))
    .get();
}

async function getCashSessionAccessRecord(db: DatabaseInstance, tenantId: string, id: string) {
  return db
    .select({
      id: cashSessions.id,
      tenantId: cashSessions.tenantId,
      siteId: cashSessions.siteId,
      cashierId: cashSessions.cashierId,
    })
    .from(cashSessions)
    .where(and(eq(cashSessions.id, id), eq(cashSessions.tenantId, tenantId)))
    .get();
}

/**
 * Adapt the tRPC context to the `CashSessionContext` shape the
 * use-case services consume. ENG-179c — the parameter is typed
 * `CriticalCommandContext` (the augmented shape `commandEnvelope`
 * injects), so `ctx.envelope` / `ctx.deviceId` are read directly.
 * Only critical-command procedures call this helper.
 */
function buildCashSessionContext(ctx: Context): CashSessionContext {
  const cc = asCriticalCommandContext(ctx);
  return {
    db: cc.db,
    tenantId: cc.tenantId,
    siteId: cc.siteId,
    user: { id: cc.user.id, role: cc.user.role },
    envelope: cc.envelope,
    deviceId: cc.deviceId,
    log: cc.req?.server?.log,
  };
}

export const cashSessionsRouter = router({
  registerAssignments: tenantProcedure.query(async ({ ctx }) => {
    if (!ctx.siteId) {
      return [];
    }

    const templates = await ensureRegisterAssignmentTemplatesForSite(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
    });
    const openSessions = await ctx.db
      .select({
        id: cashSessions.id,
        registerName: cashSessions.registerName,
        cashierId: cashSessions.cashierId,
        cashierName: users.name,
        openedAt: cashSessions.openedAt,
      })
      .from(cashSessions)
      .innerJoin(users, eq(cashSessions.cashierId, users.id))
      .where(
        and(
          eq(cashSessions.tenantId, ctx.tenantId),
          eq(cashSessions.siteId, ctx.siteId),
          eq(cashSessions.status, 'open')
        )
      );

    const openSessionByRegister = new Map(
      openSessions.map(session => [normalizeRegisterName(session.registerName), session])
    );

    return templates.map(template => {
      const openSession = openSessionByRegister.get(normalizeRegisterName(template.registerName));

      return {
        ...template,
        isOccupied: !!openSession,
        activeSessionId: openSession?.id ?? null,
        activeCashierId: openSession?.cashierId ?? null,
        activeCashierName: openSession?.cashierName ?? null,
        openedAt: openSession?.openedAt ?? null,
      };
    });
  }),

  getActive: tenantProcedure.input(getActiveCashSessionInput).query(async ({ ctx }) => {
    if (!ctx.siteId || !ctx.user) {
      return null;
    }

    const activeSession = await getActiveCashSessionForCashier(
      ctx.db,
      ctx.tenantId,
      ctx.siteId,
      ctx.user.id
    );

    if (!activeSession) {
      return null;
    }

    const record = await getCashSessionRecord(ctx.db, ctx.tenantId, activeSession.id);
    return record ? presentCashSessionRecord(record, ctx.user.role) : null;
  }),

  /**
   * ENG-204 — pace metrics for the opt-in cashier HUD. Always the CALLER's
   * own data: the active session resolves for (tenant, site, ctx.user) and
   * the personal best scans only that cashier's closed sessions. Null when
   * no session is open (the HUD simply hides).
   */
  pace: tenantProcedure.query(async ({ ctx }) => {
    if (!ctx.siteId || !ctx.user) {
      return null;
    }
    const activeSession = await getActiveCashSessionForCashier(
      ctx.db,
      ctx.tenantId,
      ctx.siteId,
      ctx.user.id
    );
    if (!activeSession) {
      return null;
    }
    return computeCashierPace(ctx.db, {
      tenantId: ctx.tenantId,
      cashierId: ctx.user.id,
      session: { id: activeSession.id, openedAt: activeSession.openedAt },
    });
  }),

  listRecent: managerOrAdminProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: cashSessions.id,
        tenantId: cashSessions.tenantId,
        siteId: cashSessions.siteId,
        siteName: sites.name,
        cashierId: cashSessions.cashierId,
        cashierName: users.name,
        registerName: cashSessions.registerName,
        openingFloat: cashSessions.openingFloat,
        expectedBalance: cashSessions.expectedBalance,
        status: cashSessions.status,
        openedAt: cashSessions.openedAt,
        closedAt: cashSessions.closedAt,
      })
      .from(cashSessions)
      .innerJoin(sites, eq(cashSessions.siteId, sites.id))
      .innerJoin(users, eq(cashSessions.cashierId, users.id))
      .where(eq(cashSessions.tenantId, ctx.tenantId))
      .orderBy(desc(cashSessions.openedAt))
      .limit(20);
  }),

  report: tenantProcedure.input(cashSessionReportInput).query(async ({ ctx, input }) => {
    if (!ctx.user || !ctx.siteId) {
      return {
        summary: buildCashSessionReportSummary([], []),
        activeSessions: [],
        recentClosures: [],
      };
    }

    const reportConditions = [
      eq(cashSessions.tenantId, ctx.tenantId),
      eq(cashSessions.siteId, ctx.siteId),
    ];

    if (!isPrivilegedCashSessionRole(ctx.user.role)) {
      reportConditions.push(eq(cashSessions.cashierId, ctx.user.id));
    }

    const activeSessions = await ctx.db
      .select(cashSessionRecordSelection)
      .from(cashSessions)
      .innerJoin(sites, eq(cashSessions.siteId, sites.id))
      .innerJoin(users, eq(cashSessions.cashierId, users.id))
      .where(and(...reportConditions, eq(cashSessions.status, 'open')))
      .orderBy(desc(cashSessions.openedAt));

    const recentClosures = await ctx.db
      .select(cashSessionRecordSelection)
      .from(cashSessions)
      .innerJoin(sites, eq(cashSessions.siteId, sites.id))
      .innerJoin(users, eq(cashSessions.cashierId, users.id))
      .where(and(...reportConditions, eq(cashSessions.status, 'closed')))
      .orderBy(desc(cashSessions.closedAt), desc(cashSessions.updatedAt))
      .limit(input?.limit ?? 6);

    return {
      summary: buildCashSessionReportSummary(activeSessions, recentClosures),
      activeSessions: activeSessions.map(session =>
        presentCashSessionRecord(session, ctx.user?.role)
      ),
      recentClosures: recentClosures.map(session =>
        presentCashSessionRecord(session, ctx.user?.role)
      ),
    };
  }),

  open: criticalCommandProcedure.input(openCashSessionInput).mutation(async ({ ctx, input }) => {
    const result = await openCashSession(buildCashSessionContext(ctx), input);
    // Preserve legacy router contract: return the joined record shape
    // the UI already consumes via cashSessionRecordSelection.
    const created = await getCashSessionRecord(ctx.db, ctx.tenantId, result.session.id);
    if (!created) {
      throw new Error('Failed to load the created cash session');
    }
    return presentCashSessionRecord(created, ctx.user?.role);
  }),

  close: criticalCommandProcedure.input(closeCashSessionInput).mutation(async ({ ctx, input }) => {
    const result = await closeCashSession(buildCashSessionContext(ctx), input);
    const closedSession = await getCashSessionRecord(ctx.db, ctx.tenantId, result.session.id);
    if (!closedSession) {
      throw new Error('Failed to load the closed cash session');
    }
    return presentCashSessionRecord(closedSession, ctx.user?.role);
  }),

  /**
   * ENG-198 — day-close ritual. Open to the cashier (they are the one who
   * closes), but owner data is gated SERVER-SIDE: margin and per-product
   * profit only serialize for manager/admin, mirroring the ENG-194 blind
   * close philosophy. Pure read; multi-tenant scoping happens inside the
   * service (NOT_FOUND for foreign sessions).
   */
  dayCloseSummary: cashierManagerOrAdminProcedure
    .input(dayCloseSummaryInput)
    .query(async ({ ctx, input }) => {
      // The role middleware rejects a missing user before this resolver; the
      // non-null assertion documents that runtime refinement for TypeScript.
      const user = ctx.user!;
      // Both capabilities map to manager/admin TODAY, but they are separate
      // service inputs on purpose: profit visibility and cross-cashier
      // access must be able to diverge without touching the guard.
      const privileged = user.role === 'admin' || user.role === 'manager';
      return computeDayCloseSummary(ctx.db, {
        tenantId: ctx.tenantId,
        sessionId: input.sessionId,
        viewerUserId: user.id,
        includeProfit: privileged,
        canViewAnyCashierSession: privileged,
      });
    }),

  movements: tenantProcedure.input(cashSessionMovementsInput).query(async ({ ctx, input }) => {
    if (!ctx.user || !ctx.siteId) {
      return [];
    }

    let sessionId = input.sessionId;

    if (sessionId) {
      const targetSession = await getCashSessionAccessRecord(ctx.db, ctx.tenantId, sessionId);
      const isPrivilegedUser = ctx.user.role === 'admin' || ctx.user.role === 'manager';

      if (
        !targetSession ||
        targetSession.siteId !== ctx.siteId ||
        (!isPrivilegedUser && targetSession.cashierId !== ctx.user.id)
      ) {
        return [];
      }
    } else {
      const activeSession = await getActiveCashSessionForCashier(
        ctx.db,
        ctx.tenantId,
        ctx.siteId,
        ctx.user.id
      );

      sessionId = activeSession?.id;
    }

    if (!sessionId) {
      return [];
    }

    return ctx.db
      .select({
        id: cashMovements.id,
        tenantId: cashMovements.tenantId,
        sessionId: cashMovements.sessionId,
        type: cashMovements.type,
        amount: cashMovements.amount,
        referenceId: cashMovements.referenceId,
        note: cashMovements.note,
        createdBy: cashMovements.createdBy,
        createdByName: users.name,
        createdAt: cashMovements.createdAt,
      })
      .from(cashMovements)
      .innerJoin(cashSessions, eq(cashMovements.sessionId, cashSessions.id))
      .innerJoin(users, eq(cashMovements.createdBy, users.id))
      .where(
        and(
          eq(cashMovements.tenantId, ctx.tenantId),
          eq(cashMovements.sessionId, sessionId),
          eq(cashSessions.tenantId, ctx.tenantId)
        )
      )
      .orderBy(desc(cashMovements.createdAt))
      .limit(input.limit);
  }),

  pendingChecks: tenantProcedure.input(pendingChecksInput).query(async ({ ctx, input }) => {
    if (!ctx.user || !ctx.siteId) {
      return EMPTY_PENDING_CHECKS_RESPONSE;
    }

    let sessionId = input?.sessionId;

    if (sessionId) {
      const targetSession = await getCashSessionAccessRecord(ctx.db, ctx.tenantId, sessionId);
      const isPrivilegedUser = isPrivilegedCashSessionRole(ctx.user.role);
      if (
        !targetSession ||
        targetSession.siteId !== ctx.siteId ||
        (!isPrivilegedUser && targetSession.cashierId !== ctx.user.id)
      ) {
        return EMPTY_PENDING_CHECKS_RESPONSE;
      }
    } else {
      const activeSession = await getActiveCashSessionForCashier(
        ctx.db,
        ctx.tenantId,
        ctx.siteId,
        ctx.user.id
      );
      sessionId = activeSession?.id;
    }

    if (!sessionId) {
      return EMPTY_PENDING_CHECKS_RESPONSE;
    }

    return getPendingChecksForSession(ctx.db, ctx.tenantId, sessionId);
  }),

  recordMovement: criticalCommandProcedure
    .input(recordCashMovementInput)
    .mutation(async ({ ctx, input }) => {
      const result = await recordCashMovement(buildCashSessionContext(ctx), input);
      return result.movement;
    }),
});
