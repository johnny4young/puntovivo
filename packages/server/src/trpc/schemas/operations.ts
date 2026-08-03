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

export const operationalAlertIdInputSchema = z.object({
  alertId: z.string().min(1).max(64),
});

export const operationalAlertDeliveryIdInputSchema = z.object({
  deliveryId: z.string().min(1).max(64),
});

const operationalAlertSchema = z.object({
  id: z.string(),
  area: z.enum(OPERATIONS_ATTENTION_AREAS),
  severity: z.enum(operationsAttentionSeverityEnum),
  status: z.enum(['open', 'acknowledged', 'resolved']),
  count: z.number().int().nonnegative(),
  firstObservedAt: z.string(),
  lastObservedAt: z.string(),
  acknowledgedAt: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  updatedAt: z.string(),
});

const operationalAlertDeliverySchema = z.object({
  id: z.string(),
  alertId: z.string(),
  subscriptionId: z.string(),
  subscriptionName: z.string(),
  transition: z.enum(['opened', 'escalated', 'acknowledged', 'resolved']),
  status: z.enum(['queued', 'submitting', 'delivered', 'retrying', 'dead_letter']),
  attempts: z.number().int().nonnegative(),
  responseStatus: z.number().int().nullable(),
  lastErrorCode: z.string().nullable(),
  deliveredAt: z.string().nullable(),
  updatedAt: z.string(),
});

export const operationalAlertsOverviewOutputSchema = z.object({
  provisioned: z.boolean(),
  retention: z.object({ attemptDays: z.number().int(), historyDays: z.number().int() }),
  subscriptions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      eventTypes: z.array(z.string()),
      enabled: z.boolean(),
      revokedAt: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
    })
  ),
  alerts: z.array(operationalAlertSchema),
  deliveries: z.array(operationalAlertDeliverySchema),
  attempts: z.array(
    z.object({
      id: z.string(),
      deliveryId: z.string(),
      attemptNumber: z.number().int().positive(),
      outcome: z.enum(['attempting', 'delivered', 'retrying', 'dead_letter']),
      responseStatus: z.number().int().nullable(),
      errorCode: z.string().nullable(),
      startedAt: z.string(),
      completedAt: z.string().nullable(),
    })
  ),
});

export const acknowledgeOperationalAlertOutputSchema = z.object({
  id: z.string(),
  status: z.literal('acknowledged'),
  acknowledgedAt: z.string(),
  deduped: z.boolean(),
});

export const retryOperationalAlertDeliveryOutputSchema = z.object({
  id: z.string(),
  status: z.literal('queued'),
});

export type OperationsNeedsAttentionOutput = z.infer<typeof operationsNeedsAttentionOutputSchema>;
