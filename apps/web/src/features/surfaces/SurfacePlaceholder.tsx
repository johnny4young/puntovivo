/**
 * ENG-069 — Shared placeholder rendered inside each surface shell.
 *
 * Renders a centered card with the surface label, description,
 * "próximamente" badge, and a CTA back to /dashboard. The actual
 * surface workflows (touch sales flow, kitchen ticket queue, table
 * grid, etc.) replace this placeholder with real content in
 * ENG-039 (vertical restaurant).
 *
 * @module features/surfaces/SurfacePlaceholder
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Sparkles } from 'lucide-react';

interface SurfacePlaceholderProps {
  /**
   * i18n key suffix under `surfaces.<i18nKey>`. The component reads
   * `surfaces.<i18nKey>.label`, `surfaces.<i18nKey>.description`, and
   * `surfaces.<i18nKey>.upcomingTicket` for the badge text.
   */
  i18nKey: string;
  /**
   * Optional className override for the outer container so each
   * shell can tune the placeholder color contrast (e.g. KDS uses
   * text-secondary-50 over a dark backdrop).
   */
  containerClassName?: string;
  /** Optional className tweaks for the centered card. */
  cardClassName?: string;
}

export function SurfacePlaceholder({
  i18nKey,
  containerClassName,
  cardClassName,
}: SurfacePlaceholderProps) {
  const { t } = useTranslation('surfaces');

  return (
    <div
      className={
        containerClassName ??
        'flex min-h-[60vh] items-center justify-center'
      }
    >
      <div
        className={
          cardClassName ??
          'card flex max-w-lg flex-col gap-4 p-8 text-center'
        }
        data-testid="surface-placeholder"
      >
        <div className="inline-flex items-center justify-center self-center rounded-full bg-primary-50 p-3 text-primary-700">
          <Sparkles className="h-5 w-5" />
        </div>
        <h1 className="text-2xl font-semibold">
          {t(`${i18nKey}.label`)}
        </h1>
        <p className="text-sm text-secondary-700">
          {t(`${i18nKey}.description`)}
        </p>
        <div className="self-center rounded-full bg-secondary-100 px-3 py-1 text-xs font-medium uppercase tracking-wider text-secondary-700">
          {t(`${i18nKey}.upcomingTicket`)}
        </div>
        <Link
          to="/dashboard"
          className="btn-outline mt-2 inline-flex items-center justify-center gap-2 self-center"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('placeholder.dashboardCta')}
        </Link>
      </div>
    </div>
  );
}
