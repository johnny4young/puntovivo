import { z } from 'zod';

import { DATA_RETENTION_LIMITS } from '../../services/data-retention.js';

function retentionDays(key: keyof typeof DATA_RETENTION_LIMITS) {
  const limits = DATA_RETENTION_LIMITS[key];
  return z.number().int().min(limits.min).max(limits.max);
}

export const updateDataRetentionPolicyInput = z
  .object({
    operationalAuditDays: retentionDays('operationalAuditDays'),
    privacyAuditDays: retentionDays('privacyAuditDays'),
    aiAuditDays: retentionDays('aiAuditDays'),
    syncedOutboxDays: retentionDays('syncedOutboxDays'),
  })
  .superRefine((value, ctx) => {
    if (value.privacyAuditDays < value.operationalAuditDays) {
      ctx.addIssue({
        code: 'custom',
        path: ['privacyAuditDays'],
        message: 'Privacy audit retention cannot be shorter than operational audit retention',
      });
    }
  });

export type UpdateDataRetentionPolicyInput = z.infer<
  typeof updateDataRetentionPolicyInput
>;
