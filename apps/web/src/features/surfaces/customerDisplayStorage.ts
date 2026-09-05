export const CUSTOMER_DISPLAY_CHANNEL_NAME = 'puntovivo:customer-display:v1';
export const CUSTOMER_DISPLAY_STORAGE_PREFIX = 'puntovivo:customer-display:v1:';
export const CUSTOMER_DISPLAY_ACCESS_STORAGE_PREFIX = 'puntovivo:customer-display-access:v1:';
const CUSTOMER_DISPLAY_ACCESS_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isCustomerDisplayAccessId(value: unknown): value is string {
  return typeof value === 'string' && CUSTOMER_DISPLAY_ACCESS_ID.test(value);
}

function createCustomerDisplayAccessId(): string | null {
  if (typeof crypto === 'undefined') return null;
  if (typeof crypto.randomUUID === 'function') {
    const candidate = crypto.randomUUID();
    if (isCustomerDisplayAccessId(candidate)) return candidate;
  }
  if (typeof crypto.getRandomValues !== 'function') return null;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Pair all checkout publishers for one tenant/site without putting business ids in the URL. */
export function getOrCreateCustomerDisplayAccessId(
  tenantId: string,
  siteId: string
): string | null {
  const key = `${CUSTOMER_DISPLAY_ACCESS_STORAGE_PREFIX}${encodeURIComponent(tenantId)}:${encodeURIComponent(siteId)}`;
  try {
    const existing = window.localStorage.getItem(key);
    if (isCustomerDisplayAccessId(existing)) return existing;
    const created = createCustomerDisplayAccessId();
    if (!created) return null;
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    try {
      return createCustomerDisplayAccessId();
    } catch {
      return null;
    }
  }
}

/** Remove every locally mirrored customer-display projection during identity teardown. */
export function clearAllCustomerDisplayProjections(): void {
  try {
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (
        key?.startsWith(CUSTOMER_DISPLAY_STORAGE_PREFIX) ||
        key?.startsWith(CUSTOMER_DISPLAY_ACCESS_STORAGE_PREFIX)
      ) {
        window.localStorage.removeItem(key);
      }
    }
  } catch {
    // Restricted storage must not make logout fail.
  }
  if (typeof BroadcastChannel === 'function') {
    try {
      const channel = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL_NAME);
      try {
        channel.postMessage({ kind: 'clear-all' });
      } finally {
        channel.close();
      }
    } catch {
      // A blocked channel must never keep the authenticated session alive.
    }
  }
}
