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

export const pushSyncInput = z.object({
  limit: z.number().int().min(1).max(100).default(50),
});

export const pullSyncInput = z.object({
  queueLimit: z.number().int().min(1).max(100).default(20),
  conflictLimit: z.number().int().min(1).max(100).default(20),
});

export const resolveSyncConflictInput = z
  .object({
    id: z.string().min(1, 'Conflict ID is required'),
    resolution: z.enum(['local_wins', 'remote_wins', 'merged']),
    mergedData: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((input, ctx) => {
    if (input.resolution === 'merged' && !input.mergedData) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mergedData'],
        message: 'Merged data is required when using merged resolution',
      });
    }
  });

// ENG-064/064b — sync_outbox surfaces. These operator procedures use
// the canonical sync outbox table after the legacy sync_queue cutover.
export const peekOutboxInput = z.object({
  limit: z.number().int().min(1).max(100).default(20),
});

export const retryOutboxInput = z.object({
  id: z.string().min(1, 'sync_outbox row id is required'),
});

export type ListQueueInput = z.infer<typeof listQueueInput>;
export type AddToQueueInput = z.infer<typeof addToQueueInput>;
export type RemoveFromQueueInput = z.infer<typeof removeFromQueueInput>;
export type ListConflictsInput = z.infer<typeof listConflictsInput>;
export type PushSyncInput = z.infer<typeof pushSyncInput>;
export type PullSyncInput = z.infer<typeof pullSyncInput>;
export type ResolveSyncConflictInput = z.infer<typeof resolveSyncConflictInput>;
export type PeekOutboxInput = z.infer<typeof peekOutboxInput>;
export type RetryOutboxInput = z.infer<typeof retryOutboxInput>;
