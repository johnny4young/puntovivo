import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/feedback/ToastProvider';
import { cn } from '@/lib/utils';
import { onErrorToast } from '@/lib/mutationHelpers';

type FeatureKey = 'copilot' | 'anomalies' | 'semanticSearch' | 'invoiceOcr';

const PROVIDER_OPTIONS = [
  { value: 'textract', label: 'AWS Textract', available: true },
  { value: 'docai', label: 'Google Document AI', available: false },
  { value: 'azure', label: 'Azure Form Recognizer', available: false },
] as const;

export default function AiConfigPage() {
  const { t } = useTranslation(['aiShared', 'aiSettings', 'common', 'auditLogs']);
  const toast = useToast();
  const utils = trpc.useUtils();

  const settingsQuery = trpc.ai.settings.get.useQuery();
  const auditQuery = trpc.auditLogs.list.useQuery(
    { limit: 50 },
    { staleTime: 30_000 }
  );

  const updateMutation = trpc.ai.settings.update.useMutation({
    onSuccess: async () => {
      await utils.ai.settings.get.invalidate();
      toast.success({
        title: t('aiSettings:toast.saveSuccessTitle'),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'common:status.error' }),
  });

  const features = settingsQuery.data?.features;
  const ocrProvider = features?.invoiceOcr.provider ?? 'textract';

  const switches: Array<{ key: FeatureKey; enabledTitleKey: string; disabledTitleKey: string; subtitleKey: string }> = useMemo(
    () => [
      {
        key: 'copilot',
        enabledTitleKey: 'aiShared:enabled.copilot.title',
        disabledTitleKey: 'aiShared:disabled.copilot.title',
        subtitleKey: 'aiShared:disabled.copilot.subtitle',
      },
      {
        key: 'anomalies',
        enabledTitleKey: 'aiShared:enabled.anomalies.title',
        disabledTitleKey: 'aiShared:disabled.anomalies.title',
        subtitleKey: 'aiShared:disabled.anomalies.subtitle',
      },
      {
        key: 'semanticSearch',
        enabledTitleKey: 'aiShared:enabled.semanticSearch.title',
        disabledTitleKey: 'aiShared:disabled.semanticSearch.title',
        subtitleKey: 'aiShared:disabled.semanticSearch.subtitle',
      },
      {
        key: 'invoiceOcr',
        enabledTitleKey: 'aiShared:enabled.invoiceOcr.title',
        disabledTitleKey: 'aiShared:disabled.invoiceOcr.title',
        subtitleKey: 'aiShared:disabled.invoiceOcr.subtitle',
      },
    ],
    []
  );

  const handleToggle = (feature: FeatureKey, enabled: boolean) => {
    if (feature === 'copilot' || feature === 'semanticSearch' || feature === 'invoiceOcr') {
      updateMutation.mutate({ enabled: enabled ? true : undefined, features: { [feature]: { enabled } } });
    } else if (feature === 'anomalies') {
      updateMutation.mutate({ enabled: enabled ? true : undefined, features: { anomalies: { enabled } } });
    }
  };

  const handleProviderChange = (provider: 'textract' | 'docai' | 'azure') => {
    updateMutation.mutate({ features: { invoiceOcr: { provider } } });
  };

  const aiAuditRows = (auditQuery.data?.items ?? []).filter(row =>
    row.action.startsWith('ai.')
  );

  return (
    <div className="space-y-6">
      <section className="card p-6 sm:p-8">
        <div>
          <p className="page-kicker">{t('aiShared:disabled.role')}</p>
          <h1 className="mt-1 font-display text-3xl tracking-[-0.02em] text-secondary-950">
            {t('aiSettings:card.title')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-secondary-600">
            {t('aiSettings:card.description')}
          </p>
        </div>
      </section>

      <section className="card p-6 sm:p-8">
        <h2 className="font-display text-xl tracking-[-0.02em] text-secondary-950">
          {t('aiSettings:card.featuresTitle')}
        </h2>
        <p className="mt-1 text-sm text-secondary-600">
          {t('aiShared:privacy.redaction')}
        </p>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {switches.map(({ key, enabledTitleKey, disabledTitleKey, subtitleKey }) => {
            const enabled = Boolean(features?.[key]?.enabled);
            return (
              <button
                key={key}
                type="button"
                onClick={() => handleToggle(key, !enabled)}
                disabled={updateMutation.isPending || !settingsQuery.data}
                className={cn(
                  'flex items-start gap-3 rounded-2xl border bg-surface p-4 text-left transition-colors',
                  enabled ? 'border-primary/40 bg-primary-50/30' : 'border-line/80 hover:border-primary/30',
                  updateMutation.isPending && 'cursor-wait opacity-70'
                )}
                aria-pressed={enabled}
              >
                <span
                  className={cn(
                    'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                    enabled ? 'bg-primary-100 text-primary-700' : 'bg-secondary-100 text-secondary-500'
                  )}
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-secondary-950">
                    {t(enabled ? enabledTitleKey : disabledTitleKey)}
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-secondary-600">
                    {t(subtitleKey)}
                  </span>
                </span>
                <span
                  className={cn(
                    'badge',
                    enabled ? 'badge-success' : 'badge-secondary'
                  )}
                >
                  {enabled
                    ? t('common:status.active', { defaultValue: 'On' })
                    : t('common:status.inactive', { defaultValue: 'Off' })}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-6 rounded-2xl border border-line/70 bg-surface-2/40 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-secondary-500">
            {t('aiSettings:card.providerLabel')}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {PROVIDER_OPTIONS.map(opt => {
              const locked = !opt.available;
              const isActive = ocrProvider === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => !locked && handleProviderChange(opt.value)}
                  disabled={locked || updateMutation.isPending || !settingsQuery.data}
                  aria-disabled={locked}
                  title={
                    locked
                      ? t('aiSettings:card.providerLocked')
                      : undefined
                  }
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                    isActive
                      ? 'border-primary bg-primary-50 text-primary-700'
                      : locked
                        ? 'cursor-not-allowed border-line/40 bg-surface-2/40 text-secondary-400'
                        : 'border-line/70 bg-surface text-secondary-600 hover:border-primary/40'
                  )}
                >
                  {opt.label}
                  {locked && (
                    <span className="rounded-full border border-line/60 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-secondary-500">
                      {t('aiSettings:card.providerComingSoon')}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-secondary-500">
            {t('aiSettings:card.providerHint')}
          </p>
        </div>
      </section>

      <section className="card p-6 sm:p-8">
        <h2 className="font-display text-xl tracking-[-0.02em] text-secondary-950">
          {t('aiShared:audit.title')}
        </h2>
        <p className="mt-1 text-sm text-secondary-600">{t('aiShared:audit.subtitle')}</p>
        <div className="mt-4 overflow-hidden rounded-2xl border border-line/70">
          <table className="min-w-full divide-y divide-line/60 text-sm">
            <thead className="bg-surface-2/60 text-xs uppercase tracking-wide text-secondary-500">
              <tr>
                <th className="px-3 py-2 text-left">{t('aiShared:audit.columns.occurredAt')}</th>
                <th className="px-3 py-2 text-left">{t('aiShared:audit.columns.actor')}</th>
                <th className="px-3 py-2 text-left">{t('aiShared:audit.columns.action')}</th>
                <th className="px-3 py-2 text-right">{t('aiShared:audit.columns.cost')}</th>
                <th className="px-3 py-2 text-right">{t('aiShared:audit.columns.latency')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60 bg-card">
              {aiAuditRows.length === 0 ? (
                <tr>
                  <td className="px-3 py-6 text-center text-secondary-500" colSpan={5}>
                    {t('aiShared:audit.empty')}
                  </td>
                </tr>
              ) : (
                aiAuditRows.map(row => {
                  const meta = (row.metadata ?? {}) as Record<string, unknown>;
                  const costUsd = typeof meta.costUsd === 'number' ? meta.costUsd : null;
                  const latencyMs = typeof meta.latencyMs === 'number' ? meta.latencyMs : null;
                  return (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-mono text-xs text-secondary-700">
                        {new Date(row.createdAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-secondary-800">{row.actorId}</td>
                      <td className="px-3 py-2 font-mono text-xs text-secondary-800">
                        {row.action}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-secondary-700">
                        {costUsd != null ? `$${costUsd.toFixed(4)}` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-secondary-700">
                        {latencyMs != null ? `${latencyMs} ms` : '—'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
