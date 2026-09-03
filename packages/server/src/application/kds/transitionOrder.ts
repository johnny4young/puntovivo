/** Kitchen state, event, audit and invalidation are one synchronous write. */
import type { DatabaseInstance } from '../../db/index.js';
import { type KdsOrderRow, type KdsOrderLineRow } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { writeAuditLog } from '../../services/audit-logs.js';
import { isKdsActive, requireKdsSite, requireKitchenOrder, type KdsWriteScope } from './common.js';
import { appendKitchenEvent } from './events.js';
import { adoptLegacyKitchenOrder } from './legacy.js';
import { projectKitchenOrders } from './read.js';
import { kitchenOrderState, loadKitchenOrderLines, updateKitchenLine } from './line-state.js';

/** Authenticated actor and active kitchen scope; never supplied by a card payload. */
export interface KdsTransitionContext {
  db: DatabaseInstance;
  tenantId: string;
  actorId: string;
  siteId: string | null;
}
/** Persisted result; no caller-synthesized timestamp or cook identity. */
export interface KdsTransitionResult {
  row: KdsOrderRow;
  changed: boolean;
}
/** A client-observed generation is mandatory to prevent ready/recall/ready ABA. */
function requireVersion(actual: number, expected: number): void {
  if (actual !== expected) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STALE_VERSION',
      message: 'Kitchen work changed; refresh before applying the action',
    });
  }
}

/** One writer for both legacy adoption and current line/ticket transitions. */
function withKitchenOrder<T>(
  context: KdsTransitionContext,
  id: string,
  action: (tx: DatabaseInstance, scope: KdsWriteScope, order: KdsOrderRow) => T
): T {
  return context.db.transaction(
    rawTx => {
      const tx = rawTx as unknown as DatabaseInstance;
      if (!isKdsActive(tx, context.tenantId)) {
        throwServerError({
          trpcCode: 'FORBIDDEN',
          errorCode: 'MODULE_NOT_ACTIVATED',
          message: 'Kitchen display is not active for this tenant',
          details: { moduleId: 'kds' },
        });
      }
      const scope = {
        tenantId: context.tenantId,
        actorId: context.actorId,
        siteId: requireKdsSite(tx, context.tenantId, context.siteId),
      };
      const order = adoptLegacyKitchenOrder(tx, requireKitchenOrder(tx, scope, id));
      if (
        projectKitchenOrders(tx, scope.tenantId, scope.siteId, [order])[0]?.integrity !== 'valid'
      ) {
        throwServerError({
          trpcCode: 'CONFLICT',
          errorCode: 'KDS_SNAPSHOT_INVALID',
          message: 'Kitchen preparation cannot be verified',
        });
      }
      return action(tx, scope, order);
    },
    { behavior: 'immediate' }
  );
}

/** Terminal voids never become preparation again; recalling is only valid from ready. */
function transitionLine(
  tx: DatabaseInstance,
  scope: KdsWriteScope,
  line: KdsOrderLineRow,
  target: 'pending' | 'preparing' | 'ready'
): KdsOrderLineRow {
  if (
    line.status === 'voided' ||
    (target === 'pending' && line.status !== 'ready') ||
    (target === 'preparing' && line.status !== 'pending')
  ) {
    throwServerError({
      trpcCode: 'BAD_REQUEST',
      errorCode: 'KDS_LINE_STATE_INVALID',
      message: 'Kitchen line cannot enter the requested state',
    });
  }
  return updateKitchenLine(tx, line, {
    status: target,
    readyAt: target === 'ready' ? new Date().toISOString() : null,
    readyByUserId: target === 'ready' ? scope.actorId : null,
  });
}

/** Finish an observed whole ticket; cancelled lines stay voided and immutable. */
export function transitionKdsOrder(
  context: KdsTransitionContext,
  id: string,
  target: 'pending' | 'ready',
  expectedVersion: number
): KdsTransitionResult {
  return withKitchenOrder(context, id, (tx, scope, order) => {
    requireVersion(order.version, expectedVersion);
    if (order.status === 'cancelled') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'KDS_LINE_STATE_INVALID',
        message: 'Cancelled kitchen tickets cannot be prepared',
      });
    }
    if (target === 'ready' && order.status === 'ready') return { row: order, changed: false };
    if (target === 'pending' && order.status !== 'ready') {
      throwServerError({
        trpcCode: 'BAD_REQUEST',
        errorCode: 'KDS_ORDER_NOT_READY',
        message: 'Only ready cards can be recalled',
      });
    }
    const lines = loadKitchenOrderLines(tx, order);
    const next = lines.map(line =>
      line.status === 'voided' || line.status === target
        ? line
        : transitionLine(tx, scope, line, target)
    );
    const row = appendKitchenEvent(
      tx,
      order,
      {
        kind: target === 'ready' ? 'ready' : 'recalled',
        actorId: scope.actorId,
        facts: {
          lineIds: next.filter(line => line.status !== 'voided').map(line => line.id),
          fromVersion: expectedVersion,
        },
      },
      kitchenOrderState(next, scope.actorId)
    );
    auditTransition(tx, scope, order, row, target === 'ready' ? 'ready' : 'recalled');
    return { row, changed: true };
  });
}

/** Advance one observed preparation line without requiring unrelated lines to stand still. */
export function transitionKdsLine(
  context: KdsTransitionContext,
  input: {
    orderId: string;
    lineId: string;
    expectedVersion: number;
    status: 'pending' | 'preparing' | 'ready';
  }
): KdsTransitionResult {
  return withKitchenOrder(context, input.orderId, (tx, scope, order) => {
    const lines = loadKitchenOrderLines(tx, order);
    const line = lines.find(candidate => candidate.id === input.lineId);
    if (!line)
      throwServerError({
        trpcCode: 'NOT_FOUND',
        errorCode: 'KDS_LINE_NOT_FOUND',
        message: 'Kitchen line not found',
      });
    requireVersion(line.version, input.expectedVersion);
    if (line.status === input.status) return { row: order, changed: false };
    const nextLine = transitionLine(tx, scope, line, input.status);
    const next = lines.map(candidate => (candidate.id === line.id ? nextLine : candidate));
    const kind = input.status === 'pending' ? 'recalled' : input.status;
    const row = appendKitchenEvent(
      tx,
      order,
      { kind, actorId: scope.actorId, facts: { lineIds: [line.id], fromVersion: line.version } },
      kitchenOrderState(next, scope.actorId)
    );
    auditTransition(tx, scope, order, row, kind);
    return { row, changed: true };
  });
}

/** Resend is another invalidation of the SAME ticket, never a new cooking instruction. */
export function resendKdsOrder(
  context: KdsTransitionContext,
  id: string,
  expectedVersion: number
): KdsTransitionResult {
  return withKitchenOrder(context, id, (tx, scope, order) => {
    requireVersion(order.version, expectedVersion);
    const row = appendKitchenEvent(tx, order, {
      kind: 'resent',
      actorId: scope.actorId,
      facts: { fromVersion: expectedVersion },
    });
    auditTransition(tx, scope, order, row, 'resent');
    return { row, changed: true };
  });
}

function auditTransition(
  tx: DatabaseInstance,
  scope: KdsWriteScope,
  before: KdsOrderRow,
  after: KdsOrderRow,
  action: 'ready' | 'recalled' | 'preparing' | 'resent'
): void {
  writeAuditLog({
    tx,
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    action: `kds.order.${action}`,
    resourceType: 'kds_order',
    resourceId: before.id,
    before: {
      status: before.status,
      version: before.version,
      readyAt: before.readyAt,
      readyByUserId: before.readyByUserId,
    },
    after: {
      status: after.status,
      version: after.version,
      readyAt: after.readyAt,
      readyByUserId: after.readyByUserId,
    },
    metadata: { siteId: before.siteId, station: before.station },
  });
}
