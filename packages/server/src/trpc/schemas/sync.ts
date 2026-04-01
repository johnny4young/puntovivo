/**
 * Sync Zod Schemas
 *
 * Input/output validation schemas for sync tRPC procedures
 *
 * @module trpc/schemas/sync
 */

import { z } from 'zod';
import { syncOperationEnum } from './common.js';

// ============================================================================
// Input Schemas
// ============================================================================

export const listQueueInput = z.object({
  limit: z.number().int().min(1).max(100).default(50),
});

export const addToQueueInput = z.object({
  entityType: z.string().min(1, 'Entity type is required'),
  entityId: z.string().min(1, 'Entity ID is required'),
  operation: syncOperationEnum,
  data: z.record(z.string(), z.unknown()).optional(),
});

export const removeFromQueueInput = z.object({
  id: z.string().min(1, 'ID is required'),
});

export const listConflictsInput = z.object({
  limit: z.number().int().min(1).max(100).default(50),
});

export type ListQueueInput = z.infer<typeof listQueueInput>;
export type AddToQueueInput = z.infer<typeof addToQueueInput>;
export type RemoveFromQueueInput = z.infer<typeof removeFromQueueInput>;
