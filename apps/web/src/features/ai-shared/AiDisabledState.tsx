import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AiFeatureKey } from './useAiFeatureFlag';

interface AiDisabledStateProps {
  feature: AiFeatureKey;
  className?: string;
  /** Compact variant for inline placements (PurchasesPage toolbar tooltip). */
  variant?: 'standalone' | 'inline';
}

/**
 * Shared empty state per AI Núcleo handoff §1.5.
 *
 * Surfaces when a feature flag is OFF for the tenant. Renders a kicker
 * + title + body matched to the feature, then a CTA pointing to
 * `/settings/ai` where an admin flips the switch. Standalone variant
 * fills a card; inline variant is a small chip.
 */
export function AiDisabledState({ feature, className, variant = 'standalone' }: AiDisabledStateProps) {
  const { t } = useTranslation('aiShared');

  if (variant === 'inline') {
    return (
      <Link
        to="/settings/ai"
        className={cn(
          'inline-flex items-center gap-2 rounded-full border border-line/70 bg-surface px-3 py-1.5 text-xs text-secondary-600 hover:border-primary/50 hover:text-primary-700',
          className
        )}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        <span>{t('disabled.cta')}</span>
      </Link>
    );
  }

  return (
    <section
      data-testid={`ai-disabled-${feature}`}
      className={cn(
        'card relative overflow-hidden p-6 sm:p-8',
        className
      )}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 88% 0%, color-mix(in oklch, var(--primary) 12%, transparent), transparent 55%)',
        }}
      />
      <div className="relative">
        <div className="glyph-tile glyph-tile-primary h-12 w-12">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </div>
        <p className="page-kicker mt-4">{t(`disabled.${feature}.kicker`, { defaultValue: t('disabled.role') })}</p>
        <h2 className="mt-1 font-display text-2xl tracking-[-0.02em] text-secondary-950">
          {t(`disabled.${feature}.title`)}
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-6 text-secondary-600">
          {t(`disabled.${feature}.subtitle`)}
        </p>
        <Link to="/settings/ai" className="btn-primary mt-4 inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {t('disabled.cta')}
        </Link>
      </div>
    </section>
  );
}
