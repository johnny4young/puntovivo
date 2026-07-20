/**
 * Operations "Needs attention" Zod schemas.
 *
 * Output shape for `operations.needsAttention`, rendered by the
 * `NeedsAttentionPanel` on the Operations landing. The `area` enum is
 * imported from the service so the web `?tab=` deep-link target, the
 * server probe, and the i18n key registry never drift.
 *
 * @module trpc/schemas/operations
 */
import { z } from 'zod';

import { OPERATIONS_ATTENTION_AREAS } from '../../services/operations/attention.js';

/** Severity tone of an attention row. */
export const operationsAttentionSeverityEnum = ['danger', 'warning'] as const;

/** One area that currently needs attention (count > 0). */
export const operationsAttentionEntrySchema = z.object({
  area: z.enum(OPERATIONS_ATTENTION_AREAS),
  severity: z.enum(operationsAttentionSeverityEnum),
  count: z.number().int().nonnegative(),
});

/**
 * The Needs-attention payload. `areas` is empty when all clear;
 * `highestSeverity` is `null` then, else the most severe area present.
 */
export const operationsNeedsAttentionOutputSchema = z.object({
  areas: z.array(operationsAttentionEntrySchema),
  totalCount: z.number().int().nonnegative(),
  highestSeverity: z.enum(operationsAttentionSeverityEnum).nullable(),
});

export type OperationsNeedsAttentionOutput = z.infer<typeof operationsNeedsAttentionOutputSchema>;
