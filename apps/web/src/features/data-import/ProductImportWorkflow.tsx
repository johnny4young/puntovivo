import { FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/components/feedback/ToastProvider';
import { exportToCSV, type ExportColumn } from '@/services/export/exportService';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { parseImportFile, ImportFileError, type ParsedImportFile } from './fileParser';
import { ImportSourcePanel } from './ImportSourcePanel';
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
import type { LaunchImportDataMode, ProductImportPreview, ProductImportReport } from './types';
import { Button } from '@/components/ui';
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
  'tracksLots',
] as const;
interface ProductImportWorkflowProps {
  dataMode: LaunchImportDataMode;
  onBusyChange?: (busy: boolean) => void;
}
export function ProductImportWorkflow({ dataMode, onBusyChange }: ProductImportWorkflowProps) {
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
  const [confirmedRealData, setConfirmedRealData] = useState(false);
  const mappedRows = useMemo(
    () => (file && mapping ? mapProductImportRows(file, mapping) : []),
    [file, mapping]
  );
  const previewMutation = trpc.launchMigration.previewProducts.useMutation({
    onSuccess: result => {
      setPreview(result);
      setReport(null);
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'dataImport:toast.previewError',
    }),
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
      toast.success({
        title: t('dataImport:toast.imported', {
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
      dataMode,
      sourceName: file.sourceName,
      decimalFormat,
      rows: mappedRows,
    });
  };
  const handleImport = () => {
    if (!file || !preview || dataMode !== 'real' || !confirmedRealData) return;
    importMutation.mutate({
      confirmedRealData: true,
      dataMode,
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
      {
        key: 'row',
        header: t('dataImport:table.row'),
      },
      {
        key: 'status',
        header: t('dataImport:table.status'),
      },
      {
        key: 'sku',
        header: t('dataImport:fields.sku'),
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
      {
        key: 'row',
        header: t('dataImport:table.row'),
      },
      {
        key: 'status',
        header: t('dataImport:table.status'),
      },
      {
        key: 'sku',
        header: t('dataImport:fields.sku'),
      },
      {
        key: 'productId',
        header: t('dataImport:report.productId'),
      },
      {
        key: 'stockInitialized',
        header: t('dataImport:report.stockRecorded'),
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
          tracksLots: t('dataImport:boolean.no'),
        },
      ],
      columns,
      'puntovivo-products-template',
      {
        includeTimestamp: false,
      }
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
    <div className="space-y-6">
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
          <ProductImportMappingPanel
            headers={file.headers}
            mapping={mapping}
            decimalFormat={decimalFormat}
            disabled={isBusy}
            onMappingChange={(field: ProductImportField, source: string) => {
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
            onDecimalFormatChange={value => {
              setDecimalFormat(value);
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
        <ProductImportPreviewPanel
          preview={preview}
          confirmedRealData={confirmedRealData}
          dataMode={dataMode}
          importing={importMutation.isPending}
          completed={Boolean(report)}
          onImport={handleImport}
          onDownloadIssues={handleDownloadIssues}
          onConfirmRealData={setConfirmedRealData}
        />
      ) : null}

      {report ? (
        <ProductImportReportPanel report={report} onDownloadReport={handleDownloadReport} />
      ) : null}
    </div>
  );
}
