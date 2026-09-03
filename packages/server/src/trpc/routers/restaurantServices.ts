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
  restaurantTables,
  products,
  saleItems,
  sales,
} from '../../db/schema.js';
import { completeSale } from '../../application/sales/completeSale.js';
import {
  RESTAURANT_SERVICE_LIMITS,
  assertNoUnnormalizedRestaurantDrafts,
  restaurantModifierAmount,
} from '../../application/restaurant/service-lifecycle.js';
import { router } from '../init.js';
import { createModuleGuard } from '../middleware/modules.js';
import { cashierManagerOrAdminProcedure } from '../middleware/roles.js';
import { criticalCommandCashierManagerOrAdminProcedure } from '../middleware/criticalCommand.js';
import { buildLifecycleContext } from './sales/helpers.js';
import {
  getRestaurantTableStateInput,
  openRestaurantCheckInput,
} from '../schemas/restaurantServices.js';
import { throwServerError } from '../../lib/errorCodes.js';

const restaurantReadProcedure = cashierManagerOrAdminProcedure.use(createModuleGuard('dine-in'));
const restaurantCommandProcedure = criticalCommandCashierManagerOrAdminProcedure.use(
  createModuleGuard('dine-in')
);

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
          tableId: input.tableId,
          guestCount: input.guestCount,
          checkLabel: input.checkLabel,
          roundLabel: input.roundLabel,
          diners: input.diners,
          lines: input.items.map((item, itemIndex) => ({
            itemIndex,
            dinerClientId: item.dinerClientId,
            courseKey: item.courseKey,
            modifiers: item.modifiers,
          })),
        },
      });
      return {
        ...result.sale,
        change: result.change,
        loyaltyPointsEarned: result.loyaltyPointsEarned ?? 0,
      };
    }),

  /** Tenant-scoped complete open state for one table, including every check. */
  getTableState: restaurantReadProcedure
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
        if (!service) return { table, service: null, diners: [], checks: [] };
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
          diners,
          checks: checks.map(check => ({
            id: check.id,
            saleId: check.saleId,
            label: check.label,
            status: check.status,
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
