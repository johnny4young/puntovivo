import { useEffect, useRef } from 'react';
import type { SaleCartItem, SaleCartSummary } from '@/features/sales/saleCart';
import {
  buildCustomerDisplayProjection,
  customerDisplayScopeEquals,
  CustomerDisplayBus,
  CUSTOMER_DISPLAY_HEARTBEAT_MS,
  CUSTOMER_DISPLAY_STALE_AFTER_MS,
  type CustomerDisplayScope,
  type CustomerDisplayTransfer,
} from './customerDisplayProjection';

/** Current cashier-side state allowed to be projected onto the customer display. */
export interface CustomerDisplayPublisherInput extends CustomerDisplayScope {
  registerName: string;
  currency: string;
  items: SaleCartItem[];
  summary: SaleCartSummary;
  priceIncludesTax: boolean;
  transfer?: CustomerDisplayTransfer | null | undefined;
}

const ACTIVE_LISTENER_LEASE_MS = CUSTOMER_DISPLAY_STALE_AFTER_MS * 2;

/**
 * Mirrors the active cart to same-origin display windows and retires it when
 * the module, site, cash session, route or authenticated identity disappears.
 * Heartbeats run only while a paired display window has recently requested updates.
 */
export function useCustomerDisplayPublisher(input: CustomerDisplayPublisherInput | null): void {
  const latest = useRef<CustomerDisplayPublisherInput | null>(null);
  const publishLatest = useRef<(() => void) | null>(null);
  const accessId = input?.accessId ?? null;
  const tenantId = input?.tenantId ?? null;
  const siteId = input?.siteId ?? null;
  const cashSessionId = input?.cashSessionId ?? null;
  const registerName = input?.registerName ?? null;
  const currency = input?.currency ?? null;
  const items = input?.items ?? null;
  const summary = input?.summary ?? null;
  const priceIncludesTax = input?.priceIncludesTax ?? null;
  const transfer = input?.transfer ?? null;

  useEffect(() => {
    if (!accessId || !tenantId || !siteId || !cashSessionId) return;

    const scope: CustomerDisplayScope = {
      accessId,
      tenantId,
      siteId,
      cashSessionId,
    };
    const bus = new CustomerDisplayBus();
    let revision = 0;
    let heartbeatId: number | null = null;
    let listenerLeaseUntil = 0;

    const stopHeartbeat = () => {
      if (heartbeatId !== null) {
        window.clearInterval(heartbeatId);
        heartbeatId = null;
      }
    };

    const publish = () => {
      const current = latest.current;
      if (!current || !customerDisplayScopeEquals(current, scope)) return;
      revision = Math.max(revision + 1, Date.now());
      bus.publish(
        buildCustomerDisplayProjection({
          scope,
          revision,
          publishedAt: new Date().toISOString(),
          registerName: current.registerName,
          currency: current.currency,
          items: current.items,
          summary: current.summary,
          priceIncludesTax: current.priceIncludesTax,
          transfer: current.transfer,
        })
      );
    };

    const renewListenerHeartbeat = () => {
      listenerLeaseUntil = Date.now() + ACTIVE_LISTENER_LEASE_MS;
      if (heartbeatId !== null) return;
      heartbeatId = window.setInterval(() => {
        if (Date.now() > listenerLeaseUntil) {
          stopHeartbeat();
          return;
        }
        publish();
      }, CUSTOMER_DISPLAY_HEARTBEAT_MS);
    };

    const unsubscribe = bus.subscribe(message => {
      if (
        (message.kind === 'request-access' && message.accessId === scope.accessId) ||
        (message.kind === 'request' && customerDisplayScopeEquals(message.scope, scope))
      ) {
        renewListenerHeartbeat();
        publish();
      }
    });
    publishLatest.current = publish;
    publish();

    return () => {
      if (publishLatest.current === publish) publishLatest.current = null;
      stopHeartbeat();
      unsubscribe();
      bus.clear(scope);
      bus.close();
    };
  }, [accessId, cashSessionId, siteId, tenantId]);

  useEffect(() => {
    if (
      !accessId ||
      !tenantId ||
      !siteId ||
      !cashSessionId ||
      registerName === null ||
      currency === null ||
      items === null ||
      summary === null ||
      priceIncludesTax === null
    ) {
      latest.current = null;
      return;
    }
    latest.current = {
      accessId,
      tenantId,
      siteId,
      cashSessionId,
      registerName,
      currency,
      items,
      summary,
      priceIncludesTax,
      transfer,
    };
    publishLatest.current?.();
  }, [
    accessId,
    cashSessionId,
    currency,
    items,
    priceIncludesTax,
    registerName,
    siteId,
    summary,
    tenantId,
    transfer,
  ]);
}
