/**
 * Project the client-facing slice of `tenants.settings`.
 *
 * `auth.me` returned the blob verbatim under `protectedProcedure` — which is
 * any authenticated user, cashiers included. That blob stores payment-processor
 * credentials in cleartext at `payments.<railId>.credentials.*`
 * (`services/payments/credentials.ts` performs no sealing), so every cashier
 * could read the merchant's live Wompi / Bold / ePayco / Mercado Pago keys and
 * charge or refund against the merchant account from outside the POS.
 *
 * This is an ALLOWLIST and it descends into the nested shapes rather than
 * passing them through. Both properties are deliberate. A denylist has to be
 * amended every time someone stores a new secret, and the reason this leaked in
 * the first place is that the projection stopped at the tenant ROW: anything
 * added under `settings` published itself with no code change. Passing a nested
 * object through whole would reopen the same hole one level down.
 *
 * The key set mirrors the client contract, `TenantSettings` in
 * `apps/web/src/types/domain/auth.ts`. A key the client does not declare has no
 * reason to cross the wire; when the client needs a new one, add it here too and
 * the test in `__tests__/tenant-settings-projection.test.ts` will hold the pair
 * together.
 *
 * @module services/tenant-settings-projection
 */

/** The shape `auth.me` is allowed to publish. Mirrors the client contract. */
export interface ClientTenantSettings {
  taxRate?: number;
  businessType?: string;
  logo?: string;
  theme?: string;
  restaurant?: { serviceChargeRate?: number };
  cashClose?: { blindClose?: boolean };
  discount?: { expiryTiers?: unknown };
}

/** Every top-level key this projection will publish. Exported for the test. */
export const CLIENT_TENANT_SETTING_KEYS = [
  'taxRate',
  'businessType',
  'logo',
  'theme',
  'restaurant',
  'cashClose',
  'discount',
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Copy `key` from `source` onto `target` only when the source actually carries
 * it, so an absent setting stays absent rather than becoming an explicit
 * `undefined` the client would have to distinguish.
 */
function pick(target: Record<string, unknown>, source: Record<string, unknown>, key: string): void {
  if (Object.hasOwn(source, key)) target[key] = source[key];
}

/** Project one nested object down to the sub-keys the client declares. */
function pickNested(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
  subKeys: readonly string[]
): void {
  const nested = asRecord(source[key]);
  if (!nested) return;
  const projected: Record<string, unknown> = {};
  for (const subKey of subKeys) pick(projected, nested, subKey);
  target[key] = projected;
}

/**
 * @param settings raw `tenants.settings` as stored
 * @returns only the keys the client contract declares, nested shapes included
 */
export function projectTenantSettingsForClient(settings: unknown): ClientTenantSettings {
  const source = asRecord(settings);
  if (!source) return {};

  const projected: Record<string, unknown> = {};
  pick(projected, source, 'taxRate');
  pick(projected, source, 'businessType');
  pick(projected, source, 'logo');
  pick(projected, source, 'theme');
  pickNested(projected, source, 'restaurant', ['serviceChargeRate']);
  pickNested(projected, source, 'cashClose', ['blindClose']);
  pickNested(projected, source, 'discount', ['expiryTiers']);
  return projected as ClientTenantSettings;
}
