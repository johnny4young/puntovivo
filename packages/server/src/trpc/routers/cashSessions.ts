import { and, desc, eq, sql } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { cashMovements, cashSessions, sites, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  getCashSessionOverShort,
  assertOpeningFloatMatchesDenominations,
  getClosingCountTotal,
  getActiveCashSessionForCashier,
  getCashMovementSignedAmount,
  getOpenCashSessionForRegister,
  ensureRegisterAssignmentTemplate,
  ensureRegisterAssignmentTemplatesForSite,
  normalizeRegisterName,
} from '../../services/cash-session.js';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import {
  cashSessionMovementsInput,
  cashSessionReportInput,
  closeCashSessionInput,
  getActiveCashSessionInput,
  openCashSessionInput,
  recordCashMovementInput,
} from '../schemas/cashSessions.js';

const CASH_SESSION_REVIEW_EPSILON = 0.009;

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

function roundCurrencyAmount(value: number) {
  return Math.round(value * 100) / 100;
}

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
      recentClosures.reduce((sum, session) => sum + (session.overShort ?? 0), 0)
    ),
    largestDiscrepancy: roundCurrencyAmount(
      reviewSessions.reduce(
        (max, session) => Math.max(max, getCashSessionDiscrepancy(session.overShort)),
        0
      )
    ),
  };
}

async function getCashSessionRecord(
  db: DatabaseInstance,
  tenantId: string,
  id: string
) {
  return db
    .select(cashSessionRecordSelection)
    .from(cashSessions)
    .innerJoin(sites, eq(cashSessions.siteId, sites.id))
    .innerJoin(users, eq(cashSessions.cashierId, users.id))
    .where(and(eq(cashSessions.id, id), eq(cashSessions.tenantId, tenantId)))
    .get();
}

async function getCashSessionAccessRecord(
  db: DatabaseInstance,
  tenantId: string,
  id: string
) {
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

async function getCashMovementRecord(
  db: DatabaseInstance,
  tenantId: string,
  id: string
) {
  return db
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
    .innerJoin(users, eq(cashMovements.createdBy, users.id))
    .where(and(eq(cashMovements.id, id), eq(cashMovements.tenantId, tenantId)))
    .get();
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

    return getCashSessionRecord(ctx.db, ctx.tenantId, activeSession.id);
  }),

  listRecent: tenantProcedure.query(async ({ ctx }) => {
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
      activeSessions,
      recentClosures,
    };
  }),

  open: tenantProcedure.input(openCashSessionInput).mutation(async ({ ctx, input }) => {
    if (!ctx.siteId || !ctx.user) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'CASH_SESSION_SITE_REQUIRED',
        message: 'An active site is required before opening a cash session',
      });
    }

    const registerName = normalizeRegisterName(input.registerName);
    assertOpeningFloatMatchesDenominations(input.openingFloat, input.denominations);

    const existingCashierSession = await getActiveCashSessionForCashier(
      ctx.db,
      ctx.tenantId,
      ctx.siteId,
      ctx.user.id
    );

    if (existingCashierSession) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'CASH_SESSION_ALREADY_OPEN_FOR_CASHIER',
        message: 'This cashier already has an open cash session for the active site',
        details: {
          registerName: existingCashierSession.registerName,
          openedAt: existingCashierSession.openedAt,
        },
      });
    }

    const existingRegisterSession = await getOpenCashSessionForRegister(
      ctx.db,
      ctx.tenantId,
      ctx.siteId,
      registerName
    );

    if (existingRegisterSession) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'CASH_SESSION_ALREADY_OPEN_FOR_REGISTER',
        message: 'The selected register already has an open cash session',
        details: {
          registerName,
          cashierId: existingRegisterSession.cashierId,
          openedAt: existingRegisterSession.openedAt,
        },
      });
    }

    const now = new Date().toISOString();
    const id = nanoid();

    await ctx.db.insert(cashSessions).values({
      id,
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      cashierId: ctx.user.id,
      registerName,
      openingFloat: input.openingFloat,
      openingCountDenominations: input.denominations,
      expectedBalance: input.openingFloat,
      actualCount: null,
      actualCountDenominations: null,
      overShort: null,
      status: 'open',
      openedAt: now,
      closedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    await ensureRegisterAssignmentTemplate(ctx.db, {
      tenantId: ctx.tenantId,
      siteId: ctx.siteId,
      registerName,
      openingFloat: input.openingFloat,
      denominations: input.denominations,
    });

    const created = await getCashSessionRecord(ctx.db, ctx.tenantId, id);

    if (!created) {
      throw new Error('Failed to load the created cash session');
    }

    return created;
  }),

  close: tenantProcedure.input(closeCashSessionInput).mutation(async ({ ctx, input }) => {
    if (!ctx.user) {
      throwServerError({
        trpcCode: 'UNAUTHORIZED',
        errorCode: 'CASH_SESSION_REQUIRED',
        message: 'An authenticated user is required to close a cash session',
      });
    }

    if (!ctx.siteId) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'CASH_SESSION_SITE_REQUIRED',
        message: 'An active site is required before closing a cash session',
      });
    }

    const activeSession = await getActiveCashSessionForCashier(
      ctx.db,
      ctx.tenantId,
      ctx.siteId,
      ctx.user.id
    );

    if (!activeSession) {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'CASH_SESSION_REQUIRED',
        message: 'An open cash session is required before closing the register',
      });
    }

    const actualCount = getClosingCountTotal(input.actualCount, input.denominations);
    const overShort = getCashSessionOverShort(activeSession.expectedBalance, actualCount);
    const closedAt = new Date().toISOString();

    await ctx.db
      .update(cashSessions)
      .set({
        actualCount,
        actualCountDenominations: input.denominations,
        overShort,
        status: 'closed',
        closedAt,
        updatedAt: closedAt,
      })
      .where(eq(cashSessions.id, activeSession.id));

    const closedSession = await getCashSessionRecord(ctx.db, ctx.tenantId, activeSession.id);

    if (!closedSession) {
      throw new Error('Failed to load the closed cash session');
    }

    return closedSession;
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

  recordMovement: tenantProcedure
    .input(recordCashMovementInput)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.user) {
        throwServerError({
          trpcCode: 'UNAUTHORIZED',
          errorCode: 'CASH_SESSION_REQUIRED',
          message: 'An authenticated user is required to record a cash movement',
        });
      }

      if (!ctx.siteId) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'CASH_SESSION_SITE_REQUIRED',
          message: 'An active site is required before recording a cash movement',
        });
      }

      const activeSession = await getActiveCashSessionForCashier(
        ctx.db,
        ctx.tenantId,
        ctx.siteId,
        ctx.user.id
      );

      if (!activeSession) {
        throwServerError({
          trpcCode: 'BAD_REQUEST',
          errorCode: 'CASH_SESSION_REQUIRED',
          message: 'An open cash session is required before recording a cash movement',
        });
      }

      const now = new Date().toISOString();
      const movementId = nanoid();
      const signedAmount = getCashMovementSignedAmount(input.type, input.amount);

      ctx.db.transaction(tx => {
        tx.insert(cashMovements).values({
          id: movementId,
          tenantId: ctx.tenantId,
          sessionId: activeSession.id,
          type: input.type,
          amount: input.amount,
          referenceId: null,
          note: input.note,
          createdBy: ctx.user!.id,
          createdAt: now,
        }).run();

        tx
          .update(cashSessions)
          .set({
            expectedBalance: sql`${cashSessions.expectedBalance} + ${signedAmount}`,
            updatedAt: now,
          })
          .where(eq(cashSessions.id, activeSession.id))
          .run();
      });

      const movement = await getCashMovementRecord(ctx.db, ctx.tenantId, movementId);

      if (!movement) {
        throw new Error('Failed to load the created cash movement');
      }

      return movement;
    }),
});
