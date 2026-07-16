import { z } from 'zod';

const localTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

const afterHoursPolicySchema = z
  .object({
    enabled: z.boolean(),
    blockedFrom: localTimeSchema,
    blockedUntil: localTimeSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.enabled && value.blockedFrom === value.blockedUntil) {
      ctx.addIssue({
        code: 'custom',
        path: ['blockedUntil'],
        message: 'The blocked sales window must have distinct start and end times',
      });
    }
  });

const rolePolicySchema = z
  .object({
    maxDiscountPercent: z.number().finite().min(0).max(100),
    afterHoursSale: afterHoursPolicySchema,
  })
  .strict();

export const updateLossPreventionSettingsInput = z
  .object({
    roles: z
      .object({
        cashier: rolePolicySchema,
        manager: rolePolicySchema,
      })
      .strict(),
  })
  .strict();

export const evaluateCheckoutLossPreventionInput = z
  .object({
    items: z
      .array(
        z
          .object({
            productId: z.string().min(1),
            unitId: z.string(),
            quantity: z.number().finite().positive(),
            unitPrice: z.number().finite().nonnegative(),
            discount: z.number().finite().min(0).max(100),
          })
          .strict()
      )
      .min(1),
    discountAmount: z.number().finite().nonnegative(),
  })
  .strict();

export type UpdateLossPreventionSettingsInput = z.infer<typeof updateLossPreventionSettingsInput>;
