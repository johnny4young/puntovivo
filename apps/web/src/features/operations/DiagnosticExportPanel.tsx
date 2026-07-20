import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Database, Download, Eye, HardDrive } from 'lucide-react';
import JSZip from 'jszip';
import { trpc } from '@/lib/trpc';
import { useAuth } from '@/features/auth/AuthProvider';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { translateServerError } from '@/lib/translateServerError';
import { downloadFile } from '@/services/export/exportService';

/**
 * Operations Center: Diagnostic Export panel.
 *
 * Admin-only bulk export for support tickets. Two flows:
 *
 * 1. "Vista previa" → fires `reports.diagnostics.preview` to size
 * the bundle before downloading. Surfaces row counts + estimated
 * size + "rate limit hit" warning.
 * 2. "Descargar ZIP" → fires `reports.diagnostics.export`, builds a
 * zip via jszip with `manifest.json` + one `<table>.json` per
 * table, and triggers a Blob download via `URL.createObjectURL`.
 *
 * Manager + cashier sit at the procedure-level FORBIDDEN gate from
 * `adminProcedure`; the panel still renders for them but the CTAs
 * are disabled with translated tooltips so the affordance is
 * visible (operator can still see the count tiles after admin runs
 * the preview, easing handoffs).
 *
 * recetas pv-*: la vista previa se presenta
 * como una lista de chequeos con estado tonal (`.pv-check`, ok /
 * atención) en lugar de logs crudos, el rango usa el segmentado
 * `.pv-seg` y los campos de fecha la receta `.pv-field` / `.pv-input`.
 * Encabezado de panel con `.pv-kicker` / `.pv-title`, controles con
 * `.pv-btn` y la inclusión de bitácoras con `.pv-switch`.
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
 * always include it post-). Pattern matches the canonical
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
  const [activePreset, setActivePreset] = useState<'last7d' | 'last30d' | 'custom'>('last7d');
  const [includeSync, setIncludeSync] = useState(true);
  const [includeFiscal, setIncludeFiscal] = useState(true);
  const [includeHardware, setIncludeHardware] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const fromIso = dateInputToFromIso(fromDate);
  const toIso = dateInputToToIso(toDate);
  const rangeValid = isDateInputValue(fromDate) && isDateInputValue(toDate) && fromDate <= toDate;

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
          : ([
              includeSync && 'sync',
              includeFiscal && 'fiscal',
              includeHardware && 'hardware',
            ].filter(Boolean) as IncludeOutbox[]),
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
      // prefer the server-suggested filename so the
      // canonical pattern stays consistent across surfaces; fall back
      // to the local builder only when an older server build leaves
      // the field absent. The centralized `downloadFile` helper
      // handles the anchor + delayed revoke pattern.
      const filename = result.data.suggestedFilename ?? buildExportFilenameFallback(user?.tenantId);
      downloadFile(blob, filename);

      toast.success({ title: t('diagnostics.export.success') });
    } catch (error) {
      onErrorToast(toast, t, { titleKey: 'operations:diagnostics.export.error' })(error);
    } finally {
      setDownloading(false);
    }
  }

  const previewData = previewQuery.data;

  const previewChecks = previewData
    ? [
        {
          key: 'operationEvents',
          label: t('diagnostics.preview.results.operationEvents'),
          count: previewData.counts.operation_events,
        },
        {
          key: 'operationEffects',
          label: t('diagnostics.preview.results.operationEffects'),
          count: previewData.counts.operation_effects,
        },
        {
          key: 'syncOutbox',
          label: t('diagnostics.preview.results.syncOutbox'),
          count: previewData.counts.sync_outbox,
        },
        {
          key: 'fiscalOutbox',
          label: t('diagnostics.preview.results.fiscalOutbox'),
          count: previewData.counts.fiscal_outbox,
        },
        {
          key: 'hardwareOutbox',
          label: t('diagnostics.preview.results.hardwareOutbox'),
          count: previewData.counts.hardware_outbox,
        },
      ]
    : [];

  return (
    <section className="card p-6 space-y-6">
      <header>
        <p className="pv-kicker">{t('diagnostics.kicker')}</p>
        <h2 className="pv-title text-2xl">{t('diagnostics.title')}</h2>
        <p className="mt-2 text-sm text-secondary-500">{t('diagnostics.description')}</p>
      </header>

      <div className="space-y-3">
        <div className="pv-seg" role="tablist" aria-label={t('diagnostics.range.presetsAriaLabel')}>
          {(['last7d', 'last30d', 'custom'] as const).map(preset => {
            const selected = activePreset === preset;
            return (
              <button
                key={preset}
                type="button"
                role="tab"
                aria-selected={selected}
                className={selected ? 'on' : ''}
                onClick={() => applyPreset(preset)}
                data-testid={`diagnostics-preset-${preset}`}
              >
                {t(`diagnostics.range.presets.${preset}`)}
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <label className="pv-field">
            <span className="lab">{t('diagnostics.range.from')}</span>
            <span className="pv-input">
              <input
                type="date"
                value={fromDate}
                onChange={e => {
                  setFromDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="w-full border-0 bg-transparent p-0 text-secondary-900 focus:outline-none focus:ring-0"
                data-testid="diagnostics-from"
              />
            </span>
          </label>
          <label className="pv-field">
            <span className="lab">{t('diagnostics.range.to')}</span>
            <span className="pv-input">
              <input
                type="date"
                value={toDate}
                onChange={e => {
                  setToDate(e.target.value);
                  setActivePreset('custom');
                }}
                className="w-full border-0 bg-transparent p-0 text-secondary-900 focus:outline-none focus:ring-0"
                data-testid="diagnostics-to"
              />
            </span>
          </label>
          <button
            type="button"
            className="pv-btn outline"
            disabled={!isAdmin || !rangeValid || previewQuery.isFetching}
            title={!isAdmin ? t('diagnostics.export.noPermission') : undefined}
            onClick={() => void previewQuery.refetch()}
            data-testid="diagnostics-preview-cta"
          >
            <Eye />
            {t('diagnostics.preview.cta')}
          </button>
        </div>
        {!rangeValid && (
          <p className="text-sm font-medium text-danger-700" data-testid="diagnostics-range-error">
            {t('diagnostics.range.invalid')}
          </p>
        )}
      </div>

      {previewQuery.error && (
        <div className="pv-strip danger">
          <span className="msg">
            {translateServerError(previewQuery.error, t, t('common.errorGeneric'))}
          </span>
        </div>
      )}

      {previewData && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary-500">
            {t('diagnostics.preview.checksTitle')}
          </p>
          <div
            className="rounded-2xl border border-line/70 bg-surface-2/55 px-4"
            data-testid="diagnostics-preview-results"
          >
            {previewChecks.map(check => {
              const hasRows = check.count > 0;
              return (
                <div key={check.key} className="pv-check">
                  <span className={`ic ${hasRows ? 'done' : 'opt'}`}>
                    {hasRows ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <Database className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="t">{check.label}</p>
                    <p className="d">{t('diagnostics.preview.rowCount', { count: check.count })}</p>
                  </div>
                  <span className="font-mono text-sm font-semibold tabular-nums text-secondary-900">
                    {check.count.toLocaleString()}
                  </span>
                </div>
              );
            })}
            <div className="pv-check">
              <span className="ic opt">
                <HardDrive className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="t">{t('diagnostics.preview.estimatedSizeLabel')}</p>
                <p className="d">{t('diagnostics.preview.estimatedSizeHelp')}</p>
              </div>
              <span className="font-mono text-sm font-semibold tabular-nums text-secondary-900">
                {formatBytes(previewData.estimatedSizeBytes)}
              </span>
            </div>
          </div>
          {previewData.willHitLimit && (
            <div className="pv-strip danger" data-testid="diagnostics-limit-warning">
              <span className="ic">
                <AlertTriangle className="h-4 w-4" />
              </span>
              <span className="msg">
                {t('diagnostics.preview.willHitLimit', { rowLimit: previewData.rowLimit })}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="space-y-3 border-t border-line/70 pt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-secondary-500">
          {t('diagnostics.includeOutboxes.label')}
        </p>
        <div className="flex flex-wrap gap-x-6 gap-y-3">
          {ALL_OUTBOXES.map(name => {
            const checked =
              name === 'sync' ? includeSync : name === 'fiscal' ? includeFiscal : includeHardware;
            const setter =
              name === 'sync'
                ? setIncludeSync
                : name === 'fiscal'
                  ? setIncludeFiscal
                  : setIncludeHardware;
            return (
              <label
                key={name}
                className="inline-flex cursor-pointer items-center gap-3 text-sm text-secondary-700"
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={e => setter(e.target.checked)}
                  data-testid={`diagnostics-include-${name}`}
                />
                <span className={`pv-switch ${checked ? 'on' : ''}`} aria-hidden="true" />
                <span>{t(`diagnostics.includeOutboxes.${name}`)}</span>
              </label>
            );
          })}
        </div>

        <button
          type="button"
          className="pv-btn primary"
          disabled={!isAdmin || !rangeValid || downloading}
          title={!isAdmin ? t('diagnostics.export.noPermission') : undefined}
          onClick={() => void handleDownload()}
          data-testid="diagnostics-export-cta"
        >
          <Download className={downloading ? 'animate-pulse' : ''} />
          {downloading ? t('diagnostics.export.downloading') : t('diagnostics.export.cta')}
        </button>
      </div>
    </section>
  );
}
