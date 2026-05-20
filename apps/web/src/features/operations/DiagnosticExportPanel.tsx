import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileText, Eye } from 'lucide-react';
import JSZip from 'jszip';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { downloadFile } from '@/services/export/exportService';

/**
 * ENG-065c — Operations Center: Diagnostic Export panel.
 *
 * Admin-only bulk export for support tickets. Two flows:
 *
 *   1. "Vista previa" → fires `reports.diagnostics.preview` to size
 *      the bundle before downloading. Surfaces row counts + estimated
 *      size + "rate limit hit" warning.
 *   2. "Descargar ZIP" → fires `reports.diagnostics.export`, builds a
 *      zip via jszip with `manifest.json` + one `<table>.json` per
 *      table, and triggers a Blob download via `URL.createObjectURL`.
 *
 * Manager + cashier sit at the procedure-level FORBIDDEN gate from
 * `adminProcedure`; the panel still renders for them but the CTAs
 * are disabled with translated tooltips so the affordance is
 * visible (operator can still see the count tiles after admin runs
 * the preview, easing handoffs).
 */

type IncludeOutbox = 'sync' | 'fiscal' | 'hardware';

const ALL_OUTBOXES: IncludeOutbox[] = ['sync', 'fiscal', 'hardware'];

function isoDayBounds(daysBack: number): { fromIso: string; toIso: string } {
  const now = new Date();
  const to = new Date(now);
  to.setUTCHours(23, 59, 59, 999);
  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - daysBack + 1);
  from.setUTCHours(0, 0, 0, 0);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

function isoToDateInput(iso: string): string {
  // <input type="date"> wants YYYY-MM-DD in local time. We render the
  // UTC day so the round-trip stays stable regardless of the operator
  // timezone — slightly less intuitive but predictable.
  return iso.slice(0, 10);
}

function dateInputToFromIso(value: string): string {
  return `${value}T00:00:00.000Z`;
}

function dateInputToToIso(value: string): string {
  return `${value}T23:59:59.999Z`;
}

function isDateInputValue(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Fallback filename used only when the server envelope misses
 * `suggestedFilename` (defense in depth — the export procedure should
 * always include it post-ENG-103). Pattern matches the canonical
 * `puntovivo-diagnostic-<slug>-<timestamp>.zip` the server emits.
 */
function buildExportFilenameFallback(tenantSlug: string | undefined): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const slug = (tenantSlug ?? 'tenant').replace(/[^a-z0-9-]/gi, '-');
  return `puntovivo-diagnostic-${slug}-${ts}.zip`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function DiagnosticExportPanel() {
  const { t } = useTranslation('operations');
  const { user } = useAuth();
  const toast = useToast();
  const isAdmin = user?.role === 'admin';

  const initial = useMemo(() => isoDayBounds(7), []);
  const [fromDate, setFromDate] = useState(isoToDateInput(initial.fromIso));
  const [toDate, setToDate] = useState(isoToDateInput(initial.toIso));
  const [activePreset, setActivePreset] = useState<'last7d' | 'last30d' | 'custom'>(
    'last7d'
  );
  const [includeSync, setIncludeSync] = useState(true);
  const [includeFiscal, setIncludeFiscal] = useState(true);
  const [includeHardware, setIncludeHardware] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const fromIso = dateInputToFromIso(fromDate);
  const toIso = dateInputToToIso(toDate);
  const rangeValid =
    isDateInputValue(fromDate) && isDateInputValue(toDate) && fromDate <= toDate;

  const previewQuery = trpc.reports.diagnostics.preview.useQuery(
    { fromDate: fromIso, toDate: toIso },
    {
      enabled: false, // operator-driven; only fires on click
      staleTime: 0,
    }
  );

  const exportQuery = trpc.reports.diagnostics.export.useQuery(
    {
      fromDate: fromIso,
      toDate: toIso,
      includeOutboxes:
        includeSync && includeFiscal && includeHardware
          ? undefined
          : (
              [
                includeSync && 'sync',
                includeFiscal && 'fiscal',
                includeHardware && 'hardware',
              ].filter(Boolean) as IncludeOutbox[]
            ),
    },
    {
      enabled: false, // fires on Descargar click via refetch()
      staleTime: 0,
    }
  );

  function applyPreset(next: 'last7d' | 'last30d' | 'custom'): void {
    setActivePreset(next);
    if (next === 'last7d') {
      const b = isoDayBounds(7);
      setFromDate(isoToDateInput(b.fromIso));
      setToDate(isoToDateInput(b.toIso));
    } else if (next === 'last30d') {
      const b = isoDayBounds(30);
      setFromDate(isoToDateInput(b.fromIso));
      setToDate(isoToDateInput(b.toIso));
    }
    // 'custom' keeps the current values
  }

  async function handleDownload(): Promise<void> {
    if (!isAdmin || !rangeValid) return;
    setDownloading(true);
    try {
      const result = await exportQuery.refetch({ throwOnError: true });
      if (!result.data) return;

      const zip = new JSZip();
      zip.file('manifest.json', JSON.stringify(result.data.manifest, null, 2));
      const tables = result.data.tables;
      for (const [tableName, rows] of Object.entries(tables)) {
        zip.file(`${tableName}.json`, JSON.stringify(rows, null, 2));
      }

      const blob = await zip.generateAsync({ type: 'blob' });
      // ENG-103 — prefer the server-suggested filename so the
      // canonical pattern stays consistent across surfaces; fall back
      // to the local builder only when an older server build leaves
      // the field absent. The centralized `downloadFile` helper
      // handles the anchor + delayed revoke pattern.
      const filename =
        result.data.suggestedFilename ?? buildExportFilenameFallback(user?.tenantId);
      downloadFile(blob, filename);

      toast.success({ title: t('diagnostics.export.success') });
    } catch (error) {
      onErrorToast(toast, t, { titleKey: 'operations:diagnostics.export.error' })(error);
    } finally {
      setDownloading(false);
    }
  }

  const previewData = previewQuery.data;

  return (
    <section className="card p-6 space-y-6">
      <header className="flex items-start gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-100">
          <FileText className="h-5 w-5 text-primary-700" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-secondary-900">
            {t('diagnostics.title')}
          </h2>
          <p className="text-sm text-secondary-500">
            {t('diagnostics.description')}
          </p>
        </div>
      </header>

      <div className="space-y-3">
        <nav
          className="segmented-control inline-flex"
          role="tablist"
          aria-label={t('diagnostics.range.presetsAriaLabel')}
        >
          {(['last7d', 'last30d', 'custom'] as const).map(preset => {
            const selected = activePreset === preset;
            return (
              <button
                key={preset}
                type="button"
                role="tab"
                aria-selected={selected}
                className={`segmented-tab ${selected ? 'segmented-tab-active' : ''}`}
                onClick={() => applyPreset(preset)}
                data-testid={`diagnostics-preset-${preset}`}
              >
                {t(`diagnostics.range.presets.${preset}`)}
              </button>
            );
          })}
        </nav>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-secondary-500">
              {t('diagnostics.range.from')}
            </span>
            <input
              type="date"
              value={fromDate}
              onChange={e => {
                setFromDate(e.target.value);
                setActivePreset('custom');
              }}
              className="mt-1 rounded-lg border border-secondary-200 px-3 py-2 text-secondary-900"
              data-testid="diagnostics-from"
            />
          </label>
          <label className="text-sm">
            <span className="block text-xs uppercase tracking-wide text-secondary-500">
              {t('diagnostics.range.to')}
            </span>
            <input
              type="date"
              value={toDate}
              onChange={e => {
                setToDate(e.target.value);
                setActivePreset('custom');
              }}
              className="mt-1 rounded-lg border border-secondary-200 px-3 py-2 text-secondary-900"
              data-testid="diagnostics-to"
            />
          </label>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2 text-sm"
            disabled={!isAdmin || !rangeValid || previewQuery.isFetching}
            title={!isAdmin ? t('diagnostics.export.noPermission') : undefined}
            onClick={() => void previewQuery.refetch()}
            data-testid="diagnostics-preview-cta"
          >
            <Eye className="h-4 w-4" />
            {t('diagnostics.preview.cta')}
          </button>
        </div>
        {!rangeValid && (
          <p className="text-sm text-danger-700" data-testid="diagnostics-range-error">
            {t('diagnostics.range.invalid')}
          </p>
        )}
      </div>

      {previewQuery.error && (
        <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {translateServerError(previewQuery.error, t, t('common.errorGeneric'))}
        </div>
      )}

      {previewData && (
        <div className="space-y-3">
          <div
            className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4"
            data-testid="diagnostics-preview-results"
          >
            <PreviewTile
              label={t('diagnostics.preview.results.operationEvents')}
              value={previewData.counts.operation_events}
            />
            <PreviewTile
              label={t('diagnostics.preview.results.operationEffects')}
              value={previewData.counts.operation_effects}
            />
            <PreviewTile
              label={t('diagnostics.preview.results.syncOutbox')}
              value={previewData.counts.sync_outbox}
            />
            <PreviewTile
              label={t('diagnostics.preview.results.fiscalOutbox')}
              value={previewData.counts.fiscal_outbox}
            />
            <PreviewTile
              label={t('diagnostics.preview.results.hardwareOutbox')}
              value={previewData.counts.hardware_outbox}
            />
          </div>
          <p className="text-xs text-secondary-500">
            {t('diagnostics.preview.results.estimatedSize', {
              size: formatBytes(previewData.estimatedSizeBytes),
            })}
          </p>
          {previewData.willHitLimit && (
            <div
              className="rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700"
              data-testid="diagnostics-limit-warning"
            >
              {t('diagnostics.preview.willHitLimit', { rowLimit: previewData.rowLimit })}
            </div>
          )}
        </div>
      )}

      <div className="space-y-3 border-t border-secondary-200 pt-4">
        <p className="text-sm font-semibold text-secondary-700">
          {t('diagnostics.includeOutboxes.label')}
        </p>
        <div className="flex flex-wrap gap-4">
          {ALL_OUTBOXES.map(name => {
            const checked =
              name === 'sync' ? includeSync : name === 'fiscal' ? includeFiscal : includeHardware;
            const setter =
              name === 'sync' ? setIncludeSync : name === 'fiscal' ? setIncludeFiscal : setIncludeHardware;
            return (
              <label key={name} className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={e => setter(e.target.checked)}
                  data-testid={`diagnostics-include-${name}`}
                />
                <span>{t(`diagnostics.includeOutboxes.${name}`)}</span>
              </label>
            );
          })}
        </div>

        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2 text-sm"
          disabled={!isAdmin || !rangeValid || downloading}
          title={!isAdmin ? t('diagnostics.export.noPermission') : undefined}
          onClick={() => void handleDownload()}
          data-testid="diagnostics-export-cta"
        >
          <Download className={`h-4 w-4 ${downloading ? 'animate-pulse' : ''}`} />
          {downloading ? t('diagnostics.export.downloading') : t('diagnostics.export.cta')}
        </button>
      </div>
    </section>
  );
}

function PreviewTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-secondary-200 bg-white p-4">
      <p className="text-xs uppercase tracking-wide text-secondary-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-secondary-900">
        {value.toLocaleString()}
      </p>
    </div>
  );
}
