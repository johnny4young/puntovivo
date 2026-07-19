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

const shiftValuePolicySchema = z
  .object({
    enabled: z.boolean(),
    maxCount: z.number().int().min(0).max(1000),
    maxAmount: z.number().finite().min(0).max(1_000_000_000_000),
  })
  .strict();

const noSalePolicySchema = z
  .object({
    enabled: z.boolean(),
    maxCount: z.number().int().min(0).max(1000),
  })
  .strict();

const dualApprovalPolicySchema = z
  .object({
    enabled: z.boolean(),
    thresholdAmount: z.number().finite().min(0).max(1_000_000_000_000),
  })
  .strict();

const whatsappRecipientSchema = z
  .string()
  .trim()
  .max(32)
  .refine(value => {
    if (value === '') return true;
    const normalized = value.replace(/[\s().-]/g, '').replace(/^\+/, '');
    return /^[1-9]\d{7,14}$/.test(normalized);
  }, 'Enter a valid international WhatsApp number');

const alertPolicySchema = z
  .object({
    whatsappHandoff: z
      .object({
        enabled: z.boolean(),
        recipientPhone: whatsappRecipientSchema,
      })
      .strict()
      .superRefine((value, ctx) => {
        if (value.enabled && value.recipientPhone.trim().length === 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['recipientPhone'],
            message: 'A WhatsApp recipient is required when handoff is enabled',
          });
        }
      }),
  })
  .strict();

const rolePolicySchema = z
  .object({
    maxDiscountPercent: z.number().finite().min(0).max(100),
    afterHoursSale: afterHoursPolicySchema,
    shift: z
      .object({
        refunds: shiftValuePolicySchema,
        voids: shiftValuePolicySchema,
        noSale: noSalePolicySchema,
      })
      .strict(),
    dualApproval: dualApprovalPolicySchema,
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
    // Optional for rolling upgrades: a v3 renderer can still update role
    // limits without erasing the server-owned v4 delivery configuration.
    alerts: alertPolicySchema.optional(),
  })
  .strict();

export const listLossPreventionAlertsInput = z
  .object({
    siteId: z.string().trim().min(1),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict();

export const acknowledgeLossPreventionAlertInput = z
  .object({
    siteId: z.string().trim().min(1),
    alertId: z.string().trim().min(1),
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

export const evaluateShiftActionLossPreventionInput = z.discriminatedUnion('action', [
  z
    .object({
      action: z.enum(['sale_refund', 'sale_void']),
      saleId: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      action: z.literal('cash_drawer_open'),
      siteId: z.string().trim().min(1),
    })
    .strict(),
]);

export type UpdateLossPreventionSettingsInput = z.infer<typeof updateLossPreventionSettingsInput>;
