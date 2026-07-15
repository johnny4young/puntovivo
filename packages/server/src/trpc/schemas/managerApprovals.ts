import { z } from 'zod';
import { managerApprovalActionEnum } from '../../db/schema.js';
import { staffPinSchema } from './auth.js';

const checkoutApprovalContextSchema = z
  .object({
    mode: z.enum(['fresh', 'fromDraft']),
    saleId: z.string().min(1).nullable(),
    customerId: z.string().min(1).nullable(),
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
    paymentMethod: z.enum(['cash', 'card', 'transfer', 'credit', 'other']),
    payments: z.array(
      z
        .object({
          method: z.enum(['cash', 'card', 'transfer', 'credit', 'other']),
          amount: z.number().finite().nonnegative(),
          reference: z.string().nullable().optional(),
        })
        .strict()
    ),
    amountReceived: z.number().finite().nonnegative().nullable(),
    discountAmount: z.number().finite().nonnegative(),
    total: z.number().finite().nonnegative(),
    creditAmount: z.number().finite().nonnegative(),
    tipAmount: z.number().finite().nonnegative(),
    serviceChargeAmount: z.number().finite().nonnegative(),
    currencyCode: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.mode === 'fromDraft') !== (value.saleId !== null)) {
      ctx.addIssue({
        code: 'custom',
        path: ['saleId'],
        message: 'Draft checkout mode requires a sale ID',
      });
    }
  });

export const managerApprovalActionSchema = z.enum(managerApprovalActionEnum);

export const managerApprovalSummarySchema = z
  .object({
    label: z.string().trim().min(1, 'A request label is required').max(160),
    amount: z.number().finite().nonnegative().optional(),
    currencyCode: z
      .string()
      .trim()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.amount === undefined) !== (value.currencyCode === undefined)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Amount and currency code must be supplied together',
      });
    }
  });

export const requestManagerApprovalInput = z
  .object({
    action: managerApprovalActionSchema,
    reason: z.string().trim().min(3, 'A reason is required').max(500),
    resourceType: z.string().trim().min(1).max(64),
    resourceId: z.string().trim().min(1).max(255).optional(),
    checkoutContext: checkoutApprovalContextSchema.optional(),
    summary: managerApprovalSummarySchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.resourceType === 'sale_checkout') !== (value.checkoutContext !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['checkoutContext'],
        message: 'Checkout approvals require a checkout context',
      });
    }
  });

export const listManagerApprovalQueueInput = z
  .object({
    siteId: z.string().trim().min(1).optional(),
    limit: z.number().int().min(1).max(50).default(20),
  })
  .strict()
  .default({ limit: 20 });

export const listOwnManagerApprovalsInput = z
  .object({
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict()
  .default({ limit: 10 });

export const availableManagerApproversInput = z
  .object({ action: managerApprovalActionSchema })
  .strict();

export const decideManagerApprovalWithPinInput = z
  .object({
    requestId: z.string().trim().min(1),
    approverId: z.string().trim().min(1),
    pin: staffPinSchema,
    decision: z.enum(['approved', 'rejected']),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === 'rejected' && !value.reason) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'A rejection reason is required',
      });
    }
  });

export const cancelManagerApprovalInput = z
  .object({ requestId: z.string().trim().min(1) })
  .strict();

export type ManagerApprovalActionInput = z.infer<typeof managerApprovalActionSchema>;
export type RequestManagerApprovalInput = z.infer<typeof requestManagerApprovalInput>;
