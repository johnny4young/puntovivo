import { externalOrderErrors } from '../middleware/externalOrderErrors.js';
import {
  acceptExternalOrder,
  closeExternalOrder,
} from '../../application/external-orders/commands.js';
import { quoteExternalOrder } from '../../application/external-orders/quote.js';
import { buildLifecycleContext } from './sales/helpers.js';
/** Generic signed ingress plus least-privilege, tenant/site-scoped operator projections. */
import { and, asc, desc, eq, gt, or } from 'drizzle-orm';
import {
  externalOrderConnectors,
  externalOrders,
  externalOrderEvents,
  sales,
} from '../../db/schema.js';
import {
  createExternalConnector,
  updateExternalConnector,
  projectExternalConnector,
} from '../../application/external-orders/connectors.js';
import { assertExternalOrderSite } from '../../application/external-orders/invariants.js';
import { receiveExternalOrder } from '../../application/external-orders/receive.js';
import { externalOrderError } from '../../services/external-orders/errors.js';
import { hasExternalOrderSecretKey } from '../../services/external-orders/secret-box.js';
import { router, publicProcedure } from '../init.js';
import { adminProcedure, managerOrAdminProcedure } from '../middleware/roles.js';
import { createModuleGuard } from '../middleware/modules.js';
import { commandEnvelope, asCriticalCommandContext } from '../middleware/commandEnvelope.js';
import { ensureTenantSite } from '../middleware/tenantSite.js';
import { rateLimitFor } from '../middleware/procedureRateLimit.js';
import {
  createExternalConnectorInput,
  updateExternalConnectorInput,
  receiveExternalOrderInput,
  externalSiteInput,
  externalTargetInput,
  listExternalOrdersInput,
  acceptExternalOrderInput,
  rejectExternalOrderInput,
} from '../schemas/externalOrders.js';
const read = managerOrAdminProcedure.use(externalOrderErrors).use(createModuleGuard('delivery'));
const admin = adminProcedure.use(externalOrderErrors).use(createModuleGuard('delivery'));
const command = admin.use(commandEnvelope);
const orderCommand = read.use(commandEnvelope);
export const externalOrdersRouter = router({
  quote: read.input(externalTargetInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return quoteExternalOrder(ctx.db, ctx.tenantId, input.siteId, input.id);
  }),
  accept: orderCommand.input(acceptExternalOrderInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return acceptExternalOrder(buildLifecycleContext(ctx), input);
  }),
  reject: orderCommand.input(rejectExternalOrderInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return closeExternalOrder(asCriticalCommandContext(ctx), input, 'reject');
  }),
  resolveCancellation: orderCommand
    .input(rejectExternalOrderInput)
    .mutation(async ({ ctx, input }) => {
      await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
      return closeExternalOrder(asCriticalCommandContext(ctx), input, 'resolveCancellation');
    }),
  receive: publicProcedure
    .use(externalOrderErrors)
    .use(
      rateLimitFor({ name: 'external-orders.receive', max: 60, windowMs: 60_000, keyBy: ['ip'] })
    )
    .input(receiveExternalOrderInput)
    .mutation(({ ctx, input }) => receiveExternalOrder(ctx.db, input)),
  connectors: admin.input(externalSiteInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    assertExternalOrderSite(ctx.db, ctx.tenantId, input.siteId);
    const rows = ctx.db
      .select()
      .from(externalOrderConnectors)
      .where(
        and(
          eq(externalOrderConnectors.tenantId, ctx.tenantId),
          eq(externalOrderConnectors.siteId, input.siteId)
        )
      )
      .orderBy(asc(externalOrderConnectors.id))
      .limit(100)
      .all();
    return { keyAvailable: hasExternalOrderSecretKey(), rows: rows.map(projectExternalConnector) };
  }),
  createConnector: command.input(createExternalConnectorInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return createExternalConnector(asCriticalCommandContext(ctx), input);
  }),
  updateConnector: command.input(updateExternalConnectorInput).mutation(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    return updateExternalConnector(asCriticalCommandContext(ctx), input);
  }),
  list: read.input(listExternalOrdersInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    assertExternalOrderSite(ctx.db, ctx.tenantId, input.siteId);
    const rows = ctx.db
      .select()
      .from(externalOrders)
      .where(
        and(
          eq(externalOrders.tenantId, ctx.tenantId),
          eq(externalOrders.siteId, input.siteId),
          ...(input.status ? [eq(externalOrders.status, input.status)] : []),
          ...(input.cursor
            ? [
                or(
                  gt(externalOrders.createdAt, input.cursor.createdAt),
                  and(
                    eq(externalOrders.createdAt, input.cursor.createdAt),
                    gt(externalOrders.id, input.cursor.id)
                  )
                ),
              ]
            : [])
        )
      )
      .orderBy(asc(externalOrders.createdAt), asc(externalOrders.id))
      .limit(input.limit + 1)
      .all();
    return { rows: rows.slice(0, input.limit), hasMore: rows.length > input.limit };
  }),
  get: read.input(externalTargetInput).query(async ({ ctx, input }) => {
    await ensureTenantSite(ctx.db, ctx.tenantId, input.siteId);
    assertExternalOrderSite(ctx.db, ctx.tenantId, input.siteId);
    const row = ctx.db
      .select()
      .from(externalOrders)
      .where(
        and(
          eq(externalOrders.tenantId, ctx.tenantId),
          eq(externalOrders.siteId, input.siteId),
          eq(externalOrders.id, input.id)
        )
      )
      .get();
    if (!row) externalOrderError('missing');
    const events = ctx.db
      .select()
      .from(externalOrderEvents)
      .where(
        and(
          eq(externalOrderEvents.tenantId, ctx.tenantId),
          eq(externalOrderEvents.siteId, input.siteId),
          eq(externalOrderEvents.orderId, row.id)
        )
      )
      .orderBy(desc(externalOrderEvents.version))
      .limit(100)
      .all();
    const sale = row.saleId
      ? (ctx.db
          .select({
            id: sales.id,
            saleNumber: sales.saleNumber,
            status: sales.status,
            paymentStatus: sales.paymentStatus,
          })
          .from(sales)
          .where(and(eq(sales.tenantId, ctx.tenantId), eq(sales.id, row.saleId)))
          .get() ?? null)
      : null;
    return { ...row, events, sale };
  }),
});
