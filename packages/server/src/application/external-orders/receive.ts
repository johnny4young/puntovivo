/** Signed ingress is its own durable receipt transaction, not an authenticated cash command. */
import { createHash } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { DatabaseInstance } from '../../db/index.js';
import {
  externalOrderConnectors,
  externalOrders,
  externalOrderEvents,
  externalOrderReceipts,
  externalOrderNonces,
  type ExternalOrderRow,
  type ExternalConnectorRow,
} from '../../db/schema.js';
import {
  externalOrderEventSchema,
  type ExternalOrderEvent,
} from '../../services/external-orders/contract.js';
import { externalOrderError } from '../../services/external-orders/errors.js';
import { openExternalOrderSecret } from '../../services/external-orders/secret-box.js';
import {
  verifyExternalOrderEnvelope,
  EXTERNAL_ORDER_SIGNATURE_WINDOW_MS,
  type ExternalOrderSignedEnvelope,
} from '../../services/external-orders/signature.js';
import { enqueueSyncInTransaction } from '../../services/sync/enqueue.js';
import { assertExternalOrderSite } from './invariants.js';

const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');
function authenticate(
  db: DatabaseInstance,
  input: ExternalOrderSignedEnvelope
): ExternalConnectorRow {
  // This is a credential lookup, before there is an authenticated tenant. No
  // user-supplied tenant/site is accepted; all subsequent data access is scoped.
  const connector = db
    .select()
    .from(externalOrderConnectors)
    .where(eq(externalOrderConnectors.id, input.connectorId))
    .get();
  if (!connector?.enabled || connector.adapter !== 'sandbox_v1') externalOrderError('auth');
  let secret: string;
  try {
    secret = openExternalOrderSecret(connector.sealedSecret, {
      tenantId: connector.tenantId,
      connectorId: connector.id,
    });
  } catch {
    externalOrderError('auth');
  }
  if (!verifyExternalOrderEnvelope(secret, input, Date.now())) externalOrderError('auth');
  return connector;
}
function recordTransition(
  tx: DatabaseInstance,
  connector: ExternalConnectorRow,
  event: ExternalOrderEvent,
  row: ExternalOrderRow,
  before: ExternalOrderRow | null
): void {
  tx.insert(externalOrderEvents)
    .values({
      id: nanoid(),
      tenantId: connector.tenantId,
      siteId: connector.siteId,
      orderId: row.id,
      version: row.version,
      fromStatus: before?.status ?? null,
      toStatus: row.status,
      source: 'connector',
      sourceEventId: event.eventId,
    })
    .run();
  enqueueSyncInTransaction(
    { db: tx, tenantId: connector.tenantId, deviceId: null, envelope: null },
    {
      entityType: 'external_orders',
      entityId: row.id,
      operation: before ? 'update' : 'create',
      data: {
        id: row.id,
        siteId: row.siteId,
        connectorId: row.connectorId,
        status: row.status,
        version: row.version,
      },
    }
  );
}
function applyEvent(
  tx: DatabaseInstance,
  connector: ExternalConnectorRow,
  event: ExternalOrderEvent
): ExternalOrderRow {
  const scope = and(
    eq(externalOrders.tenantId, connector.tenantId),
    eq(externalOrders.connectorId, connector.id),
    eq(externalOrders.externalId, event.orderId)
  );
  const before = tx.select().from(externalOrders).where(scope).get();
  const createHash = event.kind === 'order.created' ? hash(JSON.stringify(event.order)) : null;
  if (before) {
    if (event.kind === 'order.created') {
      // A cancel-before-create tombstone never resurrects, even if delivery is
      // reordered. Conflicting creates on a known order are never silent edits.
      if (before.createHash !== null && before.createHash !== createHash)
        externalOrderError('conflict');
      return before;
    }
    if (before.status !== 'received' && before.status !== 'accepted') return before;
    const row = tx
      .update(externalOrders)
      .set({
        status: before.status === 'accepted' ? 'cancel_requested' : 'cancelled',
        reason: event.reason,
        version: before.version + 1,
        updatedAt: new Date().toISOString(),
      })
      .where(and(scope, eq(externalOrders.version, before.version)))
      .returning()
      .get();
    if (!row) externalOrderError('conflict');
    recordTransition(tx, connector, event, row, before);
    return row;
  }
  const row = tx
    .insert(externalOrders)
    .values({
      id: nanoid(),
      tenantId: connector.tenantId,
      siteId: connector.siteId,
      connectorId: connector.id,
      externalId: event.orderId,
      status: event.kind === 'order.created' ? 'received' : 'cancelled',
      snapshot: event.kind === 'order.created' ? event.order : null,
      createHash,
      reason: event.kind === 'order.cancelled' ? event.reason : null,
    })
    .returning()
    .get();
  recordTransition(tx, connector, event, row, null);
  return row;
}
/** Receipt acknowledgement is immutable across retries, even after later order transitions. */
export function receiveExternalOrder(db: DatabaseInstance, input: ExternalOrderSignedEnvelope) {
  const connector = authenticate(db, input);
  let event: ExternalOrderEvent;
  try {
    event = externalOrderEventSchema.parse(JSON.parse(input.body));
  } catch {
    externalOrderError('invalid');
  }
  const payloadHash = hash(input.body);
  const envelopeHash = hash(JSON.stringify([input.timestamp, input.signature, payloadHash]));
  return db.transaction(
    raw => {
      const tx = raw as unknown as DatabaseInstance;
      const nowMs = Date.now();
      // Re-read credentials and wall time after acquiring the writer. Rotation,
      // disable or expiry while waiting cannot authorize a stale envelope.
      const current = tx
        .select()
        .from(externalOrderConnectors)
        .where(
          and(
            eq(externalOrderConnectors.tenantId, connector.tenantId),
            eq(externalOrderConnectors.id, connector.id)
          )
        )
        .get();
      if (
        !current?.enabled ||
        current.version !== connector.version ||
        Math.abs(nowMs - input.timestamp) > EXTERNAL_ORDER_SIGNATURE_WINDOW_MS
      )
        externalOrderError('auth');
      assertExternalOrderSite(tx, connector.tenantId, connector.siteId);
      const nonceScope = and(
        eq(externalOrderNonces.tenantId, connector.tenantId),
        eq(externalOrderNonces.connectorId, connector.id)
      );
      tx.delete(externalOrderNonces)
        .where(and(nonceScope, lt(externalOrderNonces.expiresAt, nowMs)))
        .run();
      const nonce = tx
        .select()
        .from(externalOrderNonces)
        .where(and(nonceScope, eq(externalOrderNonces.nonce, input.nonce)))
        .get();
      if (nonce && nonce.envelopeHash !== envelopeHash) externalOrderError('conflict');
      const receipt = tx
        .select()
        .from(externalOrderReceipts)
        .where(
          and(
            eq(externalOrderReceipts.tenantId, connector.tenantId),
            eq(externalOrderReceipts.connectorId, connector.id),
            eq(externalOrderReceipts.eventId, event.eventId)
          )
        )
        .get();
      if (receipt && receipt.payloadHash !== payloadHash) externalOrderError('conflict');
      if (nonce && (!receipt || nonce.receiptId !== receipt.id)) externalOrderError('conflict');
      let recorded = receipt;
      if (!recorded) {
        const order = applyEvent(tx, connector, event);
        recorded = tx
          .insert(externalOrderReceipts)
          .values({
            id: nanoid(),
            tenantId: connector.tenantId,
            connectorId: connector.id,
            orderId: order.id,
            eventId: event.eventId,
            payloadHash,
            kind: event.kind,
            resultStatus: order.status,
            resultVersion: order.version,
          })
          .returning()
          .get();
      }
      if (!nonce)
        tx.insert(externalOrderNonces)
          .values({
            id: nanoid(),
            tenantId: connector.tenantId,
            connectorId: connector.id,
            nonce: input.nonce,
            envelopeHash,
            receiptId: recorded.id,
            expiresAt: input.timestamp + EXTERNAL_ORDER_SIGNATURE_WINDOW_MS,
          })
          .run();
      return {
        eventId: event.eventId,
        orderId: event.orderId,
        status: recorded.resultStatus,
        version: recorded.resultVersion,
      };
    },
    { behavior: 'immediate' }
  );
}
