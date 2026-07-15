import { FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { formatCurrency } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { exportToCSV, type ExportColumn } from '@/services/export/exportService';
import {
  autoMapCustomerBalanceHeaders,
  CUSTOMER_BALANCE_IMPORT_FIELDS,
  hasRequiredCustomerBalanceMapping,
  mapCustomerBalanceImportRows,
  type CustomerBalanceImportField,
  type CustomerBalanceImportMapping,
} from './customerBalanceImportMapping';
import { CustomerBalanceImportMappingPanel } from './CustomerBalanceImportMappingPanel';
import { CustomerBalanceImportPreviewPanel } from './CustomerBalanceImportPreview';
import { CustomerBalanceImportReportPanel } from './CustomerBalanceImportReport';
import { buildCustomerBalanceImportReportRows } from './customerBalanceImportReportRows';
import { ImportFileError, parseImportFile, type ParsedImportFile } from './fileParser';
import { ImportSourcePanel } from './ImportSourcePanel';
import type {
  CustomerBalanceImportPreview,
  CustomerBalanceImportReport,
  CustomerBalanceImportRowsInput,
  ImportDecimalFormat,
  LaunchImportDataMode,
} from './types';

interface CustomerBalanceImportWorkflowProps {
  dataMode: LaunchImportDataMode;
  onBusyChange?: (busy: boolean) => void;
}

interface CustomerBalanceIssueExportRow {
  amount: string;
  customer: string;
  email: string;
  field: string;
  issue: string;
  row: number;
  status: string;
  taxId: string;
}

interface CustomerBalanceReportExportRow extends CustomerBalanceIssueExportRow {
  adjustmentId: string;
}

export function CustomerBalanceImportWorkflow({
  dataMode,
  onBusyChange,
}: CustomerBalanceImportWorkflowProps) {
  const { t } = useTranslation(['dataImport', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<ParsedImportFile | null>(null);
  const [mapping, setMapping] = useState<CustomerBalanceImportMapping | null>(null);
  const [decimalFormat, setDecimalFormat] = useState<ImportDecimalFormat>('auto');
  const [preview, setPreview] = useState<CustomerBalanceImportPreview | null>(null);
  const [report, setReport] = useState<CustomerBalanceImportReport | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [confirmedRealData, setConfirmedRealData] = useState(false);

  const mappedRows = useMemo(
    () => (file && mapping ? mapCustomerBalanceImportRows(file, mapping) : []),
    [file, mapping]
  );

  const previewMutation = trpc.launchMigration.previewCustomerBalances.useMutation({
    onSuccess: result => {
      setPreview(result);
      setReport(null);
    },
    onError: onErrorToast(toast, t, { titleKey: 'dataImport:toast.previewError' }),
  });
  const importMutation = trpc.launchMigration.importCustomerBalances.useMutation({
    onSuccess: async result => {
      setReport(result);
      await Promise.all([
        utils.customers.list.invalidate(),
        utils.customerLedger.list.invalidate(),
        utils.customerLedger.getBalance.invalidate(),
      ]);
      toast.success({
        title: t('dataImport:customerBalances.toastImported', {
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
      setMapping(autoMapCustomerBalanceHeaders(parsed.headers));
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
    if (!file || !mapping || !hasRequiredCustomerBalanceMapping(mapping)) return;
    previewMutation.mutate({
      dataMode,
      sourceName: file.sourceName,
      decimalFormat,
      rows: mappedRows as CustomerBalanceImportRowsInput,
    });
  };

  const handleImport = () => {
    if (!file || !preview || dataMode !== 'real' || !confirmedRealData) return;
    importMutation.mutate({
      confirmedRealData: true,
      dataMode,
      sourceName: file.sourceName,
      decimalFormat,
      rows: mappedRows as CustomerBalanceImportRowsInput,
      previewHash: preview.previewHash,
    });
  };

  const exportColumns = <T extends CustomerBalanceIssueExportRow>(): ExportColumn<T>[] => [
    { key: 'row', header: t('dataImport:table.row') },
    { key: 'status', header: t('dataImport:table.status') },
    { key: 'customer', header: t('dataImport:customerBalances.table.customer') },
    { key: 'taxId', header: t('dataImport:customerBalances.fields.taxId') },
    { key: 'email', header: t('dataImport:customerBalances.fields.email') },
    { key: 'amount', header: t('dataImport:customerBalances.fields.openingBalance') },
    { key: 'field', header: t('dataImport:table.field') },
    { key: 'issue', header: t('dataImport:table.issues') },
  ];

  const buildIssueRows = (): CustomerBalanceIssueExportRow[] => {
    if (!preview) return [];
    if (report) {
      return buildCustomerBalanceImportReportRows(preview, report)
        .filter(row => row.issue !== null)
        .map(row => ({
          row: row.rowNumber,
          status: t(`dataImport:report.statuses.${row.status}`),
          customer: row.customer,
          taxId: row.taxId,
          email: row.email,
          amount: row.openingBalance > 0 ? formatCurrency(row.openingBalance) : '',
          field: t(`dataImport:customerBalances.fields.${row.issue!.field}`),
          issue: t(`dataImport:customerBalances.issues.${row.issue!.code}`),
        }));
    }
    return preview.rows.flatMap(row =>
      row.issues.map(issue => ({
        row: row.rowNumber,
        status: t(`dataImport:statuses.${row.status}`),
        customer: row.normalized.customerName ?? '',
        taxId: row.normalized.taxId ?? '',
        email: row.normalized.email ?? '',
        amount:
          row.normalized.openingBalance > 0 ? formatCurrency(row.normalized.openingBalance) : '',
        field: t(`dataImport:customerBalances.fields.${issue.field}`),
        issue: t(`dataImport:customerBalances.issues.${issue.code}`),
      }))
    );
  };

  const handleDownloadIssues = () => {
    exportToCSV(buildIssueRows(), exportColumns(), 'puntovivo-customer-balances-import-issues', {
      includeTimestamp: true,
    });
  };

  const handleDownloadReport = () => {
    if (!preview || !report) return;
    const rows: CustomerBalanceReportExportRow[] = buildCustomerBalanceImportReportRows(
      preview,
      report
    ).map(row => ({
      row: row.rowNumber,
      status: t(`dataImport:report.statuses.${row.status}`),
      customer: row.customer,
      taxId: row.taxId,
      email: row.email,
      amount: row.openingBalance > 0 ? formatCurrency(row.openingBalance) : '',
      adjustmentId: row.adjustmentId,
      field: row.issue ? t(`dataImport:customerBalances.fields.${row.issue.field}`) : '',
      issue: row.issue ? t(`dataImport:customerBalances.issues.${row.issue.code}`) : '',
    }));
    const columns: ExportColumn<CustomerBalanceReportExportRow>[] = [
      ...exportColumns<CustomerBalanceReportExportRow>(),
      { key: 'adjustmentId', header: t('dataImport:customerBalances.report.adjustmentId') },
    ];
    exportToCSV(rows, columns, `puntovivo-customer-balances-import-${report.importId}`, {
      includeTimestamp: true,
    });
  };

  const handleDownloadTemplate = () => {
    const columns: ExportColumn<Record<string, string>>[] = CUSTOMER_BALANCE_IMPORT_FIELDS.map(
      key => ({ key, header: t(`dataImport:customerBalances.fields.${key}`) })
    );
    const sample = Object.fromEntries(
      CUSTOMER_BALANCE_IMPORT_FIELDS.map(key => [
        key,
        t(`dataImport:customerBalances.template.${key}`),
      ])
    );
    exportToCSV([sample], columns, 'puntovivo-customer-balances-template', {
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

  const canPreview = Boolean(file && mapping && hasRequiredCustomerBalanceMapping(mapping));

  return (
    <div className="space-y-6" data-testid="data-import-customerBalances-workflow">
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
          <CustomerBalanceImportMappingPanel
            decimalFormat={decimalFormat}
            disabled={isBusy}
            headers={file.headers}
            mapping={mapping}
            onDecimalFormatChange={value => {
              setDecimalFormat(value);
              invalidatePreview();
            }}
            onMappingChange={(field: CustomerBalanceImportField, source: string) => {
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
        <CustomerBalanceImportPreviewPanel
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
        <CustomerBalanceImportReportPanel onDownloadReport={handleDownloadReport} report={report} />
      ) : null}
    </div>
  );
}
