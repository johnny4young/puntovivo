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

import type { VerticalPresetId } from '@puntovivo/shared/vertical-presets';

/**
 * The shape `auth.me` is allowed to publish. Mirrors the client contract.
 *
 * The unions are not decoration: these types flow end to end through the
 * AppRouter export, so widening `businessType` to `string` breaks the web
 * build where it narrows a vertical.
 */
export interface ClientTenantSettings {
  taxRate?: number;
  businessType?: VerticalPresetId;
  logo?: string;
  theme?: 'light' | 'dark' | 'system';
  restaurant?: { serviceChargeRate: number };
  cashClose?: { blindClose: boolean };
  discount?: { expiryTiers: Array<{ maxDays: number; pct: number }> };
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

/**
 * Project one nested object down to the single sub-key the client declares.
 *
 * Each of these shapes declares its sub-key as REQUIRED inside an optional
 * object, so emitting `{}` when the stored blob has the wrapper but not the
 * value would hand the client a shape its own type says cannot exist. Omit the
 * wrapper instead and let the client's default fill in.
 */
function pickNested(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
  requiredSubKey: string
): void {
  const nested = asRecord(source[key]);
  if (!nested || !Object.hasOwn(nested, requiredSubKey)) return;
  target[key] = { [requiredSubKey]: nested[requiredSubKey] };
}

function isExpiryTierList(value: unknown): value is Array<{ maxDays: number; pct: number }> {
  return (
    Array.isArray(value) &&
    value.every(entry => {
      const tier = asRecord(entry);
      return (
        tier !== null &&
        typeof tier.maxDays === 'number' &&
        Number.isFinite(tier.maxDays) &&
        typeof tier.pct === 'number' &&
        Number.isFinite(tier.pct)
      );
    })
  );
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
  pickNested(projected, source, 'restaurant', 'serviceChargeRate');
  pickNested(projected, source, 'cashClose', 'blindClose');

  // The only setting whose shape the client narrows beyond a primitive. The
  // stored blob is untyped, so casting it to the declared array would be the
  // same lie as a hand-written SQL row cast: it type-checks and then breaks at
  // render. Validate instead, and omit the wrapper when it does not hold so the
  // panel falls back to its own defaults, which it already does.
  const tiers = asRecord(source.discount)?.expiryTiers;
  if (isExpiryTierList(tiers)) projected.discount = { expiryTiers: tiers };

  return projected as ClientTenantSettings;
}
