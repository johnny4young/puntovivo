import { Activity, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { trpc } from '@/lib/trpc';
import { onErrorToast } from '@/lib/mutationHelpers';
import { cn } from '@/lib/utils';

/**
 * Per-tenant telemetry opt-in toggle.
 *
 * Reads the current state from `companies.getCurrent.telemetryOptIn`
 * (defaulted to false). Admins can flip the flag via
 * `companies.updateTelemetryOptIn`; every flip writes an audit row
 * `telemetry.opt_in.updated` so the consent timeline survives.
 *
 * The card renders inside the `data` tab of `/company` — under
 * Sync + Backup — because the toggle controls what data leaves the
 * device.
 */
export function CompanyTelemetryCard() {
  const { t } = useTranslation('settings');
  const toast = useToast();
  const utils = trpc.useUtils();
  const companyQuery = trpc.companies.getCurrent.useQuery();
  const telemetryOptIn = companyQuery.data?.telemetryOptIn ?? false;

  const updateMutation = trpc.companies.updateTelemetryOptIn.useMutation({
    onSuccess: async ({ telemetryOptIn: next }) => {
      await utils.companies.getCurrent.invalidate();
      toast.success({
        title: next ? t('company.telemetry.toast.enabled') : t('company.telemetry.toast.disabled'),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'company.telemetry.toast.failed',
    }),
  });

  const isLoading = companyQuery.isLoading || updateMutation.isPending;

  const handleToggle = () => {
    updateMutation.mutate({ optedIn: !telemetryOptIn });
  };

  const toggleLabel = updateMutation.isPending
    ? t('company.telemetry.pending')
    : telemetryOptIn
      ? t('company.telemetry.disable')
      : t('company.telemetry.enable');

  return (
    <section className="card p-6 space-y-5" data-testid="company-telemetry-card">
      <div className="flex items-start gap-3">
        <span className="pv-gt pv-gt-ink h-[38px] w-[38px]">
          <Activity className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-950">
            {t('company.telemetry.title')}
          </h2>
          <p className="text-sm text-secondary-500">{t('company.telemetry.description')}</p>
        </div>
      </div>

      <div
        className={cn(
          'flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm',
          telemetryOptIn
            ? 'border-success-300/70 bg-success-50 text-success-800'
            : 'border-line bg-surface-2 text-secondary-700'
        )}
        data-testid="company-telemetry-status"
      >
        {telemetryOptIn ? (
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-600" aria-hidden="true" />
        ) : (
          <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-secondary-500" aria-hidden="true" />
        )}
        <p>
          {telemetryOptIn
            ? t('company.telemetry.status.enabled')
            : t('company.telemetry.status.disabled')}
        </p>
      </div>

      <p className="text-xs text-secondary-500">{t('company.telemetry.privacy')}</p>

      <button
        type="button"
        onClick={handleToggle}
        disabled={isLoading}
        aria-pressed={telemetryOptIn}
        className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3 text-left transition-colors hover:border-line-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
        data-testid="company-telemetry-toggle"
      >
        <span className="text-sm font-medium text-secondary-900">{toggleLabel}</span>
        <span className={cn('pv-switch', telemetryOptIn && 'on')} aria-hidden="true" />
      </button>
    </section>
  );
}
