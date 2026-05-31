/**
 * ENG-105b — Checkout preflight panel.
 *
 * Renders the list of blockers + warnings produced by
 * `useCheckoutPreflight`. Hidden when there is nothing to report.
 * Each item shows an icon (AlertCircle for blockers, AlertTriangle
 * for warnings), an operator-friendly message in the active locale,
 * and an optional recovery CTA button.
 *
 * a11y contract:
 * - The outer wrapper carries `role="status"` + `aria-live="polite"`
 *   so screen readers announce new blockers/warnings as the cart
 *   changes (matches the setup-readiness alert pattern shipped earlier).
 * - The first blocker is rendered with `id="checkout-preflight-primary"`
 *   so the Cobrar button can wire `aria-describedby` to it.
 * - Recovery buttons render visible i18n text; no icon-only affordance.
 *
 * Visual contract:
 * - Blockers use the `danger-50` family (red) that ENG-134c already
 *   saneó to clear WCAG AA 4.5:1.
 * - Warnings use the `warning-50` family (amber) — same family that
 *   the ENG-134c sweep darkened `--warning-700` to L=0.50 for AA.
 * - The panel does not introduce CLS — its space is `null` when there
 *   are no items, and the SalesCheckoutPanel layout uses `space-y-3`
 *   so the gap collapses cleanly.
 *
 * @module features/sales/CheckoutPreflightPanel
 */

import { AlertCircle, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PreflightItem } from './useCheckoutPreflight';

export const PREFLIGHT_PRIMARY_ELEMENT_ID = 'checkout-preflight-primary';

interface CheckoutPreflightPanelProps {
  items: readonly PreflightItem[];
}

export function CheckoutPreflightPanel({ items }: CheckoutPreflightPanelProps) {
  const { t } = useTranslation('sales');

  if (items.length === 0) {
    return null;
  }

  return (
    <section
      className="card-inset space-y-2 px-4 py-3"
      role="status"
      aria-live="polite"
      data-testid="checkout-preflight-panel"
    >
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.22em] text-secondary-500">
        {t('preflight.title')}
      </p>
      <ul className="space-y-2">
        {items.map((item, index) => {
          const isBlocker = item.severity === 'blocker';
          // First blocker only — anchor for the Cobrar's aria-describedby.
          const isPrimary =
            isBlocker && items.findIndex(other => other.severity === 'blocker') === index;
          const Icon = isBlocker ? AlertCircle : AlertTriangle;
          const containerClass = isBlocker
            ? 'flex items-start gap-3 rounded-2xl border border-danger-200 bg-danger-50 px-3 py-2.5 text-sm text-danger-800'
            : 'flex items-start gap-3 rounded-2xl border border-warning-200 bg-warning-50 px-3 py-2.5 text-sm text-warning-700';
          const iconClass = isBlocker
            ? 'h-4 w-4 shrink-0 text-danger-700'
            : 'h-4 w-4 shrink-0 text-warning-700';
          const ctaClass = isBlocker
            ? 'text-xs font-semibold text-danger-900 underline-offset-2 hover:underline'
            : 'text-xs font-semibold text-warning-700 underline-offset-2 hover:underline';

          return (
            <li
              key={item.id}
              id={isPrimary ? PREFLIGHT_PRIMARY_ELEMENT_ID : undefined}
              className={containerClass}
              data-testid={`checkout-preflight-${item.severity}-${item.id}`}
            >
              <Icon className={iconClass} aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-sm">
                  {/* ENG-179b — exactOptional rejects `t(key, undefined)`; gate on the values. */}
                  {item.messageValues ? t(item.messageKey, item.messageValues) : t(item.messageKey)}
                </p>
                {item.recoveryAction && (
                  <button
                    type="button"
                    className={ctaClass}
                    onClick={item.recoveryAction.onClick}
                    data-testid={`checkout-preflight-recovery-${item.id}`}
                  >
                    {t(item.recoveryAction.labelKey)}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
