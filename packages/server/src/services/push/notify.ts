/**
 * Owner push dispatch. Runs after the business write commits and never
 * blocks it: an offline store, a slow push service or a bad endpoint only
 * cost a log line.
 *
 * @module services/push/notify
 */
import type { UserRole } from '@puntovivo/shared/roles';
import { and, eq, inArray, lte, ne } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import {
  managerApprovalRequests,
  pushSubscriptions,
  sites,
  users,
  type ManagerApprovalAction,
  type PushLanguage,
} from '../../db/schema.js';
import { createModuleLogger } from '../../logging/logger.js';
import {
  assertPublicWebhookDestination,
  resolvePublicWebhookDestination,
  type WebhookAddressResolver,
} from '../events/destination-policy.js';
import { postPinnedWebhook, type WebhookTransport } from '../events/webhook-http.js';
import { canRoleApproveAction } from '../manager-approvals.js';
import { isModuleActiveForTenant } from '../../trpc/middleware/modules.js';
import { getDayCloseSignoff } from '../reports/day-close-signoff.js';
import { resolveTenantLocale } from '../tenant-locale.js';
import { getOrCreateVapidKeys, hasWebPushKey, openSubscriptionKeys } from './key-store.js';
import { renderOwnerPush, type OwnerPushMessage, type PushFormat } from './messages.js';
import { encryptPushPayload, vapidAuthorization } from './web-push.js';

const log = createModuleLogger('owner-push');

const OWNER_PUSH_URL = '/c/';
const VAPID_SUBJECT = 'https://puntovivo.app';
const DELIVERY_TIMEOUT_MS = 10_000;

export interface HandoffPushFacts {
  id: string;
  registerName: string;
  fromCashierName: string;
  toCashierName: string | null;
  outgoingCount: number;
  receivedCount: number | null;
}

export type OwnerPushEvent =
  | { kind: 'approval_waiting'; tenantId: string; actorId: string; requestId: string }
  | { kind: 'handoff_done'; tenantId: string; actorId: string; handoff: HandoffPushFacts }
  | { kind: 'day_sealed'; tenantId: string; actorId: string; date: string }
  | { kind: 'enabled'; tenantId: string; userId: string; endpoint: string };

export interface OwnerPushResult {
  sent: number;
  removed: number;
  failed: number;
}

interface Prepared {
  message: OwnerPushMessage;
  tag: string;
  ttlSeconds: number;
  urgency: 'high' | 'normal';
  recipients: (role: UserRole) => boolean;
  excludeUserId: string | null;
}

let transport: WebhookTransport<Buffer> = postPinnedWebhook;
let resolver: WebhookAddressResolver | undefined;
let shutdown = new AbortController();
const inFlight = new Set<Promise<unknown>>();

/** Test seam for the HTTPS transport and DNS resolver. */
export function configureOwnerPushDelivery(
  overrides: { transport?: WebhookTransport<Buffer>; resolver?: WebhookAddressResolver } = {}
): void {
  transport = overrides.transport ?? postPinnedWebhook;
  resolver = overrides.resolver;
}

/** The rule the sender applies later: a public HTTPS host on the default port. */
export function assertOwnerPushEndpoint(endpoint: string): Promise<URL> {
  return assertPublicWebhookDestination(endpoint, resolver);
}

const isManagerOrAdmin = (role: UserRole) => role === 'admin' || role === 'manager';

function prepare(db: DatabaseInstance, event: OwnerPushEvent, currency: string): Prepared | null {
  switch (event.kind) {
    case 'approval_waiting': {
      const row = db
        .select({
          action: managerApprovalRequests.action,
          status: managerApprovalRequests.status,
          summary: managerApprovalRequests.summary,
          requesterName: users.name,
          siteName: sites.name,
        })
        .from(managerApprovalRequests)
        .innerJoin(users, eq(users.id, managerApprovalRequests.requesterId))
        .innerJoin(sites, eq(sites.id, managerApprovalRequests.siteId))
        .where(
          and(
            eq(managerApprovalRequests.id, event.requestId),
            eq(managerApprovalRequests.tenantId, event.tenantId)
          )
        )
        .get();
      if (!row || row.status !== 'pending') return null;
      const action: ManagerApprovalAction = row.action;
      return {
        message: {
          kind: 'approval_waiting',
          action,
          requesterName: row.requesterName,
          siteName: row.siteName,
          amount: typeof row.summary.amount === 'number' ? row.summary.amount : null,
          currencyCode: row.summary.currencyCode ?? null,
        },
        tag: `approval:${event.requestId}`,
        // The request itself expires after ten minutes.
        ttlSeconds: 600,
        urgency: 'high',
        recipients: role => canRoleApproveAction(role, action),
        excludeUserId: event.actorId,
      };
    }
    case 'handoff_done':
      return {
        message: {
          kind: 'handoff_done',
          registerName: event.handoff.registerName,
          fromName: event.handoff.fromCashierName,
          toName: event.handoff.toCashierName ?? '',
          outgoingCount: event.handoff.outgoingCount,
          receivedCount: event.handoff.receivedCount,
          currencyCode: currency,
        },
        tag: `handoff:${event.handoff.id}`,
        ttlSeconds: 12 * 60 * 60,
        urgency: 'normal',
        recipients: isManagerOrAdmin,
        excludeUserId: event.actorId,
      };
    case 'day_sealed': {
      const signoff = getDayCloseSignoff(db, event.tenantId, event.date);
      if (!signoff) return null;
      return {
        message: {
          kind: 'day_sealed',
          date: event.date,
          signerName: signoff.signedBy.name,
          netRevenue: signoff.report.sales.netRevenue,
          salesCount: signoff.report.sales.count,
          currencyCode: signoff.currencyCode,
        },
        tag: `day:${event.date}`,
        ttlSeconds: 24 * 60 * 60,
        urgency: 'normal',
        recipients: isManagerOrAdmin,
        excludeUserId: event.actorId,
      };
    }
    case 'enabled':
      return {
        message: { kind: 'enabled' },
        tag: 'enabled',
        ttlSeconds: 60 * 60,
        urgency: 'normal',
        recipients: isManagerOrAdmin,
        excludeUserId: null,
      };
  }
}

function loadSubscriptions(db: DatabaseInstance, event: OwnerPushEvent, prepared: Prepared) {
  const conditions = [
    eq(pushSubscriptions.tenantId, event.tenantId),
    eq(users.tenantId, event.tenantId),
    eq(users.isActive, true),
  ];
  if (event.kind === 'enabled') {
    conditions.push(
      eq(pushSubscriptions.userId, event.userId),
      eq(pushSubscriptions.endpoint, event.endpoint)
    );
  }
  if (prepared.excludeUserId) conditions.push(ne(pushSubscriptions.userId, prepared.excludeUserId));
  return db
    .select({
      id: pushSubscriptions.id,
      endpoint: pushSubscriptions.endpoint,
      sealedKeys: pushSubscriptions.sealedKeys,
      language: pushSubscriptions.language,
      role: users.role,
    })
    .from(pushSubscriptions)
    .innerJoin(users, eq(users.id, pushSubscriptions.userId))
    .where(and(...conditions))
    .all()
    .filter(row => prepared.recipients(row.role));
}

/** Send one event to every opted-in recipient. Never throws for delivery failures. */
export async function deliverOwnerPush(
  db: DatabaseInstance,
  event: OwnerPushEvent,
  signal: AbortSignal = shutdown.signal
): Promise<OwnerPushResult> {
  const result: OwnerPushResult = { sent: 0, removed: 0, failed: 0 };
  if (!hasWebPushKey() || !(await isModuleActiveForTenant(db, event.tenantId, 'companion'))) {
    return result;
  }
  const locale = await resolveTenantLocale(db, event.tenantId);
  const prepared = prepare(db, event, locale.currency);
  if (!prepared) return result;
  const subscriptions = loadSubscriptions(db, event, prepared);
  if (subscriptions.length === 0) return result;

  const vapid = getOrCreateVapidKeys(db);
  if (!vapid) return result;
  const format: PushFormat = { locale: locale.locale, displayDecimals: locale.displayDecimals };

  const startedAt = new Date().toISOString();
  // The token depends only on the push service origin, so phones on one service share it.
  const authorizations = new Map<string, string>();
  const authorizationFor = (url: URL) => {
    let header = authorizations.get(url.origin);
    if (!header) {
      header = vapidAuthorization(url, vapid, VAPID_SUBJECT);
      authorizations.set(url.origin, header);
    }
    return header;
  };
  const gone: string[] = [];
  const rendered = new Map<PushLanguage, Buffer>();
  const payloadFor = (language: PushLanguage) => {
    let payload = rendered.get(language);
    if (!payload) {
      const text = renderOwnerPush(prepared.message, language, format);
      payload = Buffer.from(JSON.stringify({ ...text, tag: prepared.tag, url: OWNER_PUSH_URL }));
      rendered.set(language, payload);
    }
    return payload;
  };

  await Promise.all(
    subscriptions.map(async subscription => {
      let keys;
      try {
        keys = openSubscriptionKeys(subscription.endpoint, subscription.sealedKeys);
      } catch {
        // Sealed under a previous database key: the browser must subscribe again.
        gone.push(subscription.id);
        return;
      }
      try {
        const { url, addresses } = await resolvePublicWebhookDestination(
          subscription.endpoint,
          resolver
        );
        const response = await transport({
          url,
          pinnedAddress: addresses[0]!,
          headers: {
            authorization: authorizationFor(url),
            'content-encoding': 'aes128gcm',
            'content-type': 'application/octet-stream',
            ttl: String(prepared.ttlSeconds),
            urgency: prepared.urgency,
          },
          body: encryptPushPayload(payloadFor(subscription.language), keys),
          timeoutMs: DELIVERY_TIMEOUT_MS,
          signal,
        });
        if (response.status === 404 || response.status === 410) {
          gone.push(subscription.id);
        } else if (response.status >= 200 && response.status < 300) {
          result.sent += 1;
        } else {
          result.failed += 1;
          log.warn({ status: response.status, kind: event.kind }, 'push service refused a message');
        }
      } catch (error) {
        result.failed += 1;
        log.warn(
          { err: error instanceof Error ? error.message : String(error), kind: event.kind },
          'push delivery failed (non-blocking)'
        );
      }
    })
  );

  if (gone.length > 0) {
    db.delete(pushSubscriptions)
      .where(
        and(
          eq(pushSubscriptions.tenantId, event.tenantId),
          inArray(pushSubscriptions.id, gone),
          // A phone that re-subscribed while this send was in flight stays.
          lte(pushSubscriptions.updatedAt, startedAt)
        )
      )
      .run();
    result.removed = gone.length;
  }
  return result;
}

/** Fire and forget from a procedure, after its write committed. */
export function dispatchOwnerPush(db: DatabaseInstance, event: OwnerPushEvent): void {
  if (!hasWebPushKey()) return;
  const delivery = deliverOwnerPush(db, event)
    .catch(error => {
      log.warn(
        { err: error instanceof Error ? error.message : String(error), kind: event.kind },
        'push dispatch failed (non-blocking)'
      );
    })
    .finally(() => inFlight.delete(delivery));
  inFlight.add(delivery);
}

/** Wait for dispatched deliveries; tests use it to observe fire-and-forget sends. */
export async function settleOwnerPush(): Promise<void> {
  while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
}

/** Abort open requests and wait for them, before the database closes. */
export async function stopOwnerPush(): Promise<void> {
  shutdown.abort();
  await settleOwnerPush();
  shutdown = new AbortController();
}
