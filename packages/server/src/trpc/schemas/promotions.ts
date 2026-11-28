import { z } from 'zod';
import { parseStrictIsoInstant } from '../../lib/isoDate.js';
import { paginationInput } from './common.js';

export const promotionStatusInput = z.enum(['draft', 'active', 'paused', 'archived']);
export const promotionRuleKindInput = z.enum(['percentage', 'fixed_amount', 'nxm']);

const timeOfDaySchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM 24h format');

const promotionRuleShape = {
  name: z.string().trim().min(1).max(120),
  ruleKind: promotionRuleKindInput.default('percentage'),
  discountPct: z.number().finite().positive().max(100).optional(),
  discountAmount: z.number().finite().positive().max(1_000_000_000).nullable().optional(),
  buyQuantity: z.number().int().min(2).max(100).nullable().optional(),
  payQuantity: z.number().int().min(1).max(99).nullable().optional(),
  siteId: z.string().min(1).nullable().optional(),
  productId: z.string().min(1).nullable().optional(),
  categoryId: z.string().min(1).nullable().optional(),
  customerId: z.string().min(1).nullable().optional(),
  minQuantity: z.number().finite().positive().max(1_000_000).default(1),
  startsAt: z.string().datetime({ offset: true }).nullable().optional(),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  scheduleDays: z.array(z.number().int().min(0).max(6)).max(7).nullable().optional(),
  scheduleStartTime: timeOfDaySchema.nullable().optional(),
  scheduleEndTime: timeOfDaySchema.nullable().optional(),
  priority: z.number().int().min(-10_000).max(10_000).default(0),
  combinable: z.boolean().default(false),
};

function validatePromotionRule(
  value: {
    ruleKind?: 'percentage' | 'fixed_amount' | 'nxm' | undefined;
    discountPct?: number | undefined;
    discountAmount?: number | null | undefined;
    buyQuantity?: number | null | undefined;
    payQuantity?: number | null | undefined;
    productId?: string | null | undefined;
    categoryId?: string | null | undefined;
    startsAt?: string | null | undefined;
    endsAt?: string | null | undefined;
    scheduleStartTime?: string | null | undefined;
    scheduleEndTime?: string | null | undefined;
  },
  ctx: z.RefinementCtx
) {
  const kind = value.ruleKind ?? 'percentage';
  if (kind === 'percentage') {
    if (typeof value.discountPct !== 'number' || !(value.discountPct > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountPct'],
        message: 'Percentage promotions require a discount percentage between 0 and 100',
      });
    }
  } else if (kind === 'fixed_amount') {
    if (typeof value.discountAmount !== 'number' || !(value.discountAmount > 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountAmount'],
        message: 'Fixed-amount promotions require a positive discount amount',
      });
    }
  } else if (kind === 'nxm') {
    if (typeof value.buyQuantity !== 'number' || typeof value.payQuantity !== 'number') {
      ctx.addIssue({
        code: 'custom',
        path: ['buyQuantity'],
        message: 'NxM promotions require both buy and pay quantities',
      });
    } else if (value.payQuantity >= value.buyQuantity) {
      ctx.addIssue({
        code: 'custom',
        path: ['payQuantity'],
        message: 'Pay quantity must be strictly less than buy quantity',
      });
    }
  }
  if (value.productId && value.categoryId) {
    ctx.addIssue({
      code: 'custom',
      path: ['categoryId'],
      message: 'Choose a product or a category, not both',
    });
  }
  if (value.startsAt && value.endsAt) {
    // Instants, not text. The fields accept offsets, so a lexical compare
    // rejects perfectly good intervals: 12:00+05:00 is 07:00Z, which is an
    // hour BEFORE 08:00Z, yet '1' sorts after '0' and the window is refused.
    const startsAt = parseStrictIsoInstant(value.startsAt);
    const endsAt = parseStrictIsoInstant(value.endsAt);
    if (startsAt === null || endsAt === null || startsAt >= endsAt) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'End must be after start' });
    }
  }
  const hasStart = Boolean(value.scheduleStartTime);
  const hasEnd = Boolean(value.scheduleEndTime);
  if (hasStart !== hasEnd) {
    ctx.addIssue({
      code: 'custom',
      path: [hasStart ? 'scheduleEndTime' : 'scheduleStartTime'],
      message: 'Provide both start and end times for a recurring time window',
    });
  } else if (hasStart && hasEnd && value.scheduleStartTime === value.scheduleEndTime) {
    ctx.addIssue({
      code: 'custom',
      path: ['scheduleEndTime'],
      message: 'Schedule end time must differ from start time',
    });
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
