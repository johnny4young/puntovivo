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

export function formatCurrency(amount: number, currency = 'USD', locale = getActiveLocale()): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
  }).format(amount);
}

export function formatDate(
  date: Date | string,
  options?: Intl.DateTimeFormatOptions,
  locale = getActiveLocale()
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...options,
  }).format(d);
}

export function formatDateTime(date: Date | string, locale = getActiveLocale()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d);
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
