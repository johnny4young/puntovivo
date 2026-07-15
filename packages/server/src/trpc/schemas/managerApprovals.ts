import { z } from 'zod';
import { managerApprovalActionEnum } from '../../db/schema.js';
import { staffPinSchema } from './auth.js';

export const managerApprovalActionSchema = z.enum(managerApprovalActionEnum);

export const managerApprovalSummarySchema = z
  .object({
    label: z.string().trim().min(1, 'A request label is required').max(160),
    amount: z.number().finite().nonnegative().optional(),
    currencyCode: z.string().trim().regex(/^[A-Z]{3}$/).optional(),
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
    summary: managerApprovalSummarySchema,
  })
  .strict();

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
