import { useState } from 'react';
import { AlertTriangle, Printer, Thermometer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { Badge, Button } from '@/components/ui';
import { useTenant } from '@/features/tenant/TenantProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { AUTO_PRINT_SCRIPT, escapeHtml, printHtmlDocument } from '@/lib/receiptDocumentPrint';
import { trpc } from '@/lib/trpc';
import { useCriticalMutation } from '@/lib/useCriticalMutation';

interface PharmacyEnvironmentalPanelProps {
  businessDate: string;
}

export function PharmacyEnvironmentalPanel({ businessDate }: PharmacyEnvironmentalPanelProps) {
  const { t } = useTranslation(['pharmacy', 'pharmacyErrors', 'errors']);
  const { currentSite } = useTenant();
  const toast = useToast();
  const utils = trpc.useUtils();

  const [period, setPeriod] = useState<'morning' | 'afternoon'>('morning');
  const [zone, setZone] = useState<'ambient' | 'refrigerator'>('ambient');
  const [temperatureC, setTemperatureC] = useState('');
  const [humidityPercent, setHumidityPercent] = useState('');
  const [instrumentCode, setInstrumentCode] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [notes, setNotes] = useState('');

  const [fromDate, setFromDate] = useState(`${businessDate.slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(businessDate);
  const [onlyDeviations, setOnlyDeviations] = useState(false);

  const validDateRange =
    /^\d{4}-\d{2}-\d{2}$/.test(fromDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(toDate) &&
    fromDate <= toDate;

  const logsQuery = trpc.pharmacy.listEnvironmentalLogs.useQuery(
    {
      siteId: currentSite?.id ?? undefined,
      fromDate,
      toDate,
      onlyDeviations: onlyDeviations || undefined,
      page: 1,
      perPage: 50,
    },
    { enabled: !!currentSite?.id && validDateRange }
  );

  const reportQuery = trpc.pharmacy.getEnvironmentalReport.useQuery(
    {
      siteId: currentSite?.id ?? undefined,
      fromDate,
      toDate,
    },
    { enabled: !!currentSite?.id && validDateRange }
  );

  const recordLog = useCriticalMutation('pharmacy.recordEnvironmentalLog', {
    onSuccess: async data => {
      await Promise.all([
        utils.pharmacy.listEnvironmentalLogs.invalidate(),
        utils.pharmacy.getEnvironmentalReport.invalidate(),
      ]);
      setTemperatureC('');
      setHumidityPercent('');
      setCorrectiveAction('');
      setNotes('');
      if (data.isOutOfRange) {
        toast.warning({ title: t('pharmacy:environmental.toast.deviationWarning') });
      } else {
        toast.success({ title: t('pharmacy:environmental.toast.recorded') });
      }
    },
    onError: onErrorToast(toast, t, { titleKey: 'pharmacy:environmental.toast.error' }),
  });

  const parsedTemp = Number(temperatureC);
  const parsedHumidity = humidityPercent.trim() ? Number(humidityPercent) : null;
  const previewOutOfRange =
    temperatureC.trim() !== '' &&
    Number.isFinite(parsedTemp) &&
    (zone === 'ambient'
      ? parsedTemp < 15 ||
        parsedTemp > 30 ||
        (parsedHumidity !== null && Number.isFinite(parsedHumidity) && parsedHumidity > 70)
      : parsedTemp < 2 || parsedTemp > 8);

  const canSubmit =
    Boolean(currentSite?.id) &&
    temperatureC.trim() !== '' &&
    Number.isFinite(parsedTemp) &&
    (zone === 'refrigerator' ||
      (humidityPercent.trim() !== '' &&
        parsedHumidity !== null &&
        Number.isFinite(parsedHumidity))) &&
    !recordLog.isPending;

  async function handlePrintReport() {
    const report = reportQuery.data;
    if (!report) return;
    const rowsHtml = report.readings
      .map(
        r => `<tr>
          <td>${escapeHtml(r.businessDate)} (${escapeHtml(t(`pharmacy:environmental.periods.${r.period}`))})</td>
          <td>${escapeHtml(r.zone === 'ambient' ? t('pharmacy:environmental.summaryAmbient') : t('pharmacy:environmental.summaryRefrigerator'))}</td>
          <td>${r.temperatureC.toFixed(1)} °C${r.humidityPercent !== null ? ` / ${r.humidityPercent.toFixed(0)}%` : ''}</td>
          <td>${escapeHtml(r.isOutOfRange ? t('pharmacy:environmental.outOfRange') : t('pharmacy:environmental.inRange'))}</td>
          <td>${escapeHtml(r.correctiveAction ?? '—')}</td>
          <td>${escapeHtml(r.recordedByName)}</td>
        </tr>`
      )
      .join('');
    try {
      await printHtmlDocument({
        buildHtml: ({ autoPrint }) =>
          `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(t('pharmacy:environmental.title'))}</title>
          <style>body{font-family:system-ui,sans-serif;padding:20px;color:#111}h1{font-size:18px;margin:0 0 6px}p{margin:2px 0;font-size:12px}
          table{width:100%;border-collapse:collapse;margin-top:14px;font-size:12px}th,td{border:1px solid #cbd5e1;padding:6px;text-align:left}th{background:#f1f5f9}</style>
          </head><body>
          <h1>${escapeHtml(t('pharmacy:environmental.title'))} — ${escapeHtml(report.standard)}</h1>
          <p>${escapeHtml(report.siteName)}${report.companyName ? ` · ${escapeHtml(report.companyName)}` : ''}${report.companyTaxId ? ` · ${escapeHtml(report.companyTaxId)}` : ''}</p>
          <p>${escapeHtml(report.fromDate)} → ${escapeHtml(report.toDate)} · ${escapeHtml(t('pharmacy:environmental.summaryTotal'))}: ${report.totalReadings} · ${escapeHtml(t('pharmacy:environmental.summaryDeviations'))}: ${report.deviationCount}</p>
          <table><thead><tr><th>${escapeHtml(t('pharmacy:environmental.columns.date'))}</th><th>${escapeHtml(t('pharmacy:environmental.columns.zone'))}</th><th>${escapeHtml(t('pharmacy:environmental.columns.reading'))}</th><th>${escapeHtml(t('pharmacy:environmental.columns.status'))}</th><th>${escapeHtml(t('pharmacy:environmental.columns.action'))}</th><th>${escapeHtml(t('pharmacy:fractionation.columns.actor'))}</th></tr></thead><tbody>${rowsHtml}</tbody></table>
          ${autoPrint ? AUTO_PRINT_SCRIPT : ''}</body></html>`,
        createError: (_code, message) => new Error(message),
        desktopBridgeFailedMessage: t('pharmacy:environmental.toast.error'),
        unknownErrorMessage: t('pharmacy:environmental.toast.error'),
        cancelledDialogIsSuccess: true,
        windowFeatures: 'noopener,noreferrer,width=900,height=720',
      });
    } catch (err) {
      toast.error({
        title: t('pharmacy:environmental.toast.error'),
        description: err instanceof Error ? err.message : undefined,
      });
    }
  }

  return (
    <div
      className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
      data-testid="pharmacy-environmental-panel"
    >
      <section className="card space-y-4 p-5">
        <div className="flex items-center gap-2.5">
          <Thermometer className="h-5 w-5 text-primary-700" aria-hidden="true" />
          <h3 className="font-semibold text-secondary-950">{t('pharmacy:environmental.title')}</h3>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="pv-field">
            <label className="label" htmlFor="pharmacy-env-period">
              {t('pharmacy:environmental.period')}
            </label>
            <select
              id="pharmacy-env-period"
              data-testid="pharmacy-env-period"
              className="pv-input"
              value={period}
              onChange={e => setPeriod(e.target.value as 'morning' | 'afternoon')}
            >
              <option value="morning">{t('pharmacy:environmental.periods.morning')}</option>
              <option value="afternoon">{t('pharmacy:environmental.periods.afternoon')}</option>
            </select>
          </div>
          <div className="pv-field">
            <label className="label" htmlFor="pharmacy-env-zone">
              {t('pharmacy:environmental.zone')}
            </label>
            <select
              id="pharmacy-env-zone"
              data-testid="pharmacy-env-zone"
              className="pv-input"
              value={zone}
              onChange={e => setZone(e.target.value as 'ambient' | 'refrigerator')}
            >
              <option value="ambient">{t('pharmacy:environmental.zones.ambient')}</option>
              <option value="refrigerator">{t('pharmacy:environmental.zones.refrigerator')}</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="pv-field">
            <label className="label" htmlFor="pharmacy-env-temp">
              {t('pharmacy:environmental.temperature')}
            </label>
            <input
              id="pharmacy-env-temp"
              data-testid="pharmacy-env-temp"
              type="number"
              step="0.1"
              className="pv-input"
              value={temperatureC}
              onChange={e => setTemperatureC(e.target.value)}
            />
          </div>
          <div className="pv-field">
            <label className="label" htmlFor="pharmacy-env-humidity">
              {t('pharmacy:environmental.humidity')}
            </label>
            <input
              id="pharmacy-env-humidity"
              data-testid="pharmacy-env-humidity"
              type="number"
              step="1"
              min="0"
              max="100"
              className="pv-input"
              value={humidityPercent}
              onChange={e => setHumidityPercent(e.target.value)}
            />
          </div>
        </div>

        {previewOutOfRange && (
          <div
            className="flex items-start gap-2 rounded-xl border border-danger-300 bg-danger-50 p-3 text-xs font-medium text-danger-900"
            role="alert"
            data-testid="pharmacy-env-out-of-range-alert"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{t('pharmacy:environmental.outOfRangePreview')}</span>
          </div>
        )}

        <div className="pv-field">
          <label className="label" htmlFor="pharmacy-env-instrument">
            {t('pharmacy:environmental.instrumentCode')}
          </label>
          <input
            id="pharmacy-env-instrument"
            className="pv-input"
            value={instrumentCode}
            placeholder={t('pharmacy:environmental.instrumentPlaceholder')}
            onChange={e => setInstrumentCode(e.target.value)}
          />
        </div>

        <div className="pv-field">
          <label className="label" htmlFor="pharmacy-env-action">
            {t('pharmacy:environmental.correctiveAction')}
          </label>
          <input
            id="pharmacy-env-action"
            data-testid="pharmacy-env-action"
            className="pv-input"
            value={correctiveAction}
            placeholder={t('pharmacy:environmental.correctivePlaceholder')}
            onChange={e => setCorrectiveAction(e.target.value)}
          />
        </div>

        <Button
          type="button"
          data-testid="pharmacy-env-submit"
          disabled={!canSubmit}
          onClick={() => {
            if (!canSubmit || !currentSite) return;
            recordLog.mutate({
              siteId: currentSite.id,
              businessDate,
              period,
              zone,
              temperatureC: parsedTemp,
              humidityPercent: parsedHumidity,
              instrumentCode: instrumentCode.trim() || null,
              correctiveAction: correctiveAction.trim() || null,
              notes: notes.trim() || null,
            });
          }}
        >
          {t('pharmacy:environmental.submit')}
        </Button>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="pv-field">
              <label className="label" htmlFor="pharmacy-env-from">
                {t('pharmacy:environmental.fromDate')}
              </label>
              <input
                id="pharmacy-env-from"
                type="date"
                className="pv-input"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
              />
            </div>
            <div className="pv-field">
              <label className="label" htmlFor="pharmacy-env-to">
                {t('pharmacy:environmental.toDate')}
              </label>
              <input
                id="pharmacy-env-to"
                type="date"
                className="pv-input"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
              />
            </div>
            <label className="inline-flex min-h-10 items-center gap-2 text-sm text-secondary-700">
              <input
                type="checkbox"
                checked={onlyDeviations}
                onChange={e => setOnlyDeviations(e.target.checked)}
              />
              {t('pharmacy:environmental.onlyDeviations')}
            </label>
          </div>
          <Button
            type="button"
            variant="outline"
            data-testid="pharmacy-env-print"
            disabled={!reportQuery.data || reportQuery.data.totalReadings === 0}
            onClick={() => void handlePrintReport()}
          >
            <Printer className="h-4 w-4" aria-hidden="true" />
            {t('pharmacy:environmental.printReport')}
          </Button>
        </div>

        {reportQuery.data && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-secondary-200 p-3">
              <p className="text-xs text-secondary-500">
                {t('pharmacy:environmental.summaryTotal')}
              </p>
              <p className="mt-1 text-lg font-semibold text-secondary-950">
                {reportQuery.data.totalReadings}
              </p>
            </div>
            <div className="rounded-xl border border-secondary-200 p-3">
              <p className="text-xs text-secondary-500">
                {t('pharmacy:environmental.summaryDeviations')}
              </p>
              <p
                className="mt-1 text-lg font-semibold text-danger-700"
                data-testid="pharmacy-env-deviation-count"
              >
                {reportQuery.data.deviationCount}
              </p>
            </div>
            <div className="rounded-xl border border-secondary-200 p-3">
              <p className="text-xs text-secondary-500">
                {t('pharmacy:environmental.summaryAmbient')}
              </p>
              <p className="mt-1 text-sm font-semibold text-secondary-900">
                {reportQuery.data.ambient.minTempC !== null
                  ? `${reportQuery.data.ambient.minTempC}–${reportQuery.data.ambient.maxTempC} °C`
                  : '—'}
              </p>
            </div>
            <div className="rounded-xl border border-secondary-200 p-3">
              <p className="text-xs text-secondary-500">
                {t('pharmacy:environmental.summaryRefrigerator')}
              </p>
              <p className="mt-1 text-sm font-semibold text-secondary-900">
                {reportQuery.data.refrigerator.minTempC !== null
                  ? `${reportQuery.data.refrigerator.minTempC}–${reportQuery.data.refrigerator.maxTempC} °C`
                  : '—'}
              </p>
            </div>
          </div>
        )}

        {(logsQuery.data?.items.length ?? 0) === 0 ? (
          <p className="text-sm text-secondary-500">{t('pharmacy:environmental.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-secondary-200 text-xs uppercase text-secondary-500">
                <tr>
                  <th className="py-2 pr-3">{t('pharmacy:environmental.columns.date')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:environmental.columns.zone')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:environmental.columns.reading')}</th>
                  <th className="py-2 pr-3">{t('pharmacy:environmental.columns.status')}</th>
                  <th className="py-2">{t('pharmacy:environmental.columns.action')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-secondary-100">
                {logsQuery.data?.items.map(row => (
                  <tr key={row.id} data-testid="pharmacy-env-row">
                    <td className="py-2.5 pr-3 text-xs text-secondary-800">
                      {row.businessDate} · {t(`pharmacy:environmental.periods.${row.period}`)}
                    </td>
                    <td className="py-2.5 pr-3 text-xs text-secondary-700">
                      {row.zone === 'ambient'
                        ? t('pharmacy:environmental.summaryAmbient')
                        : t('pharmacy:environmental.summaryRefrigerator')}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-xs font-semibold text-secondary-900">
                      {row.temperatureC.toFixed(1)} °C
                      {row.humidityPercent !== null ? ` · ${row.humidityPercent.toFixed(0)}%` : ''}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge variant={row.isOutOfRange ? 'danger' : 'success'}>
                        {row.isOutOfRange
                          ? t('pharmacy:environmental.outOfRange')
                          : t('pharmacy:environmental.inRange')}
                      </Badge>
                    </td>
                    <td className="py-2.5 text-xs text-secondary-600">
                      {row.correctiveAction ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
