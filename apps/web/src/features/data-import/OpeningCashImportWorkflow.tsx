import { FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { formatCurrency } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { exportToCSV, type ExportColumn } from '@/services/export/exportService';
import { ImportFileError, parseImportFile, type ParsedImportFile } from './fileParser';
import { ImportSourcePanel } from './ImportSourcePanel';
import {
  autoMapOpeningCashHeaders,
  hasRequiredOpeningCashMapping,
  mapOpeningCashImportRows,
  OPENING_CASH_IMPORT_FIELDS,
  type OpeningCashImportField,
  type OpeningCashImportMapping,
} from './openingCashImportMapping';
import {
  buildOpeningCashImportReportRows,
  serializeOpeningCashDenominations,
} from './openingCashImportReportRows';
import { OpeningCashImportMappingPanel } from './OpeningCashImportMappingPanel';
import { OpeningCashImportPreviewPanel } from './OpeningCashImportPreview';
import { OpeningCashImportReportPanel } from './OpeningCashImportReport';
import type {
  ImportDecimalFormat,
  LaunchImportDataMode,
  OpeningCashImportPreview,
  OpeningCashImportReport,
  OpeningCashImportRowsInput,
} from './types';
import { Button } from '@/components/ui';
interface OpeningCashImportWorkflowProps {
  dataMode: LaunchImportDataMode;
  onBusyChange?: (busy: boolean) => void;
}
interface OpeningCashIssueExportRow {
  denominations: string;
  field: string;
  issue: string;
  openingFloat: string;
  registerName: string;
  row: number;
  siteName: string;
  status: string;
}
interface OpeningCashReportExportRow extends OpeningCashIssueExportRow {
  templateId: string;
}
export function OpeningCashImportWorkflow({
  dataMode,
  onBusyChange,
}: OpeningCashImportWorkflowProps) {
  const { t } = useTranslation(['dataImport', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<ParsedImportFile | null>(null);
  const [mapping, setMapping] = useState<OpeningCashImportMapping | null>(null);
  const [decimalFormat, setDecimalFormat] = useState<ImportDecimalFormat>('auto');
  const [preview, setPreview] = useState<OpeningCashImportPreview | null>(null);
  const [report, setReport] = useState<OpeningCashImportReport | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [confirmedRealData, setConfirmedRealData] = useState(false);
  const mappedRows = useMemo(
    () => (file && mapping ? mapOpeningCashImportRows(file, mapping) : []),
    [file, mapping]
  );
  const previewMutation = trpc.launchMigration.previewOpeningCash.useMutation({
    onSuccess: result => {
      setPreview(result);
      setReport(null);
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'dataImport:toast.previewError',
    }),
  });
  const importMutation = trpc.launchMigration.importOpeningCash.useMutation({
    onSuccess: async result => {
      setReport(result);
      await utils.cashSessions.registerAssignments.invalidate();
      toast.success({
        title: t('dataImport:openingCash.toastImported', {
          count: result.summary.imported,
        }),
      });
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'dataImport:toast.importError',
    }),
  });
  const isBusy = isParsing || previewMutation.isPending || importMutation.isPending;
  useEffect(() => {
    onBusyChange?.(isBusy);
    return () => onBusyChange?.(false);
  }, [isBusy, onBusyChange]);
  const invalidatePreview = () => {
    setPreview(null);
    setReport(null);
    setConfirmedRealData(false);
    previewMutation.reset();
    importMutation.reset();
  };
  const handleFile = async (selected: File) => {
    if (isBusy) return;
    setIsParsing(true);
    setFileError(null);
    invalidatePreview();
    try {
      const parsed = await parseImportFile(selected);
      setFile(parsed);
      setMapping(autoMapOpeningCashHeaders(parsed.headers));
    } catch (error) {
      setFile(null);
      setMapping(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      const code = error instanceof ImportFileError ? error.code : 'unsupported_file';
      setFileError(t(`dataImport:fileErrors.${code}`));
    } finally {
      setIsParsing(false);
    }
  };
  const handlePreview = () => {
    if (!file || !mapping || !hasRequiredOpeningCashMapping(mapping)) return;
    previewMutation.mutate({
      dataMode,
      sourceName: file.sourceName,
      decimalFormat,
      rows: mappedRows as OpeningCashImportRowsInput,
    });
  };
  const handleImport = () => {
    if (!file || !preview || dataMode !== 'real' || !confirmedRealData) return;
    importMutation.mutate({
      confirmedRealData: true,
      dataMode,
      sourceName: file.sourceName,
      decimalFormat,
      rows: mappedRows as OpeningCashImportRowsInput,
      previewHash: preview.previewHash,
    });
  };
  const exportColumns = <T extends OpeningCashIssueExportRow>(): ExportColumn<T>[] => [
    {
      key: 'row',
      header: t('dataImport:table.row'),
    },
    {
      key: 'status',
      header: t('dataImport:table.status'),
    },
    {
      key: 'siteName',
      header: t('dataImport:openingCash.fields.siteName'),
    },
    {
      key: 'registerName',
      header: t('dataImport:openingCash.fields.registerName'),
    },
    {
      key: 'openingFloat',
      header: t('dataImport:openingCash.fields.openingFloat'),
    },
    {
      key: 'denominations',
      header: t('dataImport:openingCash.fields.denominations'),
    },
    {
      key: 'field',
      header: t('dataImport:table.field'),
    },
    {
      key: 'issue',
      header: t('dataImport:table.issues'),
    },
  ];
  const buildIssueRows = (): OpeningCashIssueExportRow[] => {
    if (!preview) return [];
    if (report) {
      return buildOpeningCashImportReportRows(preview, report)
        .filter(row => row.issue !== null)
        .map(row => ({
          row: row.rowNumber,
          status: t(`dataImport:report.statuses.${row.status}`),
          siteName: row.siteName,
          registerName: row.registerName,
          openingFloat: formatCurrency(row.openingFloat),
          denominations: row.denominations,
          field: t(`dataImport:openingCash.fields.${row.issue!.field}`),
          issue: t(`dataImport:openingCash.issues.${row.issue!.code}`),
        }));
    }
    return preview.rows.flatMap(row =>
      row.issues.map(issue => ({
        row: row.rowNumber,
        status: t(`dataImport:statuses.${row.status}`),
        siteName: row.normalized.siteName,
        registerName: row.normalized.registerName,
        openingFloat: formatCurrency(row.normalized.openingFloat),
        denominations: serializeOpeningCashDenominations(row.normalized.denominations),
        field: t(`dataImport:openingCash.fields.${issue.field}`),
        issue: t(`dataImport:openingCash.issues.${issue.code}`),
      }))
    );
  };
  const handleDownloadIssues = () => {
    exportToCSV(buildIssueRows(), exportColumns(), 'puntovivo-opening-cash-import-issues', {
      includeTimestamp: true,
    });
  };
  const handleDownloadReport = () => {
    if (!preview || !report) return;
    const rows: OpeningCashReportExportRow[] = buildOpeningCashImportReportRows(
      preview,
      report
    ).map(row => ({
      row: row.rowNumber,
      status: t(`dataImport:report.statuses.${row.status}`),
      siteName: row.siteName,
      registerName: row.registerName,
      openingFloat: formatCurrency(row.openingFloat),
      denominations: row.denominations,
      templateId: row.templateId,
      field: row.issue ? t(`dataImport:openingCash.fields.${row.issue.field}`) : '',
      issue: row.issue ? t(`dataImport:openingCash.issues.${row.issue.code}`) : '',
    }));
    const columns: ExportColumn<OpeningCashReportExportRow>[] = [
      ...exportColumns<OpeningCashReportExportRow>(),
      {
        key: 'templateId',
        header: t('dataImport:openingCash.report.templateId'),
      },
    ];
    exportToCSV(rows, columns, `puntovivo-opening-cash-import-${report.importId}`, {
      includeTimestamp: true,
    });
  };
  const handleDownloadTemplate = () => {
    const columns: ExportColumn<Record<string, string>>[] = OPENING_CASH_IMPORT_FIELDS.map(key => ({
      key,
      header: t(`dataImport:openingCash.fields.${key}`),
    }));
    const sample = Object.fromEntries(
      OPENING_CASH_IMPORT_FIELDS.map(key => [key, t(`dataImport:openingCash.template.${key}`)])
    );
    exportToCSV([sample], columns, 'puntovivo-opening-cash-template', {
      includeTimestamp: false,
    });
  };
  const handleReset = () => {
    if (isBusy) return;
    setFile(null);
    setMapping(null);
    setFileError(null);
    invalidatePreview();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };
  const canPreview = Boolean(file && mapping && hasRequiredOpeningCashMapping(mapping));
  return (
    <div className="space-y-6" data-testid="data-import-openingCash-workflow">
      <div className="flex justify-end">
        <Button type="button" onClick={handleDownloadTemplate} variant="outline">
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          {t('dataImport:actions.downloadTemplate')}
        </Button>
      </div>

      <ImportSourcePanel
        file={file}
        fileError={fileError}
        inputRef={fileInputRef}
        isBusy={isBusy}
        isParsing={isParsing}
        onFile={selected => void handleFile(selected)}
        onReset={handleReset}
      />

      {file && mapping ? (
        <>
          <OpeningCashImportMappingPanel
            decimalFormat={decimalFormat}
            disabled={isBusy}
            headers={file.headers}
            mapping={mapping}
            onDecimalFormatChange={value => {
              setDecimalFormat(value);
              invalidatePreview();
            }}
            onMappingChange={(field: OpeningCashImportField, source: string) => {
              setMapping(current =>
                current
                  ? {
                      ...current,
                      [field]: source,
                    }
                  : current
              );
              invalidatePreview();
            }}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              disabled={!canPreview || isBusy}
              onClick={handlePreview}
              variant="primary"
            >
              {previewMutation.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {t('dataImport:actions.preview')}
            </Button>
          </div>
        </>
      ) : null}

      {preview ? (
        <OpeningCashImportPreviewPanel
          completed={Boolean(report)}
          confirmedRealData={confirmedRealData}
          dataMode={dataMode}
          importing={importMutation.isPending}
          onConfirmRealData={setConfirmedRealData}
          onDownloadIssues={handleDownloadIssues}
          onImport={handleImport}
          preview={preview}
        />
      ) : null}

      {report ? (
        <OpeningCashImportReportPanel onDownloadReport={handleDownloadReport} report={report} />
      ) : null}
    </div>
  );
}
