import { FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { exportToCSV, type ExportColumn } from '@/services/export/exportService';
import { FiscalProfileImportMappingPanel } from './FiscalProfileImportMappingPanel';
import { FiscalProfileImportPreviewPanel } from './FiscalProfileImportPreview';
import { FiscalProfileImportReportPanel } from './FiscalProfileImportReport';
import {
  autoMapFiscalProfileHeaders,
  FISCAL_PROFILE_IMPORT_FIELDS,
  FISCAL_PROFILE_IMPORT_TEMPLATE,
  hasRequiredFiscalProfileMapping,
  mapFiscalProfileImportRows,
  type FiscalProfileImportField,
  type FiscalProfileImportMapping,
} from './fiscalProfileImportMapping';
import { buildFiscalProfileImportReportRows } from './fiscalProfileImportReportRows';
import { ImportFileError, parseImportFile, type ParsedImportFile } from './fileParser';
import { ImportSourcePanel } from './ImportSourcePanel';
import type {
  FiscalProfileImportPreview,
  FiscalProfileImportReport,
  FiscalProfileImportRowsInput,
  LaunchImportDataMode,
} from './types';

interface FiscalProfileImportWorkflowProps {
  dataMode: LaunchImportDataMode;
  onBusyChange?: (busy: boolean) => void;
}

interface FiscalProfileIssueExportRow {
  countryCode: string;
  environment: string;
  field: string;
  issue: string;
  row: number;
  status: string;
  taxIdentifier: string;
}

export function FiscalProfileImportWorkflow({
  dataMode,
  onBusyChange,
}: FiscalProfileImportWorkflowProps) {
  const { t } = useTranslation(['dataImport', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<ParsedImportFile | null>(null);
  const [mapping, setMapping] = useState<FiscalProfileImportMapping | null>(null);
  const [preview, setPreview] = useState<FiscalProfileImportPreview | null>(null);
  const [report, setReport] = useState<FiscalProfileImportReport | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [confirmedRealData, setConfirmedRealData] = useState(false);

  const mappedRows = useMemo(
    () => (file && mapping ? mapFiscalProfileImportRows(file, mapping) : []),
    [file, mapping]
  );
  const previewMutation = trpc.launchMigration.previewFiscalProfiles.useMutation({
    onSuccess: result => {
      setPreview(result);
      setReport(null);
    },
    onError: onErrorToast(toast, t, { titleKey: 'dataImport:toast.previewError' }),
  });
  const importMutation = trpc.launchMigration.importFiscalProfiles.useMutation({
    onSuccess: async result => {
      setReport(result);
      await Promise.all([
        utils.fiscalSettings.getByCountry.invalidate(),
        utils.setupReadiness.get.invalidate(),
        utils.setupReadiness.checkout.invalidate(),
      ]);
      toast.success({
        title: t('dataImport:fiscalProfiles.toastImported', {
          count: result.summary.imported,
        }),
      });
    },
    onError: onErrorToast(toast, t, { titleKey: 'dataImport:toast.importError' }),
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
      setMapping(autoMapFiscalProfileHeaders(parsed.headers));
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
    if (!file || !mapping || !hasRequiredFiscalProfileMapping(mapping)) return;
    previewMutation.mutate({
      dataMode,
      sourceName: file.sourceName,
      rows: mappedRows as FiscalProfileImportRowsInput,
    });
  };

  const handleImport = () => {
    if (!file || !preview || dataMode !== 'real' || !confirmedRealData) return;
    importMutation.mutate({
      confirmedRealData: true,
      dataMode,
      sourceName: file.sourceName,
      rows: mappedRows as FiscalProfileImportRowsInput,
      previewHash: preview.previewHash,
    });
  };

  const exportColumns = <T extends FiscalProfileIssueExportRow>(): ExportColumn<T>[] => [
    { key: 'row', header: t('dataImport:table.row') },
    { key: 'status', header: t('dataImport:table.status') },
    { key: 'countryCode', header: t('dataImport:fiscalProfiles.fields.countryCode') },
    { key: 'taxIdentifier', header: t('dataImport:fiscalProfiles.fields.taxIdentifier') },
    { key: 'environment', header: t('dataImport:fiscalProfiles.fields.environment') },
    { key: 'field', header: t('dataImport:table.field') },
    { key: 'issue', header: t('dataImport:table.issues') },
  ];

  const buildIssueRows = (): FiscalProfileIssueExportRow[] => {
    if (!preview) return [];
    if (report) {
      return buildFiscalProfileImportReportRows(preview, report)
        .filter(row => row.issue !== null)
        .map(row => ({
          row: row.rowNumber,
          status: t(`dataImport:report.statuses.${row.status}`),
          countryCode: row.countryCode,
          taxIdentifier: row.taxIdentifier,
          environment: row.environment,
          field: t(`dataImport:fiscalProfiles.fields.${row.issue!.field}`),
          issue: t(`dataImport:fiscalProfiles.issues.${row.issue!.code}`),
        }));
    }
    return preview.rows.flatMap(row =>
      row.issues.map(issue => ({
        row: row.rowNumber,
        status: t(`dataImport:statuses.${row.status}`),
        countryCode: row.normalized.countryCode ?? '',
        taxIdentifier: row.normalized.taxIdentifier,
        environment: row.normalized.environment,
        field: t(`dataImport:fiscalProfiles.fields.${issue.field}`),
        issue: t(`dataImport:fiscalProfiles.issues.${issue.code}`),
      }))
    );
  };

  const handleDownloadIssues = () => {
    exportToCSV(buildIssueRows(), exportColumns(), 'puntovivo-fiscal-profile-import-issues', {
      includeTimestamp: true,
    });
  };

  const handleDownloadReport = () => {
    if (!preview || !report) return;
    const rows: FiscalProfileIssueExportRow[] = buildFiscalProfileImportReportRows(
      preview,
      report
    ).map(row => ({
      row: row.rowNumber,
      status: t(`dataImport:report.statuses.${row.status}`),
      countryCode: row.countryCode,
      taxIdentifier: row.taxIdentifier,
      environment: row.environment,
      field: row.issue ? t(`dataImport:fiscalProfiles.fields.${row.issue.field}`) : '',
      issue: row.issue ? t(`dataImport:fiscalProfiles.issues.${row.issue.code}`) : '',
    }));
    exportToCSV(rows, exportColumns(), `puntovivo-fiscal-profile-import-${report.importId}`, {
      includeTimestamp: true,
    });
  };

  const handleDownloadTemplate = () => {
    const columns: ExportColumn<Record<string, string>>[] = FISCAL_PROFILE_IMPORT_FIELDS.map(
      key => ({ key, header: t(`dataImport:fiscalProfiles.fields.${key}`) })
    );
    exportToCSV([FISCAL_PROFILE_IMPORT_TEMPLATE], columns, 'puntovivo-fiscal-profile-template', {
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

  const canPreview = Boolean(file && mapping && hasRequiredFiscalProfileMapping(mapping));

  return (
    <div className="space-y-6" data-testid="data-import-fiscalProfiles-workflow">
      <div className="flex justify-end">
        <button type="button" className="pv-btn outline" onClick={handleDownloadTemplate}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          {t('dataImport:actions.downloadTemplate')}
        </button>
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
          <FiscalProfileImportMappingPanel
            disabled={isBusy}
            headers={file.headers}
            mapping={mapping}
            onMappingChange={(field: FiscalProfileImportField, source: string) => {
              setMapping(current => (current ? { ...current, [field]: source } : current));
              invalidatePreview();
            }}
          />
          <div className="flex justify-end">
            <button
              type="button"
              className="pv-btn primary"
              disabled={!canPreview || isBusy}
              onClick={handlePreview}
            >
              {previewMutation.isPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {t('dataImport:actions.preview')}
            </button>
          </div>
        </>
      ) : null}

      {preview ? (
        <FiscalProfileImportPreviewPanel
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
        <FiscalProfileImportReportPanel onDownloadReport={handleDownloadReport} report={report} />
      ) : null}
    </div>
  );
}
