import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { auditLogs, sites, users } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../audit-logs.js';
import {
  LOSS_PREVENTION_ALERT_CHANNELS,
  resolveLossPreventionSettings,
  type LossPreventionAlertChannel,
} from './settings.js';

export const LOSS_PREVENTION_ALERT_KINDS = [
  'max_discount',
  'after_hours_sale',
  'shift_refund_limit',
  'shift_void_limit',
  'no_sale_limit',
  'dual_approval_threshold',
] as const;
export type LossPreventionAlertKind = (typeof LOSS_PREVENTION_ALERT_KINDS)[number];

export const LOSS_PREVENTION_ALERT_ACTIONS = [
  'sale_discount',
  'sale_after_hours',
  'sale_refund',
  'sale_void',
  'cash_drawer_open',
] as const;
export type LossPreventionAlertAction = (typeof LOSS_PREVENTION_ALERT_ACTIONS)[number];

export interface LossPreventionAlertItem {
  id: string;
  kind: LossPreventionAlertKind;
  action: LossPreventionAlertAction;
  approvalProvided: boolean;
  actorId: string;
  actorName: string | null;
  actorRole: string;
  siteId: string;
  siteName: string | null;
  occurredAt: string;
  channels: LossPreventionAlertChannel[];
  acknowledgedAt: string | null;
  acknowledgedById: string | null;
  acknowledgedByName: string | null;
}

function isAlertKind(value: unknown): value is LossPreventionAlertKind {
  return (
    typeof value === 'string' && (LOSS_PREVENTION_ALERT_KINDS as readonly string[]).includes(value)
  );
}

function isAlertAction(value: unknown): value is LossPreventionAlertAction {
  return (
    typeof value === 'string' &&
    (LOSS_PREVENTION_ALERT_ACTIONS as readonly string[]).includes(value)
  );
}

function parseChannels(value: unknown): LossPreventionAlertChannel[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (channel): channel is LossPreventionAlertChannel =>
      typeof channel === 'string' &&
      (LOSS_PREVENTION_ALERT_CHANNELS as readonly string[]).includes(channel)
  );
}

const inAppAlertCondition = sql`exists (
  select 1
  from json_each(${auditLogs.after}, '$.alertChannels') as alert_channel
  where alert_channel.value = 'in_app'
)`;

function alertSiteCondition(siteId: string) {
  return sql`json_extract(${auditLogs.metadata}, '$.siteId') = ${siteId}`;
}

function alertAcknowledgedCondition(tenantId: string) {
  return sql`exists (
    select 1
    from audit_logs as acknowledgement
    where acknowledgement.tenant_id = ${tenantId}
      and acknowledgement.action = 'loss_prevention.alert.acknowledged'
      and acknowledgement.resource_id = ${auditLogs.id}
  )`;
}

/** ENG-142d — project immutable trigger evidence into the manager notification center. */
export function listLossPreventionAlerts(args: {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  limit: number;
}): {
  items: LossPreventionAlertItem[];
  unacknowledgedCount: number;
  whatsappHandoff: { enabled: boolean; recipientPhone: string };
} {
  const triggerConditions = and(
    eq(auditLogs.tenantId, args.tenantId),
    eq(auditLogs.action, 'loss_prevention.triggered'),
    alertSiteCondition(args.siteId),
    inAppAlertCondition
  );
  const rawTriggers = args.db
    .select({
      id: auditLogs.id,
      actorId: auditLogs.actorId,
      actorName: users.name,
      siteName: sites.name,
      after: auditLogs.after,
      metadata: auditLogs.metadata,
      createdAt: auditLogs.createdAt,
    })
    .from(auditLogs)
    .leftJoin(users, and(eq(users.id, auditLogs.actorId), eq(users.tenantId, args.tenantId)))
    .leftJoin(
      sites,
      and(
        eq(sites.tenantId, args.tenantId),
        sql`${sites.id} = json_extract(${auditLogs.metadata}, '$.siteId')`
      )
    )
    .where(triggerConditions)
    // Pending review must never be starved by newer reviewed history when the
    // feed reaches its limit. Keep all unacknowledged rows first, then show the
    // most recent reviewed evidence in the remaining slots.
    .orderBy(
      asc(sql`case when ${alertAcknowledgedCondition(args.tenantId)} then 1 else 0 end`),
      desc(auditLogs.createdAt),
      desc(auditLogs.id)
    )
    .limit(Math.max(1, Math.min(args.limit, 50)))
    .all();

  const triggerIds = rawTriggers.map(row => row.id);
  const acknowledgements =
    triggerIds.length === 0
      ? []
      : args.db
          .select({
            alertId: auditLogs.resourceId,
            actorId: auditLogs.actorId,
            actorName: users.name,
            createdAt: auditLogs.createdAt,
          })
          .from(auditLogs)
          .leftJoin(users, and(eq(users.id, auditLogs.actorId), eq(users.tenantId, args.tenantId)))
          .where(
            and(
              eq(auditLogs.tenantId, args.tenantId),
              eq(auditLogs.action, 'loss_prevention.alert.acknowledged'),
              inArray(auditLogs.resourceId, triggerIds)
            )
          )
          .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id))
          .all();
  const acknowledgementByAlert = new Map<string, (typeof acknowledgements)[number]>();
  for (const acknowledgement of acknowledgements) {
    if (!acknowledgementByAlert.has(acknowledgement.alertId)) {
      acknowledgementByAlert.set(acknowledgement.alertId, acknowledgement);
    }
  }

  const items: LossPreventionAlertItem[] = [];
  for (const row of rawTriggers) {
    const metadata = row.metadata ?? {};
    const after = row.after ?? {};
    const kind = metadata.kind;
    const action = after.requiredAction;
    const siteId = metadata.siteId;
    if (!isAlertKind(kind) || !isAlertAction(action) || siteId !== args.siteId) continue;
    const acknowledgement = acknowledgementByAlert.get(row.id);
    items.push({
      id: row.id,
      kind,
      action,
      approvalProvided: after.approvalProvided === true,
      actorId: row.actorId,
      actorName: row.actorName ?? null,
      actorRole: typeof metadata.role === 'string' ? metadata.role : 'unknown',
      siteId,
      siteName: row.siteName ?? null,
      occurredAt: row.createdAt,
      channels: parseChannels(after.alertChannels),
      acknowledgedAt: acknowledgement?.createdAt ?? null,
      acknowledgedById: acknowledgement?.actorId ?? null,
      acknowledgedByName: acknowledgement?.actorName ?? null,
    });
  }

  const unread = args.db
    .select({ total: sql<number>`count(*)`.mapWith(Number) })
    .from(auditLogs)
    .where(and(triggerConditions, sql`not ${alertAcknowledgedCondition(args.tenantId)}`))
    .get();
  const configuredHandoff = resolveLossPreventionSettings(args.db, args.tenantId).alerts
    .whatsappHandoff;
  const whatsappHandoff = configuredHandoff.enabled
    ? { ...configuredHandoff }
    : { enabled: false, recipientPhone: '' };

  return {
    items,
    unacknowledgedCount: unread?.total ?? 0,
    whatsappHandoff,
  };
}

/** Shared acknowledgement: the first manager review clears the alert for every manager. */
export function acknowledgeLossPreventionAlert(args: {
  db: DatabaseInstance;
  tenantId: string;
  siteId: string;
  alertId: string;
  actorId: string;
  operationId?: string | null | undefined;
}): { alertId: string; acknowledged: true; alreadyAcknowledged: boolean } {
  return args.db.transaction(tx => {
    const trigger = tx
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.id, args.alertId),
          eq(auditLogs.tenantId, args.tenantId),
          eq(auditLogs.action, 'loss_prevention.triggered'),
          alertSiteCondition(args.siteId),
          inAppAlertCondition
        )
      )
      .get();
    if (!trigger) {
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'LOSS_PREVENTION_ALERT_NOT_FOUND',
        message: 'Loss-prevention alert not found',
      });
    }

    const existing = tx
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(
        and(
          eq(auditLogs.tenantId, args.tenantId),
          eq(auditLogs.action, 'loss_prevention.alert.acknowledged'),
          eq(auditLogs.resourceId, args.alertId)
        )
      )
      .get();
    if (existing) {
      return { alertId: args.alertId, acknowledged: true as const, alreadyAcknowledged: true };
    }

    writeAuditLog({
      tx,
      tenantId: args.tenantId,
      actorId: args.actorId,
      action: 'loss_prevention.alert.acknowledged',
      resourceType: 'loss_prevention_alert',
      resourceId: args.alertId,
      after: { status: 'acknowledged' },
      metadata: { siteId: args.siteId },
      operationId: args.operationId,
    });
    return { alertId: args.alertId, acknowledged: true as const, alreadyAcknowledged: false };
  });
}
