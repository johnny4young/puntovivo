// ENG-102 — per-site monthly AI quota panel, extracted from
// CompanyAISettingsCard.tsx (ENG-178 slice 34). Presentational: the card gates
// the render (AI on + both quota keys present) and passes the quota shape.

import { useTranslation } from 'react-i18next';

/** One feature's monthly usage window. `resetsAt` is an ISO date (the calendar
 *  rollover boundary) or null when the server has no window yet. */
interface AiQuotaUsage {
  used: number;
  limit: number;
  resetsAt: string | null;
}

interface AiQuotaSectionProps {
  quotas: {
    copilot: AiQuotaUsage;
    invoiceOcr: AiQuotaUsage;
  };
}

export function AiQuotaSection({ quotas }: AiQuotaSectionProps) {
  const { t } = useTranslation('aiSettings');
  return (
    <div className="space-y-3 rounded-2xl bg-surface-2 p-4" data-testid="ai-quota-section">
      <p className="text-sm font-medium text-fg2">{t('aiSettings:card.quotas.title')}</p>
      {(['copilot', 'invoiceOcr'] as const).map(feature => {
        const q = quotas[feature];
        // Defensive guard — the outer condition already pins both
        // keys, but future server-side shape evolution might drop
        // a feature key. Skip the row instead of crashing the card.
        if (!q) return null;
        const ratio = q.limit > 0 ? q.used / q.limit : 0;
        const tone = ratio >= 1 ? 'danger' : ratio >= 0.8 ? 'warning' : 'success';
        const barColor =
          tone === 'danger'
            ? 'bg-danger-600'
            : tone === 'warning'
              ? 'bg-warning-500'
              : 'bg-success-600';
        const labelColor =
          tone === 'danger'
            ? 'text-danger-700'
            : tone === 'warning'
              ? 'text-warning-700'
              : 'text-fg2';
        const width = Math.min(100, Math.round(ratio * 100));
        const valueText = t('aiSettings:card.quotas.usedOfLimit', {
          used: q.used,
          limit: q.limit,
        });
        return (
          <div key={feature} className="space-y-1.5" data-testid={`ai-quota-${feature}`}>
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-medium text-fg2">
                {t(`aiSettings:card.quotas.${feature}.label`)}
              </span>
              <span className={`font-mono text-xs tabular-nums ${labelColor}`}>{valueText}</span>
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-valuenow={width}
              aria-valuemin={0}
              aria-valuemax={100}
              // aria-valuetext announces the raw count so screen
              // readers say "100 / 800" instead of "12%". The
              // progressbar's numeric meaning (percent) is not
              // self-describing without the count.
              aria-valuetext={valueText}
              aria-label={t(`aiSettings:card.quotas.${feature}.label`)}
              data-testid={`ai-quota-${feature}-bar`}
              data-tone={tone}
            >
              <div className={`h-full rounded-full ${barColor}`} style={{ width: `${width}%` }} />
            </div>
          </div>
        );
      })}
      {/*
        Reset date footer reads from the copilot quota because
        v1 has all features reset on the same calendar boundary
        (server-side `monthBounds` snapshot). If a future ticket
        decouples per-feature windows, move this into each row.
      */}
      <p className="text-xs text-fg3">
        {t('aiSettings:card.quotas.resetHint', {
          date: quotas.copilot.resetsAt ? quotas.copilot.resetsAt.slice(0, 10) : '—',
        })}
      </p>
    </div>
  );
}
