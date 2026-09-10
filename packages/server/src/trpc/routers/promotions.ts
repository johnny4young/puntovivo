/** Manager-owned lifecycle for explicit, versioned pricing promotions. */
import { router } from '../init.js';
import { managerOrAdminProcedure } from '../middleware/roles.js';
import {
  activateExpirySuggestionInput,
  createPromotionInput,
  expiryPromotionsForLotsInput,
  listPromotionsInput,
  transitionPromotionInput,
  updatePromotionInput,
} from '../schemas/promotions.js';
import {
  activateExpirySuggestion,
  createPromotion,
  listExpiryPromotionsForLots,
  listPromotions,
  transitionPromotion,
  updatePromotion,
} from '../../services/promotions.js';
import { resolveTenantBusinessClock } from '../../services/pharmacy/business-clock.js';

export const promotionsRouter = router({
  expiryForLots: managerOrAdminProcedure
    .input(expiryPromotionsForLotsInput)
    .query(({ ctx, input }) =>
      listExpiryPromotionsForLots(ctx.db, { tenantId: ctx.tenantId, lotIds: input.lotIds })
    ),

  list: managerOrAdminProcedure.input(listPromotionsInput).query(({ ctx, input }) =>
    listPromotions(ctx.db, {
      tenantId: ctx.tenantId,
      page: input.page,
      perPage: input.perPage,
      ...(input.status ? { status: input.status } : {}),
    })
  ),

  create: managerOrAdminProcedure.input(createPromotionInput).mutation(({ ctx, input }) =>
    createPromotion(ctx.db, {
      tenantId: ctx.tenantId,
      actorId: ctx.user!.id,
      rule: input,
    })
  ),

  update: managerOrAdminProcedure.input(updatePromotionInput).mutation(({ ctx, input }) => {
    const { id, version, ...rule } = input;
    return updatePromotion(ctx.db, {
      tenantId: ctx.tenantId,
      actorId: ctx.user!.id,
      id,
      version,
      rule,
    });
  }),

  transition: managerOrAdminProcedure.input(transitionPromotionInput).mutation(({ ctx, input }) =>
    transitionPromotion(ctx.db, {
      tenantId: ctx.tenantId,
      actorId: ctx.user!.id,
      ...input,
    })
  ),

  activateExpirySuggestion: managerOrAdminProcedure
    .input(activateExpirySuggestionInput)
    .mutation(async ({ ctx, input }) => {
      const clock = await resolveTenantBusinessClock(ctx.db, ctx.tenantId);
      return activateExpirySuggestion(ctx.db, {
        tenantId: ctx.tenantId,
        actorId: ctx.user!.id,
        suggestionId: input.suggestionId,
        nowIso: clock.nowIso,
        businessDate: clock.businessDate,
        timezone: clock.timezone,
        countryCode: clock.countryCode,
        localeVersion: clock.localeVersion,
      });
    }),
});

export type PromotionsRouter = typeof promotionsRouter;
