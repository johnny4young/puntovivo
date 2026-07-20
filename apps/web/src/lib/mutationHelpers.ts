/**
 * Mutation-side helpers used across feature modules.
 *
 * Introduced by  to collapse the recurring `onError` pattern
 *
 * onError: error => toast.error({
 * title: t('toast.error'),
 * description: getErrorMessage(error, t('toast.error')),
 * }),
 *
 * that repeats across ~27 mutation call sites in `apps/web/src/features/`,
 * along with two pages (`SalesPage`, `ProductsPage`) that defined private
 * `getServerErrorMessage` wrappers around `translateServerError`.
 *
 * `onErrorToast` is a builder, not a hook — it returns a plain function
 * that callers spread into `useMutation({ onError })`. The audit named the
 * helper `useMutationWithErrorToast`, but a wrapper hook would force every
 * caller to rewrite its `trpc.foo.bar.useMutation()` invocation and pay a
 * generic-inference cost; the builder shape is a one-line drop-in at every
 * site, composes cleanly with caller-side state mutations, and keeps the
 * unit test free of provider plumbing.
 *
 * Internally routes through `translateServerError` so every site gains
 * locale-aware error-code translation without the caller asking for it
 * (strict superset of the old `getErrorMessage` path).
 */

import type { TFunction } from 'i18next';
import type { useToast } from '@/components/feedback/ToastProvider';
import { translateServerError } from '@/lib/translateServerError';

type Toast = ReturnType<typeof useToast>;

export interface OnErrorToastOptions {
  /** i18n key for the toast title. Defaults to `common:toast.error`. */
  titleKey?: string;
  /**
   * i18n key for the fallback description, used when the error has no
   * resolvable `errorCode` and no usable `message`. Defaults to
   * `errors:server.unknown`.
   */
  fallbackKey?: string;
  /**
   * Caller-side side effect (set local state, focus a field). Receives
   * the resolved description string and the original error. Runs after
   * the toast has been emitted.
   */
  extra?: (description: string, error: unknown) => void;
}

/**
 * Build a tRPC `onError` handler that emits a translated error toast and
 * optionally runs caller-side side effects.
 *
 * @example
 * // Variant A — pure toast.
 * const createMutation = trpc.purchases.create.useMutation({
 * onError: onErrorToast(toast, t),
 * onSuccess: ...,
 * });
 *
 * @example
 * // Variant B — toast + local state mutation.
 * const openCashSession = trpc.cashSessions.open.useMutation({
 * onError: onErrorToast(toast, t, {
 * extra: description => setCashSessionError(description),
 * }),
 * });
 */
export function onErrorToast(
  toast: Toast,
  t: TFunction,
  options?: OnErrorToastOptions
): (error: unknown) => void {
  const titleKey = options?.titleKey ?? 'common:toast.error';
  const fallbackKey = options?.fallbackKey ?? 'errors:server.unknown';
  const extra = options?.extra;

  return error => {
    const fallback = t(fallbackKey);
    const description = translateServerError(
      error,
      t,
      typeof fallback === 'string' ? fallback : fallbackKey
    );
    const titleResolved = t(titleKey);
    toast.error({
      title: typeof titleResolved === 'string' ? titleResolved : titleKey,
      description,
    });
    extra?.(description, error);
  };
}
