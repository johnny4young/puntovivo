import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';
import i18next from '@/i18n';

// Configure tailwind-merge for custom color palettes
// In tailwind-merge v3, custom theme values are added per-scale
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // Custom color scales for bg-*, text-*, border-*, etc.
      color: [
        'primary',
        'primary-50',
        'primary-100',
        'primary-200',
        'primary-300',
        'primary-400',
        'primary-500',
        'primary-600',
        'primary-700',
        'primary-800',
        'primary-900',
        'primary-950',
        'secondary',
        'secondary-50',
        'secondary-100',
        'secondary-200',
        'secondary-300',
        'secondary-400',
        'secondary-500',
        'secondary-600',
        'secondary-700',
        'secondary-800',
        'secondary-900',
        'secondary-950',
        'success-50',
        'success-500',
        'success-700',
        'warning-50',
        'warning-500',
        'warning-700',
        'danger-50',
        'danger-500',
        'danger-600',
        'danger-700',
        'surface',
        'surface-2',
        'surface-3',
        'line',
        'line-strong',
        'ink',
        'ink-soft',
        'border',
        'input',
        'ring',
        'background',
        'foreground',
        'card',
        'card-foreground',
        'popover',
        'popover-foreground',
        'muted',
        'muted-foreground',
        'accent',
        'accent-foreground',
        'destructive',
        'destructive-foreground',
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function getActiveLocale(): string {
  if (typeof i18next.resolvedLanguage === 'string' && i18next.resolvedLanguage.length > 0) {
    return i18next.resolvedLanguage;
  }

  if (typeof navigator !== 'undefined') {
    return navigator.languages?.[0] ?? navigator.language ?? 'en-US';
  }

  return 'en-US';
}

// ENG-017 — module-level locale singleton. `LocaleProvider` calls
// `setActiveTenantLocale` when the tenant's resolved locale mutates,
// and the formatters below read from this cell when the caller did
// not pass explicit args. Avoids touching the ~140 existing call
// sites of `formatCurrency(amount)` — they keep the same shape, the
// default currency just stops being hardcoded `USD`.
interface ActiveTenantLocaleSnapshot {
  locale: string;
  currency: string;
  displayDecimals: number;
  timezone: string;
  dateFormatShort: string;
}

let activeTenantLocale: ActiveTenantLocaleSnapshot | null = null;

/**
 * Update the process-wide default locale used by `formatCurrency`,
 * `formatDate`, and `formatDateTime` when called without arguments.
 * Invoked by `LocaleProvider` on mount and on tenant switch. Pass
 * `null` to revert to the hardcoded USA fallback (e.g. during logout).
 */
export function setActiveTenantLocale(
  snapshot: ActiveTenantLocaleSnapshot | null
): void {
  activeTenantLocale = snapshot;
}

/** Read-only accessor used by `useResolvedLocale` for SSR-safe access. */
export function getActiveTenantLocale(): ActiveTenantLocaleSnapshot | null {
  return activeTenantLocale;
}

export function formatCurrency(
  amount: number,
  currency?: string,
  locale?: string
): string {
  const resolvedCurrency =
    currency ?? activeTenantLocale?.currency ?? 'USD';
  const resolvedLocale = locale ?? activeTenantLocale?.locale ?? getActiveLocale();
  const displayDecimals = activeTenantLocale?.displayDecimals;
  return new Intl.NumberFormat(resolvedLocale, {
    style: 'currency',
    currency: resolvedCurrency,
    ...(currency === undefined && displayDecimals !== undefined
      ? {
          minimumFractionDigits: displayDecimals,
          maximumFractionDigits: displayDecimals,
        }
      : {}),
  }).format(amount);
}

export function formatDate(
  date: Date | string,
  options?: Intl.DateTimeFormatOptions,
  locale?: string
): string {
  // Defensive null/undefined check: while the public type is `Date | string`,
  // many callers pass `String(value ?? '')` from JSON payloads where `value`
  // is genuinely null at runtime, and a few pass a `Date` constructed from
  // invalid input. Returning '' on any non-Date / non-finite input keeps
  // downstream export pipelines from throwing inside `Intl.DateTimeFormat`.
  if (date === null || date === undefined) return '';
  const d = date instanceof Date ? date : new Date(date as string);
  if (!Number.isFinite(d.getTime())) return '';
  const resolvedLocale = locale ?? activeTenantLocale?.locale ?? getActiveLocale();
  const resolvedTimezone = activeTenantLocale?.timezone;

  if (!options && !locale && activeTenantLocale?.dateFormatShort) {
    return formatDateByPattern(
      d,
      activeTenantLocale.dateFormatShort,
      activeTenantLocale.timezone
    );
  }

  return new Intl.DateTimeFormat(resolvedLocale, {
    ...(resolvedTimezone ? { timeZone: resolvedTimezone } : {}),
    dateStyle: 'medium',
    ...options,
  }).format(d);
}

export function formatDateTime(date: Date | string, locale?: string): string {
  // See formatDate above for rationale; same null/undefined guard.
  if (date === null || date === undefined) return '';
  const d = date instanceof Date ? date : new Date(date as string);
  if (!Number.isFinite(d.getTime())) return '';
  const resolvedLocale = locale ?? activeTenantLocale?.locale ?? getActiveLocale();

  if (!locale && activeTenantLocale?.dateFormatShort) {
    const time = new Intl.DateTimeFormat(resolvedLocale, {
      timeStyle: 'short',
      timeZone: activeTenantLocale.timezone,
    }).format(d);
    return `${formatDateByPattern(
      d,
      activeTenantLocale.dateFormatShort,
      activeTenantLocale.timezone
    )} ${time}`;
  }

  return new Intl.DateTimeFormat(resolvedLocale, {
    ...(activeTenantLocale?.timezone ? { timeZone: activeTenantLocale.timezone } : {}),
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
}

function formatDateByPattern(
  date: Date,
  pattern: string,
  timeZone: string
): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = new Map(
    parts
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value])
  );
  const year = values.get('year') ?? '0000';
  const month = values.get('month') ?? '01';
  const day = values.get('day') ?? '01';

  switch (pattern) {
    case 'dd/MM/yyyy':
      return `${day}/${month}/${year}`;
    case 'MM/dd/yyyy':
      return `${month}/${day}/${year}`;
    case 'yyyy-MM-dd':
      return `${year}-${month}-${day}`;
    default:
      return new Intl.DateTimeFormat(getActiveLocale(), {
        dateStyle: 'medium',
        timeZone,
      }).format(date);
  }
}

export function generateId(): string {
  return crypto.randomUUID();
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  fn: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      fn(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

export function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
