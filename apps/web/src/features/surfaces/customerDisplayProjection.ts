import type { SaleCartItem, SaleCartSummary } from '@/features/sales/saleCart';
import { getLineTotals } from '@/features/sales/saleCartTotals';
import { roundMoney } from '@/lib/money';
import {
  CUSTOMER_DISPLAY_CHANNEL_NAME,
  CUSTOMER_DISPLAY_STORAGE_PREFIX,
  isCustomerDisplayAccessId,
} from './customerDisplayStorage';

export {
  clearAllCustomerDisplayProjections,
  CUSTOMER_DISPLAY_CHANNEL_NAME,
  CUSTOMER_DISPLAY_STORAGE_PREFIX,
  getOrCreateCustomerDisplayAccessId,
  isCustomerDisplayAccessId,
} from './customerDisplayStorage';

export const CUSTOMER_DISPLAY_SCHEMA_VERSION = 1 as const;
export const CUSTOMER_DISPLAY_HEARTBEAT_MS = 3_000;
export const CUSTOMER_DISPLAY_STALE_AFTER_MS = 10_000;
export const CUSTOMER_DISPLAY_MAX_FUTURE_SKEW_MS = 5_000;
export const CUSTOMER_DISPLAY_MAX_LINES = 200;

/** Tenant/site/register identity that a display may subscribe to. */
export interface CustomerDisplayScope {
  accessId: string;
  tenantId: string;
  siteId: string;
  cashSessionId: string;
}

/** One deliberately minimal, customer-safe line. It never contains customer, employee or note data. */
export interface CustomerDisplayLine {
  name: string;
  unitName: string;
  quantity: number;
  unitPrice: number;
  discountPercent: number;
  total: number;
}

/**
 * Versioned local projection mirrored from the active register to a customer-facing display.
 * The projection is advisory UI state only: the sale and its totals remain server-authoritative.
 */
export interface CustomerDisplayProjection extends CustomerDisplayScope {
  schemaVersion: typeof CUSTOMER_DISPLAY_SCHEMA_VERSION;
  revision: number;
  publishedAt: string;
  registerName: string;
  currency: string;
  items: CustomerDisplayLine[];
  summary: SaleCartSummary;
}

/** Messages accepted on the same-origin display channel. Unknown shapes are ignored. */
export type CustomerDisplayMessage =
  | { kind: 'projection'; projection: CustomerDisplayProjection }
  | { kind: 'clear'; scope: CustomerDisplayScope }
  | { kind: 'clear-all' }
  | { kind: 'request-access'; accessId: string }
  | { kind: 'request'; scope: CustomerDisplayScope };

function boundedText(value: string, maximumLength: number): string {
  return value.trim().slice(0, maximumLength);
}

function finiteMoney(value: number): number {
  return Number.isFinite(value) ? Math.max(0, roundMoney(value)) : 0;
}

function finiteQuantity(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function finiteDiscount(value: number): number {
  return Math.min(100, finiteQuantity(value));
}

function safeDisplayLine(item: SaleCartItem, priceIncludesTax: boolean): CustomerDisplayLine {
  const quantity = finiteQuantity(item.quantity);
  const unitPrice = finiteMoney(item.unitPrice);
  const discountPercent = finiteDiscount(item.discount);
  let total = 0;
  if (quantity > 0) {
    try {
      total = finiteMoney(
        getLineTotals(
          {
            ...item,
            quantity,
            unitPrice,
            discount: discountPercent,
            taxRate: finiteQuantity(item.taxRate),
            unitEquivalence:
              Number.isFinite(item.unitEquivalence) && item.unitEquivalence > 0
                ? item.unitEquivalence
                : 1,
          },
          priceIncludesTax
        ).total
      );
    } catch {
      // The advisory display must fail closed without interrupting checkout.
    }
  }

  return {
    name: boundedText(item.productName, 160),
    unitName: boundedText(item.unitName, 80),
    quantity,
    unitPrice,
    discountPercent,
    total,
  };
}

/** Build the only payload allowed to cross from the cashier cart to the public-facing screen. */
export function buildCustomerDisplayProjection(args: {
  scope: CustomerDisplayScope;
  revision: number;
  publishedAt: string;
  registerName: string;
  currency: string;
  items: SaleCartItem[];
  summary: SaleCartSummary;
  priceIncludesTax: boolean;
}): CustomerDisplayProjection {
  return {
    schemaVersion: CUSTOMER_DISPLAY_SCHEMA_VERSION,
    ...args.scope,
    revision: Math.max(1, Math.trunc(args.revision)),
    publishedAt: args.publishedAt,
    registerName: boundedText(args.registerName, 80),
    currency: boundedText(args.currency.toUpperCase(), 3),
    items: args.items
      .slice(0, CUSTOMER_DISPLAY_MAX_LINES)
      .map(item => safeDisplayLine(item, args.priceIncludesTax)),
    summary: {
      itemCount: finiteQuantity(args.summary.itemCount),
      subtotal: finiteMoney(args.summary.subtotal),
      taxAmount: finiteMoney(args.summary.taxAmount),
      total: finiteMoney(args.summary.total),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maximumLength;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z]{3}$/.test(value);
}

/** Parse untrusted localStorage/BroadcastChannel data without widening the display trust boundary. */
export function parseCustomerDisplayProjection(value: unknown): CustomerDisplayProjection | null {
  if (!isRecord(value) || value.schemaVersion !== CUSTOMER_DISPLAY_SCHEMA_VERSION) return null;
  if (
    !isCustomerDisplayAccessId(value.accessId) ||
    !isBoundedString(value.tenantId, 180) ||
    !isBoundedString(value.siteId, 180) ||
    !isBoundedString(value.cashSessionId, 180) ||
    !isBoundedString(value.registerName, 80) ||
    !isCurrencyCode(value.currency) ||
    !isBoundedString(value.publishedAt, 40) ||
    !isFiniteNonNegative(value.revision) ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !Array.isArray(value.items) ||
    value.items.length > CUSTOMER_DISPLAY_MAX_LINES ||
    !isRecord(value.summary)
  ) {
    return null;
  }

  const publishedAtMs = Date.parse(value.publishedAt);
  if (
    !Number.isFinite(publishedAtMs) ||
    new Date(publishedAtMs).toISOString() !== value.publishedAt
  ) {
    return null;
  }

  const items: CustomerDisplayLine[] = [];
  for (const item of value.items) {
    if (
      !isRecord(item) ||
      !isBoundedString(item.name, 160) ||
      !isBoundedString(item.unitName, 80) ||
      !isFiniteNonNegative(item.quantity) ||
      !isFiniteNonNegative(item.unitPrice) ||
      !isFiniteNonNegative(item.discountPercent) ||
      item.discountPercent > 100 ||
      !isFiniteNonNegative(item.total)
    ) {
      return null;
    }
    items.push({
      name: item.name,
      unitName: item.unitName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountPercent: item.discountPercent,
      total: item.total,
    });
  }

  if (
    !isFiniteNonNegative(value.summary.itemCount) ||
    !isFiniteNonNegative(value.summary.subtotal) ||
    !isFiniteNonNegative(value.summary.taxAmount) ||
    !isFiniteNonNegative(value.summary.total)
  ) {
    return null;
  }

  return {
    schemaVersion: CUSTOMER_DISPLAY_SCHEMA_VERSION,
    accessId: value.accessId,
    tenantId: value.tenantId,
    siteId: value.siteId,
    cashSessionId: value.cashSessionId,
    revision: value.revision,
    publishedAt: value.publishedAt,
    registerName: value.registerName,
    currency: value.currency,
    items,
    summary: {
      itemCount: value.summary.itemCount,
      subtotal: value.summary.subtotal,
      taxAmount: value.summary.taxAmount,
      total: value.summary.total,
    },
  };
}

export function customerDisplayScopeEquals(
  left: CustomerDisplayScope,
  right: CustomerDisplayScope
): boolean {
  return (
    left.accessId === right.accessId &&
    left.tenantId === right.tenantId &&
    left.siteId === right.siteId &&
    left.cashSessionId === right.cashSessionId
  );
}

export function customerDisplayStorageKey(scope: CustomerDisplayScope): string {
  return `${CUSTOMER_DISPLAY_STORAGE_PREFIX}${encodeURIComponent(scope.accessId)}:${encodeURIComponent(scope.tenantId)}:${encodeURIComponent(scope.siteId)}:${encodeURIComponent(scope.cashSessionId)}`;
}

function parseMessage(value: unknown): CustomerDisplayMessage | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'projection') {
    const projection = parseCustomerDisplayProjection(value.projection);
    return projection ? { kind: 'projection', projection } : null;
  }
  if (value.kind === 'clear-all') return { kind: 'clear-all' };
  if (value.kind === 'request-access' && isCustomerDisplayAccessId(value.accessId)) {
    return { kind: 'request-access', accessId: value.accessId };
  }
  if ((value.kind === 'clear' || value.kind === 'request') && isRecord(value.scope)) {
    const scope = value.scope;
    if (
      isCustomerDisplayAccessId(scope.accessId) &&
      isBoundedString(scope.tenantId, 180) &&
      isBoundedString(scope.siteId, 180) &&
      isBoundedString(scope.cashSessionId, 180)
    ) {
      return {
        kind: value.kind,
        scope: {
          accessId: scope.accessId,
          tenantId: scope.tenantId,
          siteId: scope.siteId,
          cashSessionId: scope.cashSessionId,
        },
      };
    }
  }
  return null;
}

function createCustomerDisplayChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel !== 'function') return null;
  try {
    return new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL_NAME);
  } catch {
    return null;
  }
}

/** Same-origin local bus. BroadcastChannel is primary; scoped localStorage is the reload fallback. */
export class CustomerDisplayBus {
  private readonly channel: BroadcastChannel | null;
  private readonly listeners = new Set<(message: CustomerDisplayMessage) => void>();
  private readonly handleChannelMessage = (event: MessageEvent<unknown>) => {
    const message = parseMessage(event.data);
    if (message) this.emit(message);
  };
  private readonly handleStorage = (event: StorageEvent) => {
    if (!event.key?.startsWith(CUSTOMER_DISPLAY_STORAGE_PREFIX)) return;
    if (event.newValue === null) {
      if (!event.oldValue) return;
      try {
        const projection = parseCustomerDisplayProjection(JSON.parse(event.oldValue));
        if (projection) this.emit({ kind: 'clear', scope: projection });
      } catch {
        // Invalid external storage is ignored and never reaches the display.
      }
      return;
    }
    try {
      const projection = parseCustomerDisplayProjection(JSON.parse(event.newValue));
      if (projection) this.emit({ kind: 'projection', projection });
    } catch {
      // Invalid external storage is ignored and never reaches the display.
    }
  };

  constructor() {
    this.channel = createCustomerDisplayChannel();
    this.channel?.addEventListener('message', this.handleChannelMessage);
    window.addEventListener('storage', this.handleStorage);
  }

  subscribe(listener: (message: CustomerDisplayMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  read(scope: CustomerDisplayScope): CustomerDisplayProjection | null {
    try {
      const raw = window.localStorage.getItem(customerDisplayStorageKey(scope));
      return raw ? parseCustomerDisplayProjection(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  }

  /** Discover canonical projections only for the unguessable display pairing capability. */
  readAccess(accessId: string): CustomerDisplayProjection[] {
    if (!isCustomerDisplayAccessId(accessId)) return [];
    const projections: CustomerDisplayProjection[] = [];
    try {
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const key = window.localStorage.key(index);
        if (!key?.startsWith(CUSTOMER_DISPLAY_STORAGE_PREFIX)) continue;
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        const projection = parseCustomerDisplayProjection(JSON.parse(raw));
        if (projection?.accessId === accessId && customerDisplayStorageKey(projection) === key) {
          projections.push(projection);
        }
      }
    } catch {
      // A restricted or concurrently-mutated store is treated as empty.
      return [];
    }
    return projections;
  }

  publish(projection: CustomerDisplayProjection): void {
    const parsed = parseCustomerDisplayProjection(projection);
    if (!parsed) return;
    try {
      window.localStorage.setItem(customerDisplayStorageKey(parsed), JSON.stringify(parsed));
    } catch {
      // Broadcast still keeps an already-open display live in private/restricted storage modes.
    }
    this.post({
      kind: 'projection',
      projection: parsed,
    });
  }

  request(scope: CustomerDisplayScope): void {
    const stored = this.read(scope);
    if (stored) this.emit({ kind: 'projection', projection: stored });
    this.post({ kind: 'request', scope });
  }

  requestAccess(accessId: string): void {
    if (!isCustomerDisplayAccessId(accessId)) return;
    for (const projection of this.readAccess(accessId)) {
      this.emit({ kind: 'projection', projection });
    }
    this.post({ kind: 'request-access', accessId });
  }

  clear(scope: CustomerDisplayScope): void {
    try {
      window.localStorage.removeItem(customerDisplayStorageKey(scope));
    } catch {
      // The broadcast remains the best-effort privacy cleanup path.
    }
    this.post({ kind: 'clear', scope });
  }

  close(): void {
    try {
      this.channel?.removeEventListener('message', this.handleChannelMessage);
      this.channel?.close();
    } catch {
      // Cleanup remains best-effort when the browser invalidates the channel.
    }
    window.removeEventListener('storage', this.handleStorage);
    this.listeners.clear();
  }

  private emit(message: CustomerDisplayMessage): void {
    for (const listener of this.listeners) listener(message);
  }

  private post(message: CustomerDisplayMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // Scoped localStorage remains the fallback; checkout must never fail.
    }
  }
}
