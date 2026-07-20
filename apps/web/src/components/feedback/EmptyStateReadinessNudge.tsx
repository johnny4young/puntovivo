/**
 * Empty-state readiness nudge.
 *
 * Compact card rendered above a table when the underlying query
 * returns zero rows. Surfaces the next-step CTA pointing at the
 * `/company?tab=readiness` checklist so a fresh tenant always has a
 * way back to the guided setup.
 *
 * Hidden by default for non-admin roles because the CTA deep-links
 * into admin-only setup surfaces. Same gate as the readiness banner.
 *
 * @module components/feedback/EmptyStateReadinessNudge
 */

import { useTranslation } from 'react-i18next';
import { Sparkles, ArrowRight } from 'lucide-react';
import { useAuth } from '@/features/auth/AuthProvider';

export interface EmptyStateReadinessNudgeProps {
  /**
   * i18n key under `setup:emptyState.<scope>` to render the title +
   * description. Currently supports `products` and `customers`;
   * extending to more surfaces is one-line additions to
   * `setup.json`.
   */
  scope: 'products' | 'customers';
}

export function EmptyStateReadinessNudge({ scope }: EmptyStateReadinessNudgeProps) {
  const { t } = useTranslation('setup');
  const { user } = useAuth();
  const isSetupAdmin = user?.role === 'admin';
  if (!isSetupAdmin) return null;
  return (
    <div
      className="rounded-xl border border-primary-100 bg-primary-50 px-4 py-3 flex items-start gap-3"
      data-testid={`empty-state-readiness-${scope}`}
    >
      <Sparkles className="h-5 w-5 text-primary-600 mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-primary-900">{t(`emptyState.${scope}.title`)}</p>
        <p className="text-xs text-primary-800 mt-0.5">{t(`emptyState.${scope}.description`)}</p>
      </div>
      {/*
        Plain anchor instead of react-router `Link` so the nudge
        renders correctly even in test rigs that omit the Router
        context (e.g. `ProductsPage.moduleGate.test.tsx`). The
        target route lives in the same SPA — the browser handles the
        URL change and react-router picks it up via the global history
        listener. Empty-state navigation is a rare event so the
        full-page round trip is acceptable here.
      */}
      <a
        href="/company?tab=readiness"
        className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary-700 hover:text-primary-900 hover:underline"
        data-testid={`empty-state-readiness-${scope}-cta`}
      >
        <span>{t(`emptyState.${scope}.cta`)}</span>
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </a>
    </div>
  );
}
