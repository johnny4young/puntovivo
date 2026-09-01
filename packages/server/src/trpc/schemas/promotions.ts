import { z } from 'zod';
import { paginationInput } from './common.js';

export const promotionStatusInput = z.enum(['draft', 'active', 'paused', 'archived']);

const promotionRuleShape = {
  name: z.string().trim().min(1).max(120),
  discountPct: z.number().finite().positive().max(100),
  siteId: z.string().min(1).nullable().optional(),
  productId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  customerId: z.string().min(1).nullable().optional(),
  minQuantity: z.number().finite().positive().max(1_000_000).default(1),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  priority: z.number().int().min(-10_000).max(10_000).default(0),
  combinable: z.boolean().default(false),
};

function validatePromotionRule(
  value: {
    productId?: string | null | undefined;
    categoryId?: string | null | undefined;
    startsAt?: string | null | undefined;
    endsAt?: string | null | undefined;
  },
  ctx: z.RefinementCtx
) {
  if (value.productId && value.categoryId) {
    ctx.addIssue({
      code: 'custom',
      path: ['categoryId'],
      message: 'Choose a product or a category, not both',
    });
  }
  if (value.startsAt && value.endsAt && value.startsAt >= value.endsAt) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End must be after start' });
  }
}

export const createPromotionInput = z
  .object(promotionRuleShape)
  .strict()
  .superRefine(validatePromotionRule);

export const updatePromotionInput = z
  .object({ id: z.string().min(1), version: z.number().int().positive(), ...promotionRuleShape })
  .strict()
  .superRefine(validatePromotionRule);

export const transitionPromotionInput = z
  .object({
    id: z.string().min(1),
    version: z.number().int().positive(),
    status: promotionStatusInput,
  })
  .strict();

export const listPromotionsInput = paginationInput.extend({
  status: promotionStatusInput.optional(),
});

export const activateExpirySuggestionInput = z.object({ suggestionId: z.string().min(1) }).strict();

export const expiryPromotionsForLotsInput = z
  .object({ lotIds: z.array(z.string().min(1)).max(200) })
  .strict();

export type CreatePromotionInput = z.infer<typeof createPromotionInput>;
