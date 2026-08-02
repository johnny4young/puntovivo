/**
 * Tenant-scoped operational alert lifecycle and external delivery projection.
 *
 * The dynamic Operations attention signal remains authoritative. This service
 * persists its open/acknowledged/resolved lifecycle and projects only a small,
 * allowlisted payload to explicitly provisioned signed-webhook destinations.
 * Acknowledgement never removes or hides the underlying incident.
 *
 * @module services/operations/alerts
 */
import { and, desc, eq, gte, inArray, isNull, lt, ne, notInArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import type { DatabaseInstance } from '../../db/index.js';
import {
  operationalAlertDeliveries,
  operationalAlertDeliveryAttempts,
  operationalAlerts,
  webhookSubscriptions,
  type OperationalAlertArea,
  type OperationalAlertDeliveryPayload,
  type OperationalAlertRow,
  type OperationalAlertTransition,
} from '../../db/schema.js';
import { writeAuditLog } from '../audit-logs.js';
import {
  getPayloadSchema,
  OPERATIONAL_ALERT_EVENT_TYPES,
  type PublicEventType,
} from '../events/manifest.js';
import { computeNeedsAttention } from './attention.js';

export const OPERATIONAL_ALERT_ATTEMPT_RETENTION_DAYS = 90;
export const OPERATIONAL_ALERT_HISTORY_RETENTION_DAYS = 365;

const DAY_MS = 86_400_000;

const EVENT_TYPE_BY_TRANSITION = {
  opened: 'operational_alert.opened',
  escalated: 'operational_alert.escalated',
  acknowledged: 'operational_alert.acknowledged',
  resolved: 'operational_alert.resolved',
} as const satisfies Record<OperationalAlertTransition, PublicEventType>;

const RECOVERY_PATH_BY_AREA: Record<OperationalAlertArea, string> = {
  sync: '/company?tab=data',
  fiscal: '/operations?tab=fiscal',
  device: '/operations?tab=device',
  payments: '/operations?tab=payments',
};

export function isOperationalAlertEventType(value: string): boolean {
  return (OPERATIONAL_ALERT_EVENT_TYPES as readonly string[]).includes(value);
}

function activeAlertSubscriptions(
  db: DatabaseInstance,
  tenantId: string
): Array<{ id: string; eventTypes: string[] }> {
  return db
    .select({ id: webhookSubscriptions.id, eventTypes: webhookSubscriptions.eventTypes })
    .from(webhookSubscriptions)
    .where(
      and(
        eq(webhookSubscriptions.tenantId, tenantId),
        eq(webhookSubscriptions.enabled, true),
        isNull(webhookSubscriptions.revokedAt)
      )
    )
    .all()
    .filter(subscription => subscription.eventTypes.some(isOperationalAlertEventType));
}

function deliveryPayload(
  alert: Pick<OperationalAlertRow, 'id' | 'area' | 'severity' | 'status' | 'count'>,
  transition: OperationalAlertTransition,
  occurredAt: string
): OperationalAlertDeliveryPayload {
  return {
    alertId: alert.id,
    area: alert.area,
    severity: alert.severity,
    status:
      transition === 'resolved'
        ? 'resolved'
        : transition === 'acknowledged'
          ? 'acknowledged'
          : 'open',
    count: alert.count,
    recoveryPath: RECOVERY_PATH_BY_AREA[alert.area],
    occurredAt,
  };
}

function queueAlertTransition(
  tx: DatabaseInstance,
  args: {
    tenantId: string;
    alert: Pick<OperationalAlertRow, 'id' | 'area' | 'severity' | 'status' | 'sequence' | 'count'>;
    transition: OperationalAlertTransition;
    occurredAt: string;
    subscriptions?: Array<{ id: string; eventTypes: string[] }>;
  }
): number {
  const eventType = EVENT_TYPE_BY_TRANSITION[args.transition];
  const payload = deliveryPayload(args.alert, args.transition, args.occurredAt);
  getPayloadSchema(eventType).parse(payload);
  const subscriptions = args.subscriptions ?? activeAlertSubscriptions(tx, args.tenantId);
  let queued = 0;
  for (const subscription of subscriptions) {
    if (!subscription.eventTypes.includes(eventType)) continue;
    const result = tx
      .insert(operationalAlertDeliveries)
      .values({
        id: nanoid(),
        tenantId: args.tenantId,
        alertId: args.alert.id,
        subscriptionId: subscription.id,
        transition: args.transition,
        alertSequence: args.alert.sequence,
        status: 'queued',
        payload,
        payloadVersion: 1,
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        responseStatus: null,
        priority: args.alert.severity === 'danger' ? 200 : 100,
        claimToken: null,
        lockedAt: null,
        deliveredAt: null,
        createdAt: args.occurredAt,
        updatedAt: args.occurredAt,
      })
      .onConflictDoNothing()
      .run();
    queued += result.changes;
  }
  return queued;
}

export function backfillOperationalAlertsForSubscription(
  tx: DatabaseInstance,
  args: { tenantId: string; subscriptionId: string; eventTypes: string[]; now?: Date }
): number {
  const nowIso = (args.now ?? new Date()).toISOString();
  const subscription = { id: args.subscriptionId, eventTypes: args.eventTypes };
  const activeAlerts = tx
    .select()
    .from(operationalAlerts)
    .where(and(eq(operationalAlerts.tenantId, args.tenantId), isNull(operationalAlerts.resolvedAt)))
    .all();
  let queued = 0;
  for (const alert of activeAlerts) {
    const transition = alert.status === 'acknowledged' ? 'acknowledged' : 'opened';
    const occurredAt =
      transition === 'acknowledged'
        ? (alert.acknowledgedAt ?? alert.lastObservedAt)
        : alert.firstObservedAt;
    queued += queueAlertTransition(tx, {
      tenantId: args.tenantId,
      alert,
      transition,
      occurredAt: occurredAt || nowIso,
      subscriptions: [subscription],
    });
  }
  return queued;
}

export async function reconcileOperationalAlerts(
  db: DatabaseInstance,
  tenantId: string,
  now: Date = new Date()
): Promise<{ opened: number; escalated: number; resolved: number }> {
  const attention = await computeNeedsAttention(db, tenantId);
  const nowIso = now.toISOString();
  const result = { opened: 0, escalated: 0, resolved: 0 };

  db.transaction(tx => {
    const activeRows = tx
      .select()
      .from(operationalAlerts)
      .where(and(eq(operationalAlerts.tenantId, tenantId), isNull(operationalAlerts.resolvedAt)))
      .all();
    const activeByArea = new Map(activeRows.map(alert => [alert.area, alert]));
    const observedAreas = new Set<OperationalAlertArea>();

    for (const entry of attention.areas) {
      observedAreas.add(entry.area);
      const existing = activeByArea.get(entry.area);
      if (!existing) {
        const id = nanoid();
        const insert = tx
          .insert(operationalAlerts)
          .values({
            id,
            tenantId,
            area: entry.area,
            severity: entry.severity,
            status: 'open',
            sequence: 1,
            count: entry.count,
            firstObservedAt: nowIso,
            lastObservedAt: nowIso,
            acknowledgedAt: null,
            acknowledgedByUserId: null,
            resolvedAt: null,
            createdAt: nowIso,
            updatedAt: nowIso,
          })
          .onConflictDoNothing()
          .run();
        if (insert.changes > 0) {
          const alert: OperationalAlertRow = {
            id,
            tenantId,
            area: entry.area,
            severity: entry.severity,
            status: 'open',
            sequence: 1,
            count: entry.count,
            firstObservedAt: nowIso,
            lastObservedAt: nowIso,
            acknowledgedAt: null,
            acknowledgedByUserId: null,
            resolvedAt: null,
            createdAt: nowIso,
            updatedAt: nowIso,
          };
          queueAlertTransition(tx, {
            tenantId,
            alert,
            transition: 'opened',
            occurredAt: nowIso,
          });
          result.opened += 1;
        }
        continue;
      }

      const escalated = existing.severity === 'warning' && entry.severity === 'danger';
      // Keep the highest severity observed during one active incident. If the
      // live counter briefly falls back to warning, a second rise must not
      // reuse the same one-shot `escalated` delivery identity.
      const nextSeverity = existing.severity === 'danger' ? 'danger' : entry.severity;
      const update = tx
        .update(operationalAlerts)
        .set({
          severity: nextSeverity,
          count: entry.count,
          lastObservedAt: nowIso,
          updatedAt: nowIso,
          ...(escalated
            ? {
                status: 'open' as const,
                sequence: existing.sequence + 1,
                acknowledgedAt: null,
                acknowledgedByUserId: null,
              }
            : {}),
        })
        .where(
          and(
            eq(operationalAlerts.id, existing.id),
            eq(operationalAlerts.tenantId, tenantId),
            ...(escalated
              ? [
                  eq(operationalAlerts.sequence, existing.sequence),
                  eq(operationalAlerts.severity, 'warning' as const),
                ]
              : [])
          )
        )
        .run();
      if (escalated && update.changes > 0) {
        queueAlertTransition(tx, {
          tenantId,
          alert: {
            ...existing,
            severity: nextSeverity,
            status: 'open',
            sequence: existing.sequence + 1,
            count: entry.count,
          },
          transition: 'escalated',
          occurredAt: nowIso,
        });
        result.escalated += 1;
      }
    }

    for (const alert of activeRows) {
      if (observedAreas.has(alert.area)) continue;
      const update = tx
        .update(operationalAlerts)
        .set({
          status: 'resolved',
          sequence: alert.sequence + 1,
          resolvedAt: nowIso,
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(operationalAlerts.id, alert.id),
            eq(operationalAlerts.tenantId, tenantId),
            eq(operationalAlerts.sequence, alert.sequence),
            isNull(operationalAlerts.resolvedAt)
          )
        )
        .run();
      if (update.changes > 0) {
        queueAlertTransition(tx, {
          tenantId,
          alert: { ...alert, status: 'resolved', sequence: alert.sequence + 1 },
          transition: 'resolved',
          occurredAt: nowIso,
        });
        result.resolved += 1;
      }
    }
  });

  return result;
}

export function acknowledgeOperationalAlert(
  db: DatabaseInstance,
  args: { tenantId: string; userId: string; alertId: string; now?: Date }
): { id: string; status: 'acknowledged'; acknowledgedAt: string; deduped: boolean } {
  const nowIso = (args.now ?? new Date()).toISOString();
  return db.transaction(tx => {
    const alert = tx
      .select()
      .from(operationalAlerts)
      .where(
        and(eq(operationalAlerts.id, args.alertId), eq(operationalAlerts.tenantId, args.tenantId))
      )
      .get();
    if (!alert) throw new Error('OPERATIONAL_ALERT_NOT_FOUND');
    if (alert.status === 'resolved' || alert.resolvedAt) {
      throw new Error('OPERATIONAL_ALERT_RESOLVED');
    }
    if (alert.status === 'acknowledged' && alert.acknowledgedAt) {
      return {
        id: alert.id,
        status: 'acknowledged' as const,
        acknowledgedAt: alert.acknowledgedAt,
        deduped: true,
      };
    }
    const nextSequence = alert.sequence + 1;
    const update = tx
      .update(operationalAlerts)
      .set({
        status: 'acknowledged',
        sequence: nextSequence,
        acknowledgedAt: nowIso,
        acknowledgedByUserId: args.userId,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(operationalAlerts.id, alert.id),
          eq(operationalAlerts.tenantId, args.tenantId),
          eq(operationalAlerts.sequence, alert.sequence),
          ne(operationalAlerts.status, 'resolved'),
          isNull(operationalAlerts.acknowledgedAt)
        )
      )
      .run();
    if (update.changes === 0) throw new Error('OPERATIONAL_ALERT_CHANGED');
    writeAuditLog({
      tx,
      tenantId: args.tenantId,
      actorId: args.userId,
      action: 'operational_alert.acknowledged',
      resourceType: 'operational_alert',
      resourceId: alert.id,
      before: {
        area: alert.area,
        severity: alert.severity,
        status: alert.status,
        count: alert.count,
      },
      after: {
        area: alert.area,
        severity: alert.severity,
        status: 'acknowledged',
        count: alert.count,
      },
    });
    queueAlertTransition(tx, {
      tenantId: args.tenantId,
      alert: { ...alert, status: 'acknowledged', sequence: nextSequence },
      transition: 'acknowledged',
      occurredAt: nowIso,
    });
    return {
      id: alert.id,
      status: 'acknowledged' as const,
      acknowledgedAt: nowIso,
      deduped: false,
    };
  });
}

export function retryOperationalAlertDelivery(
  db: DatabaseInstance,
  args: { tenantId: string; userId: string; deliveryId: string; now?: Date }
): { id: string; status: 'queued' } {
  const delivery = db
    .select()
    .from(operationalAlertDeliveries)
    .where(
      and(
        eq(operationalAlertDeliveries.id, args.deliveryId),
        eq(operationalAlertDeliveries.tenantId, args.tenantId)
      )
    )
    .get();
  if (!delivery) throw new Error('OPERATIONAL_ALERT_DELIVERY_NOT_FOUND');
  if (delivery.status !== 'dead_letter') {
    throw new Error('OPERATIONAL_ALERT_DELIVERY_NOT_DEAD_LETTER');
  }
  const nowIso = (args.now ?? new Date()).toISOString();
  const changed = db.transaction(tx => {
    const update = tx
      .update(operationalAlertDeliveries)
      .set({
        status: 'queued',
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
        responseStatus: null,
        claimToken: null,
        lockedAt: null,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(operationalAlertDeliveries.id, delivery.id),
          eq(operationalAlertDeliveries.tenantId, args.tenantId),
          eq(operationalAlertDeliveries.status, 'dead_letter')
        )
      )
      .run();
    if (update.changes === 0) return false;
    writeAuditLog({
      tx,
      tenantId: args.tenantId,
      actorId: args.userId,
      action: 'operational_alert.delivery.retry',
      resourceType: 'operational_alert_delivery',
      resourceId: delivery.id,
      before: { status: delivery.status, attempts: delivery.attempts },
      after: { status: 'queued', attempts: 0 },
    });
    return true;
  });
  if (!changed) throw new Error('OPERATIONAL_ALERT_DELIVERY_NOT_DEAD_LETTER');
  return { id: delivery.id, status: 'queued' };
}

export function listOperationalAlertsOverview(db: DatabaseInstance, tenantId: string) {
  const subscriptions = db
    .select({
      id: webhookSubscriptions.id,
      name: webhookSubscriptions.name,
      eventTypes: webhookSubscriptions.eventTypes,
      enabled: webhookSubscriptions.enabled,
      revokedAt: webhookSubscriptions.revokedAt,
      createdAt: webhookSubscriptions.createdAt,
      updatedAt: webhookSubscriptions.updatedAt,
    })
    .from(webhookSubscriptions)
    .where(eq(webhookSubscriptions.tenantId, tenantId))
    .orderBy(desc(webhookSubscriptions.updatedAt))
    .all()
    .filter(subscription => subscription.eventTypes.some(isOperationalAlertEventType));

  const alerts = db
    .select({
      id: operationalAlerts.id,
      area: operationalAlerts.area,
      severity: operationalAlerts.severity,
      status: operationalAlerts.status,
      count: operationalAlerts.count,
      firstObservedAt: operationalAlerts.firstObservedAt,
      lastObservedAt: operationalAlerts.lastObservedAt,
      acknowledgedAt: operationalAlerts.acknowledgedAt,
      resolvedAt: operationalAlerts.resolvedAt,
      updatedAt: operationalAlerts.updatedAt,
    })
    .from(operationalAlerts)
    .where(eq(operationalAlerts.tenantId, tenantId))
    .orderBy(desc(operationalAlerts.updatedAt))
    .limit(50)
    .all();

  const deliveries = db
    .select({
      id: operationalAlertDeliveries.id,
      alertId: operationalAlertDeliveries.alertId,
      subscriptionId: operationalAlertDeliveries.subscriptionId,
      subscriptionName: webhookSubscriptions.name,
      transition: operationalAlertDeliveries.transition,
      status: operationalAlertDeliveries.status,
      attempts: operationalAlertDeliveries.attempts,
      responseStatus: operationalAlertDeliveries.responseStatus,
      lastError: operationalAlertDeliveries.lastError,
      deliveredAt: operationalAlertDeliveries.deliveredAt,
      updatedAt: operationalAlertDeliveries.updatedAt,
    })
    .from(operationalAlertDeliveries)
    .innerJoin(
      webhookSubscriptions,
      and(
        eq(webhookSubscriptions.id, operationalAlertDeliveries.subscriptionId),
        eq(webhookSubscriptions.tenantId, operationalAlertDeliveries.tenantId)
      )
    )
    .where(eq(operationalAlertDeliveries.tenantId, tenantId))
    .orderBy(desc(operationalAlertDeliveries.updatedAt))
    .limit(100)
    .all()
    .map(delivery => {
      const { lastError, ...safeDelivery } = delivery;
      return {
        ...safeDelivery,
        lastErrorCode:
          lastError && typeof lastError.errorCode === 'string' ? lastError.errorCode : null,
      };
    });

  const deliveryIds = deliveries.map(delivery => delivery.id);
  const attempts =
    deliveryIds.length === 0
      ? []
      : db
          .select({
            id: operationalAlertDeliveryAttempts.id,
            deliveryId: operationalAlertDeliveryAttempts.deliveryId,
            attemptNumber: operationalAlertDeliveryAttempts.attemptNumber,
            outcome: operationalAlertDeliveryAttempts.outcome,
            responseStatus: operationalAlertDeliveryAttempts.responseStatus,
            errorCode: operationalAlertDeliveryAttempts.errorCode,
            startedAt: operationalAlertDeliveryAttempts.startedAt,
            completedAt: operationalAlertDeliveryAttempts.completedAt,
          })
          .from(operationalAlertDeliveryAttempts)
          .where(
            and(
              eq(operationalAlertDeliveryAttempts.tenantId, tenantId),
              inArray(operationalAlertDeliveryAttempts.deliveryId, deliveryIds)
            )
          )
          .orderBy(desc(operationalAlertDeliveryAttempts.startedAt))
          .limit(200)
          .all();

  return {
    provisioned: subscriptions.some(
      subscription => subscription.enabled && !subscription.revokedAt
    ),
    retention: {
      attemptDays: OPERATIONAL_ALERT_ATTEMPT_RETENTION_DAYS,
      historyDays: OPERATIONAL_ALERT_HISTORY_RETENTION_DAYS,
    },
    subscriptions,
    alerts,
    deliveries,
    attempts,
  };
}

export function pruneOperationalAlertEvidence(
  db: DatabaseInstance,
  tenantId: string,
  now: Date = new Date()
): { attempts: number; alerts: number } {
  const attemptCutoff = new Date(
    now.getTime() - OPERATIONAL_ALERT_ATTEMPT_RETENTION_DAYS * DAY_MS
  ).toISOString();
  const alertCutoff = new Date(
    now.getTime() - OPERATIONAL_ALERT_HISTORY_RETENTION_DAYS * DAY_MS
  ).toISOString();
  const alertsWithRecentAttempts = db
    .selectDistinct({ alertId: operationalAlertDeliveries.alertId })
    .from(operationalAlertDeliveryAttempts)
    .innerJoin(
      operationalAlertDeliveries,
      and(
        eq(operationalAlertDeliveries.id, operationalAlertDeliveryAttempts.deliveryId),
        eq(operationalAlertDeliveries.tenantId, operationalAlertDeliveryAttempts.tenantId)
      )
    )
    .where(
      and(
        eq(operationalAlertDeliveryAttempts.tenantId, tenantId),
        gte(operationalAlertDeliveryAttempts.startedAt, attemptCutoff)
      )
    )
    .all()
    .map(row => row.alertId);
  const attempts = db
    .delete(operationalAlertDeliveryAttempts)
    .where(
      and(
        eq(operationalAlertDeliveryAttempts.tenantId, tenantId),
        lt(operationalAlertDeliveryAttempts.startedAt, attemptCutoff)
      )
    )
    .run().changes;
  const alerts = db
    .delete(operationalAlerts)
    .where(
      and(
        eq(operationalAlerts.tenantId, tenantId),
        eq(operationalAlerts.status, 'resolved'),
        lt(operationalAlerts.resolvedAt, alertCutoff),
        ...(alertsWithRecentAttempts.length > 0
          ? [notInArray(operationalAlerts.id, alertsWithRecentAttempts)]
          : [])
      )
    )
    .run().changes;
  return { attempts, alerts };
}
