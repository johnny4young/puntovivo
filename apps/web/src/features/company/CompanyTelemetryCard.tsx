import { CloudUpload, ShieldCheck, ShieldOff } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { trpc } from '@/lib/trpc';
import { onErrorToast } from '@/lib/mutationHelpers';

/**
 * ENG-135 — Per-tenant telemetry opt-in toggle.
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
        title: next
          ? t('company.telemetry.toast.enabled')
          : t('company.telemetry.toast.disabled'),
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

  return (
    <section
      className="card p-6 space-y-5"
      data-testid="company-telemetry-card"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <CloudUpload className="h-5 w-5 text-primary-700" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">
            {t('company.telemetry.title')}
          </h2>
          <p className="text-sm text-secondary-500">
            {t('company.telemetry.description')}
          </p>
        </div>
      </div>

      <div
        className={
          telemetryOptIn
            ? 'rounded-xl border border-success-200 bg-success-50 px-4 py-3 text-sm text-success-800'
            : 'rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-secondary-700'
        }
        data-testid="company-telemetry-status"
      >
        <div className="flex items-start gap-2">
          {telemetryOptIn ? (
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
          ) : (
            <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-secondary-500" />
          )}
          <p>
            {telemetryOptIn
              ? t('company.telemetry.status.enabled')
              : t('company.telemetry.status.disabled')}
          </p>
        </div>
      </div>

      <p className="text-xs text-secondary-500">
        {t('company.telemetry.privacy')}
      </p>

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          onClick={handleToggle}
          disabled={isLoading}
          className={
            telemetryOptIn
              ? 'btn-outline flex items-center justify-center gap-2'
              : 'btn-primary flex items-center justify-center gap-2'
          }
          data-testid="company-telemetry-toggle"
        >
          {telemetryOptIn ? (
            <ShieldOff className="h-4 w-4" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          {updateMutation.isPending
            ? t('company.telemetry.pending')
            : telemetryOptIn
              ? t('company.telemetry.disable')
              : t('company.telemetry.enable')}
        </button>
      </div>
    </section>
  );
}
