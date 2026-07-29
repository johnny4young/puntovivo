/**
 * Empty-state readiness nudge.
 *
 * Compact card rendered above a table when the underlying query
 * returns zero rows. Surfaces the next-step CTA pointing at the
 * guided `/company` checklist so a fresh tenant always has a
 * way back to the guided setup.
 *
 * Hidden by default for non-admin roles because the CTA deep-links
 * into admin-only setup surfaces. Same gate as the readiness banner.
 *
 * @module components/feedback/EmptyStateReadinessNudge
 */

import { useTranslation } from 'react-i18next';
import { Sparkles, ArrowRight } from 'lucide-react';
import { GuidedEmptyStateCard } from '@/components/experience';
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
    <GuidedEmptyStateCard
      icon={Sparkles}
      title={t(`emptyState.${scope}.title`)}
      description={t(`emptyState.${scope}.description`)}
      testId={`empty-state-readiness-${scope}`}
      action={
        /*
         * Plain anchor instead of react-router Link so the nudge works in test
         * rigs without Router context and in the packaged custom protocol.
         */
        <a
          href={
            window.location.protocol === 'http:' || window.location.protocol === 'https:'
              ? '/company'
              : '#/company'
          }
          className="inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-xl px-3 text-sm font-semibold text-primary-800 transition-colors hover:bg-white hover:text-primary-950 sm:w-auto"
          data-testid={`empty-state-readiness-${scope}-cta`}
        >
          <span>{t(`emptyState.${scope}.cta`)}</span>
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      }
    />
  );
}
