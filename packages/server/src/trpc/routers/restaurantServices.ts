/** Normalized restaurant service/check procedures. */
import { and, asc, count, eq, inArray } from 'drizzle-orm';
import { roundMoney } from '../../lib/money.js';
import {
  cashSessions,
  restaurantCheckLines,
  restaurantChecks,
  restaurantCourses,
  restaurantDiners,
  restaurantLineModifiers,
  restaurantRounds,
  restaurantServices,
  restaurantReservations,
  restaurantTables,
  products,
  saleItems,
  sales,
} from '../../db/schema.js';
import { completeSale } from '../../application/sales/completeSale.js';
import {
  RESTAURANT_SERVICE_LIMITS,
  assertNoUnnormalizedRestaurantDrafts,
  findOpenService,
  writePendingRound,
  restaurantModifierAmount,
} from '../../application/restaurant/service-lifecycle.js';
import { router } from '../init.js';
import { createModuleGuard } from '../middleware/modules.js';
import { cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import {
  criticalCommandCashierManagerOrAdminProcedureWithModule,
  criticalCommandManagerOrAdminProcedureWithModule,
} from '../middleware/criticalCommand.js';
import { buildLifecycleContext } from './sales/helpers.js';
import { addRestaurantRound } from '../../application/restaurant/add-round.js';
import { regroupRestaurantChecksInTransaction } from '../../application/restaurant/regroup-checks.js';
import {
  splitRestaurantCheckEqualInTransaction,
  splitRestaurantSharedLineInTransaction,
} from '../../application/restaurant/split-equal.js';
import {
  buildRestaurantPrecheck,
  printRestaurantPrecheck,
} from '../../services/restaurant/precheck.js';
import { tickDefaultHardwareWorker } from '../../services/peripherals/hardware-worker.js';
import {
  addRestaurantRoundInput,
  getRestaurantPrecheckInput,
  getRestaurantTableStateInput,
  openRestaurantCheckInput,
  printRestaurantPrecheckInput,
  regroupRestaurantChecksInput,
  setRestaurantBillRequestedInput,
  setRestaurantPendingRoundInput,
  splitRestaurantCheckEqualInput,
  splitRestaurantSharedLineInput,
} from '../schemas/restaurantServices.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import type { Context } from '../context.js';

const restaurantStaffProcedure = cashierManagerOrAdminProcedure.use(createModuleGuard('dine-in'));
// The entitlement guard is layered in BEFORE the envelope, not chained onto a
// finished critical-command procedure: the envelope short-circuits on a cache
// hit, so a downstream guard never runs on a replay and a module disabled
// after the original request would still serve its cached result.
const restaurantCommandProcedure =
  criticalCommandCashierManagerOrAdminProcedureWithModule('dine-in');
const restaurantManagerCommandProcedure =
  criticalCommandManagerOrAdminProcedureWithModule('dine-in');

type RestaurantDb = Context['db'];

/** Active table in the caller's tenant (and site, when bound) plus its open service. */
function findTableWithOpenService(
  tx: RestaurantDb,
  tenantId: string,
  siteId: string | null | undefined,
  tableId: string
) {
  const table = tx
    .select({ id: restaurantTables.id, siteId: restaurantTables.siteId })
    .from(restaurantTables)
    .where(
      and(
        eq(restaurantTables.id, tableId),
        eq(restaurantTables.tenantId, tenantId),
        eq(restaurantTables.isActive, true),
        ...(siteId ? [eq(restaurantTables.siteId, siteId)] : [])
      )
    )
    .get();
  if (!table) {
    throwServerError({
      trpcCode: 'NOT_FOUND',
      errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
      message: 'Restaurant table was not found for this tenant',
    });
  }
  const service = findOpenService(tx, tenantId, table.id);
  if (service && service.siteId !== table.siteId) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
      message: 'Restaurant service site does not match its physical table',
    });
  }
  return { table, service };
}

export const restaurantServicesRouter = router({
  /**
   * Create the draft sale and its complete service/check structure in one
   * immediate SQLite transaction. Command-envelope replay hydrates the same
   * sale response used by `sales.create`.
   */
  openCheck: restaurantCommandProcedure
    .input(openRestaurantCheckInput)
    .mutation(async ({ ctx, input }) => {
      const items = input.items.map(item => {
        const modifierAmount = restaurantModifierAmount(item.modifiers);
        return {
          productId: item.productId,
          unitId: item.unitId,
          quantity: item.quantity,
          unitPrice: roundMoney(item.unitPrice + modifierAmount),
          discount: item.discount,
          taxRate: item.taxRate,
          taxComponents: item.taxComponents,
          notes: item.notes,
          serialIds: item.serialIds,
          sourceQuotationItemId: item.sourceQuotationItemId,
          restaurantModifierAmount: modifierAmount,
        };
      });
      const result = await completeSale(buildLifecycleContext(ctx), {
        mode: 'fresh',
        customerId: undefined,
        priceTier: input.priceTier,
        items,
        paymentMethod: 'cash',
        paymentStatus: 'pending',
        status: 'draft',
        discountAmount: 0,
        tableId: input.tableId,
        restaurant: {
          reservation: input.reservation,
          tableId: input.tableId,
          guestCount: input.guestCount,
          checkLabel: input.checkLabel,
          roundLabel: input.roundLabel,
          diners: input.diners,
          lines: input.items.map((item, itemIndex) => ({
            itemIndex,
            dinerClientId: item.dinerClientId,
            courseKey: item.courseKey,
            modifierGroups: item.modifierGroups,
            modifiers: item.modifiers,
          })),
        },
      });
      void tickDefaultHardwareWorker(ctx.tenantId).catch(() => {});
      return {
        ...result.sale,
        change: result.change,
        loyaltyPointsEarned: result.loyaltyPointsEarned ?? 0,
      };
    }),

  /**
   * Append a new round directly onto an existing open check without creating
   * fragmented checks. Reserves stock/BOM, updates draft totals, and submits
   * only the new round to KDS and thermal station printers.
   */
  addRound: restaurantCommandProcedure
    .input(addRestaurantRoundInput)
    .mutation(async ({ ctx, input }) => {
      const result = await addRestaurantRound(buildLifecycleContext(ctx), input, {
        callerSiteId: ctx.siteId,
      });
      void tickDefaultHardwareWorker(ctx.tenantId).catch(() => {});
      return result;
    }),

  /** Non-fiscal precheck preview with editable suggested voluntary tip (Ley 1935/2018). */
  getPrecheck: restaurantStaffProcedure.input(getRestaurantPrecheckInput).query(({ ctx, input }) =>
    buildRestaurantPrecheck(ctx.db, {
      tenantId: ctx.tenantId,
      callerSiteId: ctx.siteId,
      actorId: ctx.user!.id,
      tableId: input.tableId,
      checkId: input.checkId,
      tipPercent: input.tipPercent,
    })
  ),

  /** Print non-fiscal precheck without consuming a fiscal sequential or closing the sale. */
  printPrecheck: restaurantStaffProcedure
    .input(printRestaurantPrecheckInput)
    .mutation(({ ctx, input }) => {
      const result = printRestaurantPrecheck(ctx.db, {
        tenantId: ctx.tenantId,
        callerSiteId: ctx.siteId,
        actorId: ctx.user!.id,
        tableId: input.tableId,
        checkId: input.checkId,
        tipPercent: input.tipPercent,
        markBillRequested: input.markBillRequested,
      });
      if (result.printedVia === 'hardware_outbox') {
        void tickDefaultHardwareWorker(ctx.tenantId).catch(() => {});
      }
      return result;
    }),

  /** Split one open check into N equal payable checks (`Total / N`), available to waiters/cashiers. */
  splitEqual: restaurantCommandProcedure
    .input(splitRestaurantCheckEqualInput)
    .mutation(({ ctx, input }) => {
      const lifecycle = buildLifecycleContext(ctx);
      return ctx.db.transaction(
        tx => {
          const result = splitRestaurantCheckEqualInTransaction(
            tx,
            {
              tenantId: ctx.tenantId,
              callerSiteId: ctx.siteId,
              actorId: ctx.user!.id,
              now: new Date().toISOString(),
              envelope: lifecycle.envelope,
              deviceId: lifecycle.deviceId,
            },
            input
          );
          lifecycle.completeInTransaction?.(tx as unknown as RestaurantDb, result);
          return result;
        },
        { behavior: 'immediate' }
      );
    }),

  /** Split one shared dish across 2..10 checks, available to waiters/cashiers. */
  splitSharedLine: restaurantCommandProcedure
    .input(splitRestaurantSharedLineInput)
    .mutation(({ ctx, input }) => {
      const lifecycle = buildLifecycleContext(ctx);
      return ctx.db.transaction(
        tx => {
          const result = splitRestaurantSharedLineInTransaction(
            tx,
            {
              tenantId: ctx.tenantId,
              callerSiteId: ctx.siteId,
              actorId: ctx.user!.id,
              now: new Date().toISOString(),
              envelope: lifecycle.envelope,
              deviceId: lifecycle.deviceId,
            },
            input
          );
          lifecycle.completeInTransaction?.(tx as unknown as RestaurantDb, result);
          return result;
        },
        { behavior: 'immediate' }
      );
    }),

  /**
   * Move lines between the open checks of one table: an explicit layout, or
   * one check per diner. New accounts open a suspended draft and a check left
   * without lines is cancelled, all in one immediate transaction. The caller
   * sends the check versions it saw, so a layout built on an older table fails
   * as stale. A plan that already matches the table writes nothing.
   */
  regroupChecks: restaurantManagerCommandProcedure
    .input(regroupRestaurantChecksInput)
    .mutation(({ ctx, input }) => {
      const lifecycle = buildLifecycleContext(ctx);
      return ctx.db.transaction(
        tx => {
          const result = regroupRestaurantChecksInTransaction(
            tx,
            {
              tenantId: ctx.tenantId,
              callerSiteId: ctx.siteId,
              actorId: ctx.user!.id,
              now: new Date().toISOString(),
              envelope: lifecycle.envelope,
              deviceId: lifecycle.deviceId,
            },
            input
          );
          lifecycle.completeInTransaction?.(tx as unknown as RestaurantDb, result);
          return result;
        },
        { behavior: 'immediate' }
      );
    }),

  /**
   * Staff mark that the table asked for the bill. Idempotent; the marker
   * belongs to the visit, so it ends when the service closes.
   */
  setBillRequested: restaurantStaffProcedure
    .input(setRestaurantBillRequestedInput)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(
        tx => {
          const db = tx as unknown as RestaurantDb;
          const { table, service } = findTableWithOpenService(
            db,
            ctx.tenantId,
            ctx.siteId,
            input.tableId
          );
          if (!service) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'RESTAURANT_SERVICE_NOT_OPEN',
              message: 'The table has no open service to mark',
            });
          }
          if ((service.billRequestedAt !== null) === input.requested) {
            return { serviceId: service.id, billRequestedAt: service.billRequestedAt };
          }
          const now = new Date().toISOString();
          const actorId = ctx.user!.id;
          const next = {
            billRequestedAt: input.requested ? now : null,
            billRequestedBy: input.requested ? actorId : null,
          };
          const changed = tx
            .update(restaurantServices)
            .set({ ...next, version: service.version + 1, updatedAt: now })
            .where(
              and(
                eq(restaurantServices.id, service.id),
                eq(restaurantServices.tenantId, ctx.tenantId),
                eq(restaurantServices.status, 'open'),
                eq(restaurantServices.version, service.version)
              )
            )
            .run();
          if (changed.changes !== 1) {
            throwServerError({
              trpcCode: 'CONFLICT',
              errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
              message: 'Restaurant service changed while its bill request was being saved',
            });
          }
          writeAuditLog({
            tx: db,
            tenantId: ctx.tenantId,
            actorId,
            action: input.requested
              ? 'restaurant_service.bill_requested'
              : 'restaurant_service.bill_request_cleared',
            resourceType: 'restaurant_service',
            resourceId: service.id,
            before: {
              billRequestedAt: service.billRequestedAt,
              billRequestedBy: service.billRequestedBy,
            },
            after: next,
            metadata: { siteId: table.siteId, tableId: table.id },
          });
          return { serviceId: service.id, billRequestedAt: next.billRequestedAt };
        },
        { behavior: 'immediate' }
      )
    ),

  /**
   * An ordering device reports how many plates it holds unsent, and repeats
   * the report while it holds any. Each waiter has their own entry, so one
   * waiter never hides another's round; entries from a device that stopped
   * reporting expire. A table without an open service has nothing to mark.
   */
  setPendingRound: restaurantStaffProcedure
    .input(setRestaurantPendingRoundInput)
    .mutation(({ ctx, input }) =>
      ctx.db.transaction(
        tx => {
          const db = tx as unknown as RestaurantDb;
          const { service } = findTableWithOpenService(db, ctx.tenantId, ctx.siteId, input.tableId);
          if (!service) return { pending: false };
          return {
            pending: writePendingRound(db, service, ctx.user!.id, input.itemCount, new Date()),
          };
        },
        { behavior: 'immediate' }
      )
    ),

  /** Tenant-scoped complete open state for one table, including every check. */
  getTableState: restaurantStaffProcedure
    .input(getRestaurantTableStateInput)
    .query(({ ctx, input }) =>
      ctx.db.transaction(tx => {
        const table = tx
          .select({
            id: restaurantTables.id,
            siteId: restaurantTables.siteId,
            name: restaurantTables.name,
            seatCount: restaurantTables.seatCount,
            isActive: restaurantTables.isActive,
          })
          .from(restaurantTables)
          .where(
            and(
              eq(restaurantTables.id, input.tableId),
              eq(restaurantTables.tenantId, ctx.tenantId),
              eq(restaurantTables.isActive, true),
              ...(ctx.siteId ? [eq(restaurantTables.siteId, ctx.siteId)] : [])
            )
          )
          .get();
        if (!table) {
          throwServerError({
            trpcCode: 'NOT_FOUND',
            errorCode: 'RESTAURANT_TABLE_NOT_FOUND',
            message: 'Restaurant table was not found for this tenant',
          });
        }
        assertNoUnnormalizedRestaurantDrafts(tx as typeof ctx.db, ctx.tenantId, table.id);
        const service = tx
          .select()
          .from(restaurantServices)
          .where(
            and(
              eq(restaurantServices.tenantId, ctx.tenantId),
              eq(restaurantServices.tableId, input.tableId),
              eq(restaurantServices.status, 'open')
            )
          )
          .get();
        const reservation =
          tx
            .select({
              id: restaurantReservations.id,
              version: restaurantReservations.version,
              guestName: restaurantReservations.guestName,
              partySize: restaurantReservations.partySize,
            })
            .from(restaurantReservations)
            .where(
              and(
                eq(restaurantReservations.tenantId, ctx.tenantId),
                eq(restaurantReservations.siteId, table.siteId),
                eq(restaurantReservations.tableId, table.id),
                eq(restaurantReservations.status, 'arrived')
              )
            )
            .limit(1)
            .get() ?? null;
        if (!service) return { table, service: null, reservation, diners: [], checks: [] };
        if (service.siteId !== table.siteId) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
            message: 'Restaurant service site does not match its physical table',
          });
        }
        const openCheckCount =
          tx
            .select({ value: count() })
            .from(restaurantChecks)
            .where(
              and(
                eq(restaurantChecks.tenantId, ctx.tenantId),
                eq(restaurantChecks.serviceId, service.id),
                eq(restaurantChecks.status, 'open')
              )
            )
            .get()?.value ?? 0;
        if (openCheckCount > RESTAURANT_SERVICE_LIMITS.openChecks) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
            message: 'Restaurant service exceeds the safe open-check projection limit',
            details: {
              openCheckCount,
              maximumOpenChecks: RESTAURANT_SERVICE_LIMITS.openChecks,
            },
          });
        }

        const checks = tx
          .select({
            id: restaurantChecks.id,
            saleId: restaurantChecks.saleId,
            label: restaurantChecks.label,
            status: restaurantChecks.status,
            version: restaurantChecks.version,
            openedAt: restaurantChecks.openedAt,
            saleNumber: sales.saleNumber,
            saleStatus: sales.status,
            saleTableId: sales.tableId,
            saleCashSessionId: sales.cashSessionId,
            cashSessionSiteId: cashSessions.siteId,
            total: sales.total,
            suspendedAt: sales.suspendedAt,
          })
          .from(restaurantChecks)
          .innerJoin(
            sales,
            and(eq(sales.id, restaurantChecks.saleId), eq(sales.tenantId, ctx.tenantId))
          )
          .leftJoin(
            cashSessions,
            and(eq(cashSessions.id, sales.cashSessionId), eq(cashSessions.tenantId, ctx.tenantId))
          )
          .where(
            and(
              eq(restaurantChecks.tenantId, ctx.tenantId),
              eq(restaurantChecks.serviceId, service.id),
              eq(restaurantChecks.status, 'open')
            )
          )
          .orderBy(asc(restaurantChecks.openedAt), asc(restaurantChecks.id))
          .all();
        const activeDinerCount =
          tx
            .select({ value: count() })
            .from(restaurantDiners)
            .where(
              and(
                eq(restaurantDiners.tenantId, ctx.tenantId),
                eq(restaurantDiners.serviceId, service.id),
                eq(restaurantDiners.isActive, true)
              )
            )
            .get()?.value ?? 0;
        if (activeDinerCount > RESTAURANT_SERVICE_LIMITS.activeDiners) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
            message: 'Restaurant service exceeds the safe active-diner projection limit',
            details: {
              activeDinerCount,
              maximumActiveDiners: RESTAURANT_SERVICE_LIMITS.activeDiners,
            },
          });
        }
        const diners = tx
          .select()
          .from(restaurantDiners)
          .where(
            and(
              eq(restaurantDiners.tenantId, ctx.tenantId),
              eq(restaurantDiners.serviceId, service.id),
              eq(restaurantDiners.isActive, true)
            )
          )
          .orderBy(asc(restaurantDiners.seatNumber), asc(restaurantDiners.id))
          .all();
        if (
          checks.length !== openCheckCount ||
          checks.length === 0 ||
          diners.length !== activeDinerCount ||
          checks.some(
            check =>
              check.saleStatus !== 'draft' ||
              check.saleTableId !== table.id ||
              (check.saleCashSessionId !== null && check.cashSessionSiteId !== table.siteId)
          ) ||
          (service.guestCount !== null &&
            (diners.length > service.guestCount ||
              diners.some(
                diner => diner.seatNumber !== null && diner.seatNumber > service.guestCount!
              )))
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
            message: 'Restaurant service lifecycle does not match its sale and diner projection',
          });
        }

        const checkIds = checks.map(check => check.id);
        const checkSaleIds = checks.map(check => check.saleId);
        const expectedSaleItemCount =
          tx
            .select({ value: count() })
            .from(saleItems)
            .innerJoin(sales, and(eq(sales.id, saleItems.saleId), eq(sales.tenantId, ctx.tenantId)))
            .where(inArray(saleItems.saleId, checkSaleIds))
            .get()?.value ?? 0;
        const expectedLineCount =
          tx
            .select({ value: count() })
            .from(restaurantCheckLines)
            .where(
              and(
                eq(restaurantCheckLines.tenantId, ctx.tenantId),
                inArray(restaurantCheckLines.checkId, checkIds)
              )
            )
            .get()?.value ?? 0;
        const expectedRoundCount =
          tx
            .select({ value: count() })
            .from(restaurantRounds)
            .where(
              and(
                eq(restaurantRounds.tenantId, ctx.tenantId),
                inArray(restaurantRounds.checkId, checkIds)
              )
            )
            .get()?.value ?? 0;
        const expectedModifierCount =
          tx
            .select({ value: count() })
            .from(restaurantLineModifiers)
            .innerJoin(
              restaurantCheckLines,
              and(
                eq(restaurantCheckLines.id, restaurantLineModifiers.checkLineId),
                eq(restaurantCheckLines.tenantId, ctx.tenantId)
              )
            )
            .where(
              and(
                eq(restaurantLineModifiers.tenantId, ctx.tenantId),
                inArray(restaurantCheckLines.checkId, checkIds)
              )
            )
            .get()?.value ?? 0;
        if (
          expectedLineCount > RESTAURANT_SERVICE_LIMITS.openLines ||
          expectedRoundCount > RESTAURANT_SERVICE_LIMITS.openRounds ||
          expectedModifierCount > RESTAURANT_SERVICE_LIMITS.openModifiers
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_LIMIT_REACHED',
            message: 'Restaurant service exceeds its safe table-state projection limit',
            details: {
              openLineCount: expectedLineCount,
              maximumOpenLines: RESTAURANT_SERVICE_LIMITS.openLines,
              openRoundCount: expectedRoundCount,
              maximumOpenRounds: RESTAURANT_SERVICE_LIMITS.openRounds,
              openModifierCount: expectedModifierCount,
              maximumOpenModifiers: RESTAURANT_SERVICE_LIMITS.openModifiers,
            },
          });
        }
        const courses = tx
          .select()
          .from(restaurantCourses)
          .where(
            and(
              eq(restaurantCourses.tenantId, ctx.tenantId),
              inArray(restaurantCourses.checkId, checkIds)
            )
          )
          .orderBy(asc(restaurantCourses.position), asc(restaurantCourses.id))
          .all();
        const rounds = tx
          .select()
          .from(restaurantRounds)
          .where(
            and(
              eq(restaurantRounds.tenantId, ctx.tenantId),
              inArray(restaurantRounds.checkId, checkIds)
            )
          )
          .orderBy(asc(restaurantRounds.sequence), asc(restaurantRounds.id))
          .all();
        const lines = tx
          .select({
            id: restaurantCheckLines.id,
            checkId: restaurantCheckLines.checkId,
            saleItemId: restaurantCheckLines.saleItemId,
            roundId: restaurantCheckLines.roundId,
            courseId: restaurantCheckLines.courseId,
            dinerId: restaurantCheckLines.dinerId,
            productId: saleItems.productId,
            currentProductId: products.id,
            productNameSnapshot: saleItems.productNameSnapshot,
            currentProductName: products.name,
            quantity: saleItems.quantity,
            total: saleItems.total,
            notes: saleItems.notes,
            restaurantModifierAmount: saleItems.restaurantModifierAmount,
          })
          .from(restaurantCheckLines)
          .innerJoin(
            restaurantChecks,
            and(
              eq(restaurantChecks.id, restaurantCheckLines.checkId),
              eq(restaurantChecks.tenantId, ctx.tenantId)
            )
          )
          .innerJoin(
            saleItems,
            and(
              eq(saleItems.id, restaurantCheckLines.saleItemId),
              eq(saleItems.saleId, restaurantChecks.saleId)
            )
          )
          .innerJoin(sales, and(eq(sales.id, saleItems.saleId), eq(sales.tenantId, ctx.tenantId)))
          .leftJoin(
            products,
            and(eq(products.id, saleItems.productId), eq(products.tenantId, ctx.tenantId))
          )
          .where(
            and(
              eq(restaurantCheckLines.tenantId, ctx.tenantId),
              inArray(restaurantCheckLines.checkId, checkIds)
            )
          )
          .orderBy(asc(restaurantCheckLines.createdAt), asc(restaurantCheckLines.id))
          .all();
        if (expectedLineCount !== expectedSaleItemCount || expectedLineCount !== lines.length) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
            message: 'Restaurant line metadata does not cover its tenant-scoped check sale',
          });
        }
        const lineIds = lines.map(line => line.id);
        const modifiers =
          lineIds.length === 0
            ? []
            : tx
                .select()
                .from(restaurantLineModifiers)
                .where(
                  and(
                    eq(restaurantLineModifiers.tenantId, ctx.tenantId),
                    inArray(restaurantLineModifiers.checkLineId, lineIds)
                  )
                )
                .orderBy(asc(restaurantLineModifiers.position), asc(restaurantLineModifiers.id))
                .all();
        if (expectedRoundCount !== rounds.length || expectedModifierCount !== modifiers.length) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
            message: 'Restaurant round or modifier metadata is incomplete for this service',
          });
        }

        const courseById = new Map(courses.map(course => [course.id, course]));
        const roundById = new Map(rounds.map(round => [round.id, round]));
        const referencedDinerIds = [
          ...new Set(lines.flatMap(line => (line.dinerId ? [line.dinerId] : []))),
        ];
        const referencedDiners =
          referencedDinerIds.length === 0
            ? []
            : tx
                .select({
                  id: restaurantDiners.id,
                  serviceId: restaurantDiners.serviceId,
                  isActive: restaurantDiners.isActive,
                })
                .from(restaurantDiners)
                .where(
                  and(
                    eq(restaurantDiners.tenantId, ctx.tenantId),
                    inArray(restaurantDiners.id, referencedDinerIds)
                  )
                )
                .all();
        if (
          referencedDiners.length !== referencedDinerIds.length ||
          referencedDiners.some(diner => diner.serviceId !== service.id || !diner.isActive) ||
          lines.some(
            line =>
              line.currentProductId !== line.productId ||
              (line.courseId !== null && courseById.get(line.courseId)?.checkId !== line.checkId) ||
              (line.roundId !== null && roundById.get(line.roundId)?.checkId !== line.checkId)
          )
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
            message: 'Restaurant line references metadata outside its tenant-scoped aggregate',
          });
        }

        const groupBy = <T>(rows: T[], key: (row: T) => string): Map<string, T[]> => {
          const grouped = new Map<string, T[]>();
          for (const row of rows) {
            const id = key(row);
            const values = grouped.get(id) ?? [];
            values.push(row);
            grouped.set(id, values);
          }
          return grouped;
        };
        const coursesByCheck = groupBy(courses, course => course.checkId);
        const roundsByCheck = groupBy(rounds, round => round.checkId);
        const modifiersByLine = groupBy(modifiers, modifier => modifier.checkLineId);
        if (
          lines.some(
            line =>
              roundMoney(line.restaurantModifierAmount) !==
              restaurantModifierAmount(modifiersByLine.get(line.id) ?? [])
          )
        ) {
          throwServerError({
            trpcCode: 'CONFLICT',
            errorCode: 'RESTAURANT_SERVICE_STATE_INVALID',
            message: 'Restaurant modifier snapshots do not match the frozen sale amounts',
          });
        }
        const linesByCheck = groupBy(
          lines.map(
            ({
              productNameSnapshot,
              currentProductName,
              currentProductId: _,
              restaurantModifierAmount: _restaurantModifierAmount,
              ...line
            }) => ({
              ...line,
              productName: productNameSnapshot ?? currentProductName ?? line.productId,
              modifiers: modifiersByLine.get(line.id) ?? [],
            })
          ),
          line => line.checkId
        );

        return {
          table,
          service,
          reservation,
          diners,
          checks: checks.map(check => ({
            id: check.id,
            saleId: check.saleId,
            label: check.label,
            status: check.status,
            version: check.version,
            openedAt: check.openedAt,
            saleNumber: check.saleNumber,
            total: check.total,
            suspendedAt: check.suspendedAt,
            courses: coursesByCheck.get(check.id) ?? [],
            rounds: roundsByCheck.get(check.id) ?? [],
            lines: linesByCheck.get(check.id) ?? [],
          })),
        };
      })
    ),
});

/** tRPC router type exported for end-to-end client inference. */
export type RestaurantServicesRouter = typeof restaurantServicesRouter;
