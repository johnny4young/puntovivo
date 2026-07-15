import { FileSpreadsheet, LoaderCircle, RotateCcw, Upload } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { exportToCSV, type ExportColumn } from '@/services/export/exportService';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { parseImportFile, ImportFileError, type ParsedImportFile } from './fileParser';
import {
  autoMapProductHeaders,
  hasRequiredProductMapping,
  mapProductImportRows,
  type ProductImportField,
  type ProductImportMapping,
} from './productImportMapping';
import { ProductImportMappingPanel } from './ProductImportMappingPanel';
import { ProductImportPreviewPanel } from './ProductImportPreview';
import { ProductImportReportPanel } from './ProductImportReport';
import { buildProductImportReportRows } from './productImportReportRows';
import type { ProductImportPreview, ProductImportReport } from './types';

type DecimalFormat = 'auto' | 'dot' | 'comma';

interface IssueExportRow {
  row: number;
  status: string;
  sku: string;
  field: string;
  issue: string;
}

interface ReportExportRow {
  productId: string;
  stockInitialized: string;
}

const TEMPLATE_KEYS = [
  'name',
  'sku',
  'description',
  'barcode',
  'price',
  'cost',
  'stock',
  'minStock',
  'taxRate',
] as const;

export function DataImportPage() {
  const { t } = useTranslation(['dataImport', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<ParsedImportFile | null>(null);
  const [mapping, setMapping] = useState<ProductImportMapping | null>(null);
  const [decimalFormat, setDecimalFormat] = useState<DecimalFormat>('auto');
  const [preview, setPreview] = useState<ProductImportPreview | null>(null);
  const [report, setReport] = useState<ProductImportReport | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const mappedRows = useMemo(
    () => (file && mapping ? mapProductImportRows(file, mapping) : []),
    [file, mapping]
  );

  const previewMutation = trpc.launchMigration.previewProducts.useMutation({
    onSuccess: result => {
      setPreview(result);
      setReport(null);
    },
    onError: onErrorToast(toast, t, { titleKey: 'dataImport:toast.previewError' }),
  });
  const importMutation = trpc.launchMigration.importProducts.useMutation({
    onSuccess: async result => {
      setReport(result);
      await Promise.all([
        utils.products.list.invalidate(),
        utils.inventory.listStock.invalidate(),
        utils.inventory.listEntries.invalidate(),
        utils.setupReadiness.get.invalidate(),
      ]);
      toast.success({ title: t('dataImport:toast.imported', { count: result.summary.imported }) });
    },
    onError: onErrorToast(toast, t, { titleKey: 'dataImport:toast.importError' }),
  });
  const isBusy = isParsing || previewMutation.isPending || importMutation.isPending;

  const invalidatePreview = () => {
    setPreview(null);
    setReport(null);
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
      setMapping(autoMapProductHeaders(parsed.headers));
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
    if (!file || !mapping || !hasRequiredProductMapping(mapping)) return;
    previewMutation.mutate({
      sourceName: file.sourceName,
      decimalFormat,
      rows: mappedRows,
    });
  };

  const handleImport = () => {
    if (!file || !preview) return;
    importMutation.mutate({
      sourceName: file.sourceName,
      decimalFormat,
      rows: mappedRows,
      previewHash: preview.previewHash,
    });
  };

  const buildIssueRows = (): IssueExportRow[] => {
    if (!preview) return [];
    if (report) {
      return buildProductImportReportRows(preview, report)
        .filter(row => row.issue !== null)
        .map(row => ({
          row: row.rowNumber,
          status: t(`dataImport:report.statuses.${row.status}`),
          sku: row.sku,
          field: t(`dataImport:fields.${row.issue!.field}`),
          issue: t(`dataImport:issues.${row.issue!.code}`),
        }));
    }
    const rows = preview.rows.flatMap(row =>
      row.issues.map(issue => ({
        row: row.rowNumber,
        status: t(`dataImport:statuses.${row.status}`),
        sku: row.normalized.sku,
        field: t(`dataImport:fields.${issue.field}`),
        issue: t(`dataImport:issues.${issue.code}`),
      }))
    );
    return rows;
  };

  const handleDownloadIssues = () => {
    const columns: ExportColumn<IssueExportRow>[] = [
      { key: 'row', header: t('dataImport:table.row') },
      { key: 'status', header: t('dataImport:table.status') },
      { key: 'sku', header: t('dataImport:fields.sku') },
      { key: 'field', header: t('dataImport:table.field') },
      { key: 'issue', header: t('dataImport:table.issues') },
    ];
    exportToCSV(buildIssueRows(), columns, 'puntovivo-launch-import-issues', {
      includeTimestamp: true,
    });
  };

  const handleDownloadReport = () => {
    if (!preview || !report) return;
    const rows: Array<IssueExportRow & ReportExportRow> = buildProductImportReportRows(
      preview,
      report
    ).map(row => ({
      row: row.rowNumber,
      status: t(`dataImport:report.statuses.${row.status}`),
      sku: row.sku,
      productId: row.productId,
      stockInitialized:
        row.stockInitialized === null
          ? ''
          : t(`dataImport:report.boolean.${row.stockInitialized ? 'yes' : 'no'}`),
      field: row.issue ? t(`dataImport:fields.${row.issue.field}`) : '',
      issue: row.issue ? t(`dataImport:issues.${row.issue.code}`) : '',
    }));
    const columns: ExportColumn<IssueExportRow & ReportExportRow>[] = [
      { key: 'row', header: t('dataImport:table.row') },
      { key: 'status', header: t('dataImport:table.status') },
      { key: 'sku', header: t('dataImport:fields.sku') },
      { key: 'productId', header: t('dataImport:report.productId') },
      { key: 'stockInitialized', header: t('dataImport:report.stockRecorded') },
      { key: 'field', header: t('dataImport:table.field') },
      { key: 'issue', header: t('dataImport:table.issues') },
    ];
    exportToCSV(rows, columns, `puntovivo-launch-import-${report.importId}`, {
      includeTimestamp: true,
    });
  };

  const handleDownloadTemplate = () => {
    const columns: ExportColumn<Record<string, string>>[] = TEMPLATE_KEYS.map(key => ({
      key,
      header: t(`dataImport:fields.${key}`),
    }));
    exportToCSV(
      [
        {
          name: t('dataImport:template.sampleName'),
          sku: 'SKU-001',
          description: t('dataImport:template.sampleDescription'),
          barcode: '7701234567890',
          price: '12500',
          cost: '8000',
          stock: '24',
          minStock: '5',
          taxRate: '19',
        },
      ],
      columns,
      'puntovivo-products-template',
      { includeTimestamp: false }
    );
  };

  const handleReset = () => {
    if (isBusy) return;
    setFile(null);
    setMapping(null);
    setFileError(null);
    invalidatePreview();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const canPreview = Boolean(file && mapping && hasRequiredProductMapping(mapping));

  return (
    <div className="space-y-6" data-testid="data-import-page">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-700">
            {t('dataImport:kicker')}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-secondary-900">{t('dataImport:title')}</h1>
          <p className="mt-2 max-w-3xl text-sm text-secondary-600">{t('dataImport:description')}</p>
        </div>
        <button type="button" className="pv-btn outline" onClick={handleDownloadTemplate}>
          <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
          {t('dataImport:actions.downloadTemplate')}
        </button>
      </header>

      <section className="card space-y-5 p-6" aria-labelledby="data-import-upload-title">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary-700">
            {t('dataImport:steps.upload.kicker')}
          </p>
          <h2
            id="data-import-upload-title"
            className="mt-1 text-lg font-semibold text-secondary-900"
          >
            {t('dataImport:steps.upload.title')}
          </h2>
          <p className="mt-1 text-sm text-secondary-600">
            {t('dataImport:steps.upload.description')}
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <label
            className={`pv-btn primary w-fit ${
              isBusy ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            }`}
            htmlFor="data-import-file"
            aria-disabled={isBusy}
          >
            {isParsing ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Upload className="h-4 w-4" aria-hidden="true" />
            )}
            {t('dataImport:actions.chooseFile')}
          </label>
          <input
            ref={fileInputRef}
            id="data-import-file"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            disabled={isBusy}
            onChange={event => {
              const selected = event.target.files?.[0];
              if (selected) void handleFile(selected);
            }}
          />
          {file ? (
            <div className="min-w-0 text-sm text-secondary-700" aria-live="polite">
              <p className="truncate font-semibold">{file.sourceName}</p>
              <p className="text-xs text-secondary-500">
                {t('dataImport:fileSummary', {
                  rows: file.rows.length,
                  columns: file.headers.length,
                })}
              </p>
            </div>
          ) : null}
          {file ? (
            <button
              type="button"
              className="pv-btn ghost sm:ml-auto"
              disabled={isBusy}
              onClick={handleReset}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {t('dataImport:actions.reset')}
            </button>
          ) : null}
        </div>
        {fileError ? (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {fileError}
          </p>
        ) : null}
      </section>

      {file && mapping ? (
        <>
          <ProductImportMappingPanel
            headers={file.headers}
            mapping={mapping}
            decimalFormat={decimalFormat}
            disabled={isBusy}
            onMappingChange={(field: ProductImportField, source: string) => {
              setMapping(current => (current ? { ...current, [field]: source } : current));
              invalidatePreview();
            }}
            onDecimalFormatChange={value => {
              setDecimalFormat(value);
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
        <ProductImportPreviewPanel
          preview={preview}
          importing={importMutation.isPending}
          completed={Boolean(report)}
          onImport={handleImport}
          onDownloadIssues={handleDownloadIssues}
        />
      ) : null}

      {report ? (
        <ProductImportReportPanel report={report} onDownloadReport={handleDownloadReport} />
      ) : null}
    </div>
  );
}
