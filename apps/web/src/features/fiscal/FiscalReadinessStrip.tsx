import { CheckCircle2, AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { formatNumber } from '@/lib/utils';
import { trpc } from '@/lib/trpc';

const SETUP_LINK = '/company?tab=fiscal';
// Every state that still needs an answer or a decision, not only the two most common.
const ATTENTION_STATUSES = [
  'pending',
  'sent',
  'rejected',
  'contingency',
  'notified_correction',
  'partial_send',
] as const;
const NUMBERING_ISSUES = new Set(['MISSING_RESOLUTION', 'MISSING_RANGE']);

function isFiscalCountry(code: string | null | undefined): code is 'CO' | 'MX' | 'CL' {
  return code === 'CO' || code === 'MX' || code === 'CL';
}

function ReadinessCell({
  label,
  value,
  ok,
  link,
  testId,
}: {
  label: string;
  value: ReactNode;
  ok: boolean;
  link: { to: string; label: string };
  testId: string;
}) {
  const Icon = ok ? CheckCircle2 : AlertTriangle;
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface p-3" data-testid={testId}>
      <p className="text-xs text-secondary-500">{label}</p>
      <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
        <Icon
          className={`h-4 w-4 shrink-0 ${ok ? 'text-success-700' : 'text-warning-700'}`}
          aria-hidden="true"
        />
        <span className="min-w-0 wrap-anywhere">{value}</span>
      </p>
      <Link
        to={link.to}
        className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-primary-700 hover:underline"
      >
        {link.label}
      </Link>
    </div>
  );
}

/** What stands between the tenant and valid fiscal documents, on every finance page. */
export function FiscalReadinessStrip() {
  const { t } = useTranslation('fiscal');
  const countryCode = trpc.tenantLocale.get.useQuery().data?.countryCode;
  const settingsQuery = trpc.fiscalSettings.getByCountry.useQuery(
    { countryCode: isFiscalCountry(countryCode) ? countryCode : 'CO' },
    { enabled: isFiscalCountry(countryCode) }
  );
  const attentionQueries = trpc.useQueries(t =>
    ATTENTION_STATUSES.map(status =>
      t.reports.fiscal.list({ limit: 1, offset: 0, status }, { staleTime: 30_000 })
    )
  );

  const fiscal = settingsQuery.data;
  if (!fiscal) return null;

  const issues = fiscal.validation.issues ?? [];
  const numberingMissing = issues.some(issue => NUMBERING_ISSUES.has(issue.code));
  const profileMissing = issues.some(issue => !NUMBERING_ISSUES.has(issue.code));
  const environment = fiscal.settings.environment;
  const isProduction = environment === 'produccion' || environment === 'production';
  const attentionLoaded = attentionQueries.every(query => query.data !== undefined);
  const attention = attentionQueries.reduce((sum, query) => sum + (query.data?.total ?? 0), 0);

  return (
    <section
      className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
      aria-label={t('readiness.label')}
      data-testid="fiscal-readiness-strip"
    >
      <ReadinessCell
        label={t('readiness.profile')}
        value={t(`readiness.countries.${fiscal.countryCode}`)}
        ok={!profileMissing}
        link={{
          to: SETUP_LINK,
          label: profileMissing ? t('readiness.complete') : t('readiness.edit'),
        }}
        testId="fiscal-readiness-profile"
      />
      {fiscal.countryCode === 'CO' && (
        <ReadinessCell
          label={t('readiness.numbering')}
          value={
            numberingMissing
              ? t('readiness.missing')
              : (fiscal.settings.dianResolutionNumber ?? t('readiness.missing'))
          }
          ok={!numberingMissing}
          link={{
            to: SETUP_LINK,
            label: numberingMissing ? t('readiness.addResolution') : t('readiness.edit'),
          }}
          testId="fiscal-readiness-numbering"
        />
      )}
      <ReadinessCell
        label={t('readiness.environment')}
        value={isProduction ? t('readiness.production') : t('readiness.testing')}
        ok={isProduction}
        link={{ to: SETUP_LINK, label: t('readiness.edit') }}
        testId="fiscal-readiness-environment"
      />
      <ReadinessCell
        label={t('readiness.pending')}
        value={attentionLoaded ? formatNumber(attention) : '—'}
        ok={attentionLoaded && attention === 0}
        link={{ to: '/fiscal-documents', label: t('readiness.viewQueue') }}
        testId="fiscal-readiness-pending"
      />
    </section>
  );
}
