import { eq } from 'drizzle-orm';
import type { DatabaseInstance } from '../../db/index.js';
import { countryCatalog, tenantLocaleSettings } from '../../db/schema.js';
import { throwServerError } from '../../lib/errorCodes.js';
import { calendarDayInTimeZone } from '../reports/day-window.js';
import { LOCALE_FALLBACK, resolveTenantLocale } from '../tenant-locale.js';

export interface TenantBusinessClock {
  nowIso: string;
  businessDate: string;
  timezone: string;
  countryCode: string;
  localeVersion: number;
}

export type TenantBusinessClockGuard = Pick<
  TenantBusinessClock,
  'businessDate' | 'timezone' | 'countryCode' | 'localeVersion'
>;

/** Resolve regulatory country and calendar day from server-owned tenant locale. */
export async function resolveTenantBusinessClock(
  db: DatabaseInstance,
  tenantId: string,
  now: Date = new Date()
): Promise<TenantBusinessClock> {
  const locale = await resolveTenantLocale(db, tenantId);
  return {
    nowIso: now.toISOString(),
    businessDate: calendarDayInTimeZone(now, locale.timezone),
    timezone: locale.timezone,
    countryCode: locale.countryCode,
    localeVersion: locale.version,
  };
}

/**
 * Fail closed if locale policy or its effective calendar day changed before
 * the writer was reserved. Comparing only the optimistic version is not
 * sufficient: a previously unconfigured tenant can gain a version-zero row,
 * and a command queued behind another writer can cross local midnight.
 */
export function assertTenantBusinessClockCurrent(
  db: DatabaseInstance,
  tenantId: string,
  clock: TenantBusinessClockGuard,
  now: Date = new Date()
): void {
  const current = db
    .select({
      version: tenantLocaleSettings.version,
      countryCode: tenantLocaleSettings.countryCode,
      timezoneOverride: tenantLocaleSettings.timezoneOverride,
      defaultTimezone: countryCatalog.defaultTimezone,
    })
    .from(tenantLocaleSettings)
    .leftJoin(countryCatalog, eq(countryCatalog.code, tenantLocaleSettings.countryCode))
    .where(eq(tenantLocaleSettings.tenantId, tenantId))
    .get();
  const currentVersion = current?.version ?? 0;
  const currentCountryCode = current?.defaultTimezone
    ? current.countryCode
    : LOCALE_FALLBACK.countryCode;
  const currentTimezone = current?.defaultTimezone
    ? (current.timezoneOverride ?? current.defaultTimezone)
    : LOCALE_FALLBACK.timezone;
  if (
    currentVersion !== clock.localeVersion ||
    currentCountryCode !== clock.countryCode ||
    currentTimezone !== clock.timezone
  ) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STALE_VERSION',
      message: 'Tenant locale changed before the business-date operation acquired its transaction',
      details: {
        entity: 'tenantLocale',
        suppliedVersion: clock.localeVersion,
        currentVersion,
        suppliedCountryCode: clock.countryCode,
        currentCountryCode,
        suppliedTimezone: clock.timezone,
        currentTimezone,
      },
    });
  }

  const currentBusinessDate = calendarDayInTimeZone(now, currentTimezone);
  if (currentBusinessDate !== clock.businessDate) {
    throwServerError({
      trpcCode: 'CONFLICT',
      errorCode: 'STALE_VERSION',
      message: 'Tenant business date changed before the operation acquired its transaction',
      details: {
        entity: 'tenantBusinessClock',
        suppliedBusinessDate: clock.businessDate,
        currentBusinessDate,
        timezone: currentTimezone,
      },
    });
  }
}

export function isCalendarDateExpired(value: string | null, businessDate: string): boolean {
  if (!value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value)
    return true;
  return value < businessDate;
}
