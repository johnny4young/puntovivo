import { and, desc, eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import { cashSessions, sites, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import {
  getCashSessionOverShort,
  assertOpeningFloatMatchesDenominations,
  getClosingCountTotal,
  getActiveCashSessionForCashier,
  getOpenCashSessionForRegister,
  normalizeRegisterName,
} from '../../services/cash-session.js';
import { router } from '../init.js';
import { tenantProcedure } from '../middleware/tenant.js';
import {
  closeCashSessionInput,
  getActiveCashSessionInput,
  openCashSessionInput,
} from '../schemas/cashSessions.js';

async function getCashSessionRecord(
  db: DatabaseInstance,
  tenantId: string,
  id: string
) {
  return db
    .select({
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
    })
    .from(cashSessions)
    .innerJoin(sites, eq(cashSessions.siteId, sites.id))
    .innerJoin(users, eq(cashSessions.cashierId, users.id))
    .where(and(eq(cashSessions.id, id), eq(cashSessions.tenantId, tenantId)))
    .get();
}

export const cashSessionsRouter = router({
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
});
