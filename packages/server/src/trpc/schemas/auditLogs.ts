/**
 * Audit Log Zod Schemas (Phase 8 / Tier-2 #8).
 *
 * @module trpc/schemas/auditLogs
 */

import { z } from 'zod';
import {
  auditLogActionEnum,
  auditLogResourceTypeEnum,
} from '../../db/schema.js';

export const auditLogActionSchema = z.enum(auditLogActionEnum);
export const auditLogResourceTypeSchema = z.enum(auditLogResourceTypeEnum);

export const listAuditLogsInput = z
  .object({
    limit: z.number().int().positive().max(500).optional(),
    action: auditLogActionSchema.optional(),
    resourceType: auditLogResourceTypeSchema.optional(),
    /** Narrow to a single affected resource (e.g. one quotation id). */
    resourceId: z.string().min(1).optional(),
    /** Filter by the user who performed the action. */
    actorId: z.string().min(1).optional(),
    /** ISO datetime — include rows AFTER this timestamp (inclusive). */
    createdAfter: z.string().datetime({ offset: true }).optional(),
    /** ISO datetime — include rows BEFORE this timestamp (inclusive). */
    createdBefore: z.string().datetime({ offset: true }).optional(),
  })
  .optional();

export type ListAuditLogsInput = z.infer<typeof listAuditLogsInput>;
