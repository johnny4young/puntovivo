import { calendarDayAt } from '@/lib/utils';

const DAY_MS = 86_400_000;

/**
 * Days from today to the quotation's last valid day in the business time zone:
 * 0 is today and negative has expired; null without a valid date.
 */
export function quotationDaysLeft(
  validUntil: string | null,
  timeZone: string,
  now: Date = new Date()
): number | null {
  const end = validUntil ? new Date(validUntil) : null;
  if (!end || Number.isNaN(end.getTime())) return null;
  const day = (instant: Date) => Date.parse(calendarDayAt(instant, timeZone));
  return Math.round((day(end) - day(now)) / DAY_MS);
}

/** The banner's expiry key and count. */
export function quotationExpiryLabel(days: number): [key: string, count?: number] {
  if (days < 0) return ['quotationCart.expired'];
  if (days === 0) return ['quotationCart.expiresToday'];
  return ['quotationCart.expiresIn', days];
}
