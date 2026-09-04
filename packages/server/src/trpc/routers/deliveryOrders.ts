/** Site-scoped delivery logistics, deliberately separate from financial sale commands. */
import { and, desc, eq, lt, notExists, notInArray, or, sql } from 'drizzle-orm';
import {
  cashSessions,
  sales,
  saleReturns,
  deliveryOrderEvents,
  deliveryOrders,
  deliveryOrderStatusEnum,
} from '../../db/schema.js';
import {
  advanceDelivery,
  createDelivery,
  createDeliveryFromSale,
  deliveryNotFound,
  deliveryTransitions,
} from '../../application/delivery/commands.js';
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import { createModuleGuard } from '../middleware/modules.js';
import { commandEnvelope, asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import {
  advanceDeliveryInput,
  createDeliveryInput,
  createDeliveryFromSaleInput,
  deliverySaleOptionsInput,
  deliverySiteInput,
  deliveryTargetInput,
  listDeliveryInput,
} from '../schemas/deliveryOrders.js';

const readProcedure = managerOrAdminProcedure.use(createModuleGuard('delivery'));
// Both role and module gates precede the replay cache; disabling delivery must revoke cached access too.
const commandProcedure = readProcedure.use(commandEnvelope);

export const deliveryOrdersRouter = router({
  list: readProcedure.input(listDeliveryInput).query(async ({ ctx, input }) => {
    const site = await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    if (!site.isActive) deliveryNotFound();
    const conditions = [
      eq(deliveryOrders.tenantId, ctx.tenantId),
      eq(deliveryOrders.siteId, input.siteId),
    ];
    if (input.status) conditions.push(eq(deliveryOrders.status, input.status));
    if (input.cursor)
      conditions.push(
        or(
          lt(deliveryOrders.acceptedAt, input.cursor.acceptedAt),
          and(
            eq(deliveryOrders.acceptedAt, input.cursor.acceptedAt),
            lt(deliveryOrders.id, input.cursor.id)
          )
        )!
      );
    return ctx.db
      .select()
      .from(deliveryOrders)
      .where(and(...conditions))
      .orderBy(desc(deliveryOrders.acceptedAt), desc(deliveryOrders.id))
      .limit(input.limit)
      .all()
      .map(row => ({ ...row, allowedTransitions: deliveryTransitions(row.status) }));
  }),
  /** Uncapped counts are a separate aggregate, not the length of a limited page. */
  counts: readProcedure.input(deliverySiteInput).query(async ({ ctx, input }) => {
    const site = await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    if (!site.isActive) deliveryNotFound();
    const rows = ctx.db
      .select({ status: deliveryOrders.status, count: sql<number>`count(*)` })
      .from(deliveryOrders)
      .where(
        and(eq(deliveryOrders.tenantId, ctx.tenantId), eq(deliveryOrders.siteId, input.siteId))
      )
      .groupBy(deliveryOrders.status)
      .all();
    return Object.fromEntries(
      deliveryOrderStatusEnum.map(status => [
        status,
        rows.find(row => row.status === status)?.count ?? 0,
      ])
    );
  }),
  get: readProcedure.input(deliveryTargetInput).query(async ({ ctx, input }) => {
    const site = await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    if (!site.isActive) deliveryNotFound();
    const row = ctx.db
      .select()
      .from(deliveryOrders)
      .where(
        and(
          eq(deliveryOrders.id, input.id),
          eq(deliveryOrders.tenantId, ctx.tenantId),
          eq(deliveryOrders.siteId, input.siteId)
        )
      )
      .get();
    if (!row) deliveryNotFound();
    const events = ctx.db
      .select()
      .from(deliveryOrderEvents)
      .where(
        and(
          eq(deliveryOrderEvents.deliveryOrderId, row.id),
          eq(deliveryOrderEvents.tenantId, ctx.tenantId),
          eq(deliveryOrderEvents.siteId, input.siteId)
        )
      )
      .orderBy(desc(deliveryOrderEvents.version))
      .limit(100)
      .all();
    return { ...row, allowedTransitions: deliveryTransitions(row.status), events };
  }),
  /** Bounded owned completed-sale choices; the writer repeats all eligibility checks. */
  saleOptions: readProcedure.input(deliverySaleOptionsInput).query(async ({ ctx, input }) => {
    const site = await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    if (!site.isActive) deliveryNotFound();
    const escaped = input.search.replaceAll('!', '!!').replaceAll('%', '!%').replaceAll('_', '!_');
    return ctx.db
      .select({
        id: sales.id,
        saleNumber: sales.saleNumber,
        total: sales.total,
        currencyCode: sales.currencyCode,
      })
      .from(sales)
      .innerJoin(
        cashSessions,
        and(
          eq(cashSessions.id, sales.cashSessionId),
          eq(cashSessions.tenantId, ctx.tenantId),
          eq(cashSessions.siteId, input.siteId)
        )
      )
      .where(
        and(
          eq(sales.tenantId, ctx.tenantId),
          eq(sales.status, 'completed'),
          notInArray(sales.paymentStatus, ['refunded', 'partially_refunded']),
          notExists(
            ctx.db
              .select({ id: deliveryOrders.id })
              .from(deliveryOrders)
              .where(
                and(eq(deliveryOrders.tenantId, ctx.tenantId), eq(deliveryOrders.saleId, sales.id))
              )
          ),
          notExists(
            ctx.db
              .select({ id: saleReturns.id })
              .from(saleReturns)
              .where(and(eq(saleReturns.tenantId, ctx.tenantId), eq(saleReturns.saleId, sales.id)))
          ),
          ...(input.search
            ? [
                or(
                  eq(sales.id, input.search),
                  sql`${sales.saleNumber} LIKE ${`%${escaped}%`} ESCAPE '!'`
                ),
              ]
            : [])
        )
      )
      .orderBy(desc(sales.createdAt), desc(sales.id))
      .limit(25)
      .all();
  }),
  create: commandProcedure.input(createDeliveryInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return createDelivery(asCriticalCommandContext(ctx), input);
  }),
  createFromSale: commandProcedure
    .input(createDeliveryFromSaleInput)
    .mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return createDeliveryFromSale(asCriticalCommandContext(ctx), input);
    }),
  advance: commandProcedure.input(advanceDeliveryInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return advanceDelivery(asCriticalCommandContext(ctx), input);
  }),
});
