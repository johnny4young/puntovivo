import { useEffect, useRef } from 'react';
import type { SaleCartItem, SaleCartSummary } from '@/features/sales/saleCart';
import {
  buildCustomerDisplayProjection,
  customerDisplayScopeEquals,
  CustomerDisplayBus,
  CUSTOMER_DISPLAY_HEARTBEAT_MS,
  type CustomerDisplayScope,
} from './customerDisplayProjection';

/** Current cashier-side state allowed to be projected onto the customer display. */
export interface CustomerDisplayPublisherInput extends CustomerDisplayScope {
  registerName: string;
  currency: string;
  items: SaleCartItem[];
  summary: SaleCartSummary;
  priceIncludesTax: boolean;
}

/**
 * Mirrors the active cart to same-origin display windows and retires it when
 * the module, site, cash session, route or authenticated identity disappears.
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
        })
      );
    };
    const unsubscribe = bus.subscribe(message => {
      if (
        (message.kind === 'request-access' && message.accessId === scope.accessId) ||
        (message.kind === 'request' && customerDisplayScopeEquals(message.scope, scope))
      ) {
        publish();
      }
    });
    publishLatest.current = publish;
    publish();
    const heartbeat = window.setInterval(publish, CUSTOMER_DISPLAY_HEARTBEAT_MS);

    return () => {
      if (publishLatest.current === publish) publishLatest.current = null;
      window.clearInterval(heartbeat);
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
  ]);
}
