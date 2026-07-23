import { ShieldCheck, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { PageLoadingState } from '@/components/feedback/LoadingState';
import { QueryErrorState } from '@/components/feedback/QueryErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { ConfirmModal } from '@/components/form-controls/Modal';
import { Badge, Button } from '@/components/ui';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
interface RetentionPolicyForm {
  operationalAuditDays: number;
  privacyAuditDays: number;
  aiAuditDays: number;
  syncedOutboxDays: number;
}
type RetentionField = keyof RetentionPolicyForm;
const FIELD_KEYS: readonly RetentionField[] = [
  'operationalAuditDays',
  'privacyAuditDays',
  'aiAuditDays',
  'syncedOutboxDays',
];
export function CompanyDataRetentionCard(): React.ReactElement {
  const { t, i18n } = useTranslation(['dataRetention', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const settingsQuery = trpc.dataRetention.get.useQuery();
  const previewQuery = trpc.dataRetention.preview.useQuery();
  const [policyDraft, setPolicyDraft] = useState<Partial<RetentionPolicyForm>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const policy = settingsQuery.data
    ? {
        ...settingsQuery.data.policy,
        ...policyDraft,
      }
    : null;
  const saveMutation = trpc.dataRetention.update.useMutation({
    onSuccess: async () => {
      toast.success({
        title: t('dataRetention:toast.saved'),
      });
      await Promise.all([
        utils.dataRetention.get.invalidate(),
        utils.dataRetention.preview.invalidate(),
      ]);
      setPolicyDraft({});
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'dataRetention:toast.saveError',
    }),
  });
  const runMutation = trpc.dataRetention.runNow.useMutation({
    onSuccess: async result => {
      setConfirmOpen(false);
      toast.success({
        title: t('dataRetention:toast.swept', {
          count: result.deleted.total,
        }),
      });
      await utils.dataRetention.preview.invalidate();
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'dataRetention:toast.sweepError',
    }),
  });
  const validationError = (() => {
    if (!policy || !settingsQuery.data) return null;
    for (const key of FIELD_KEYS) {
      const limits = settingsQuery.data.limits[key];
      const value = policy[key];
      if (!Number.isInteger(value) || value < limits.min || value > limits.max) {
        return t('dataRetention:validation.range', {
          min: limits.min,
          max: limits.max,
        });
      }
    }
    if (policy.privacyAuditDays < policy.operationalAuditDays) {
      return t('dataRetention:validation.privacyFloor');
    }
    return null;
  })();
  if (settingsQuery.isLoading) {
    return (
      <section className="card p-6">
        <PageLoadingState
          title={t('dataRetention:title')}
          description={t('dataRetention:loading')}
        />
      </section>
    );
  }
  if (settingsQuery.error || !settingsQuery.data || !policy) {
    return (
      <section className="card p-6">
        <QueryErrorState
          title={t('dataRetention:title')}
          message={translateServerError(settingsQuery.error, t, t('errors:server.unknown'))}
          onRetry={() => void settingsQuery.refetch()}
        />
      </section>
    );
  }
  const preview = previewQuery.data;
  const buckets = preview
    ? ([
        ['operationalAuditLogs', preview.operationalAuditLogs],
        ['privacyAuditLogs', preview.privacyAuditLogs],
        ['aiAuditLogs', preview.aiAuditLogs],
        ['syncedOutboxRows', preview.syncedOutboxRows],
      ] as const)
    : [];
  return (
    <section className="card space-y-5 p-6" data-testid="company-data-retention-card">
      <div className="flex items-start gap-3">
        <span className="pv-gt pv-gt-success h-10 w-10">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-lg font-semibold text-secondary-950">{t('dataRetention:title')}</h2>
          <p className="mt-1 text-sm text-secondary-500">{t('dataRetention:description')}</p>
        </div>
      </div>

      <form
        className="space-y-4"
        onSubmit={event => {
          event.preventDefault();
          if (!validationError) void saveMutation.mutateAsync(policy);
        }}
      >
        <div className="grid gap-4 md:grid-cols-2">
          {FIELD_KEYS.map(key => {
            const limits = settingsQuery.data.limits[key];
            const inputId = `retention-${key}`;
            const helpId = `${inputId}-help`;
            return (
              <div key={key}>
                <label htmlFor={inputId} className="label">
                  {t(`dataRetention:fields.${key}.label`)}
                </label>
                <input
                  id={inputId}
                  aria-describedby={helpId}
                  type="number"
                  className="input mt-1"
                  disabled={saveMutation.isPending}
                  min={limits.min}
                  max={limits.max}
                  step={1}
                  value={policy[key]}
                  onChange={event =>
                    setPolicyDraft(current => ({
                      ...current,
                      [key]: Number(event.target.value),
                    }))
                  }
                />
                <span id={helpId} className="mt-1 block text-xs text-secondary-500">
                  {t(`dataRetention:fields.${key}.help`, {
                    min: limits.min,
                    max: limits.max,
                  })}
                </span>
              </div>
            );
          })}
        </div>
        {validationError && (
          <p className="text-sm text-danger-700" role="alert">
            {validationError}
          </p>
        )}
        <Button
          type="submit"
          disabled={saveMutation.isPending || validationError !== null}
          variant="primary"
        >
          {saveMutation.isPending ? t('dataRetention:saving') : t('dataRetention:save')}
        </Button>
      </form>

      <div className="rounded-2xl border border-line bg-surface-2 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-secondary-900">{t('dataRetention:preview.title')}</h3>
            <p className="mt-1 text-sm text-secondary-500">
              {t('dataRetention:preview.description')}
            </p>
          </div>
          <Badge variant="neutral" data-testid="retention-preview-total">
            {previewQuery.isLoading
              ? t('dataRetention:preview.loading')
              : t('dataRetention:preview.total', {
                  count: preview?.total ?? 0,
                })}
          </Badge>
        </div>

        {previewQuery.error && (
          <p className="mt-3 text-sm text-danger-700" role="alert">
            {t('dataRetention:preview.error')}
          </p>
        )}
        {preview && (
          <ul className="mt-4 grid gap-2 text-sm md:grid-cols-2">
            {buckets.map(([key, bucket]) => (
              <li key={key} className="rounded-xl border border-line bg-surface px-3 py-2">
                <span className="font-medium text-secondary-900">
                  {t(`dataRetention:preview.buckets.${key}`)}
                </span>
                <span className="mt-1 block text-secondary-500">
                  {t('dataRetention:preview.bucketDetail', {
                    count: bucket.count,
                    cutoff: new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'medium',
                    }).format(new Date(bucket.cutoff)),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}

        <Button
          type="button"
          className="mt-4"
          disabled={!preview || preview.total === 0 || runMutation.isPending}
          onClick={() => setConfirmOpen(true)}
          variant="danger"
        >
          <Trash2 aria-hidden="true" />
          {t('dataRetention:runNow')}
        </Button>
      </div>

      <p className="text-xs text-secondary-500">{t('dataRetention:legalHold')}</p>

      <ConfirmModal
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void runMutation.mutateAsync()}
        title={t('dataRetention:confirm.title')}
        message={t('dataRetention:confirm.message', {
          count: preview?.total ?? 0,
        })}
        confirmText={t('dataRetention:confirm.cta')}
        loading={runMutation.isPending}
        variant="danger"
      />
    </section>
  );
}
