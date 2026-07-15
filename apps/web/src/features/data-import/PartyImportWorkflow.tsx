import { FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { exportToCSV, type ExportColumn } from '@/services/export/exportService';
import { ImportFileError, parseImportFile, type ParsedImportFile } from './fileParser';
import { ImportSourcePanel } from './ImportSourcePanel';
import { PartyImportMappingPanel } from './PartyImportMappingPanel';
import { PartyImportPreviewPanel } from './PartyImportPreview';
import { PartyImportReportPanel } from './PartyImportReport';
import {
  PARTY_IMPORT_FIELDS,
  autoMapPartyHeaders,
  hasRequiredPartyMapping,
  mapPartyImportRows,
  type PartyImportEntity,
  type PartyImportField,
  type PartyImportMapping,
} from './partyImportMapping';
import { buildPartyImportReportRows } from './partyImportReportRows';
import type {
  CustomerImportRowsInput,
  PartyImportPreview,
  PartyImportReport,
  ProviderImportRowsInput,
} from './types';

interface PartyImportWorkflowProps {
  entity: PartyImportEntity;
  onBusyChange?: (busy: boolean) => void;
}

interface PartyIssueExportRow {
  email: string;
  field: string;
  issue: string;
  name: string;
  row: number;
  status: string;
  taxId: string;
}

interface PartyReportExportRow extends PartyIssueExportRow {
  recordId: string;
}

export function PartyImportWorkflow({ entity, onBusyChange }: PartyImportWorkflowProps) {
  const { t } = useTranslation(['dataImport', 'errors']);
  const toast = useToast();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<ParsedImportFile | null>(null);
  const [mapping, setMapping] = useState<PartyImportMapping | null>(null);
  const [preview, setPreview] = useState<PartyImportPreview | null>(null);
  const [report, setReport] = useState<PartyImportReport | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const mappedRows = useMemo(
    () => (file && mapping ? mapPartyImportRows(entity, file, mapping) : []),
    [entity, file, mapping]
  );

  async function finishImport(result: PartyImportReport) {
    setReport(result);
    await Promise.all([
      entity === 'customers'
        ? utils.customers.list.invalidate()
        : utils.providers.list.invalidate(),
      utils.setupReadiness.get.invalidate(),
    ]);
    toast.success({
      title: t(`dataImport:party.${entity}.toastImported`, { count: result.summary.imported }),
    });
  }

  const customerPreviewMutation = trpc.launchMigration.previewCustomers.useMutation({
    onSuccess: result => {
      setPreview(result);
      setReport(null);
    },
    onError: onErrorToast(toast, t, { titleKey: 'dataImport:toast.previewError' }),
  });
  const providerPreviewMutation = trpc.launchMigration.previewProviders.useMutation({
    onSuccess: result => {
      setPreview(result);
      setReport(null);
    },
    onError: onErrorToast(toast, t, { titleKey: 'dataImport:toast.previewError' }),
  });
  const customerImportMutation = trpc.launchMigration.importCustomers.useMutation({
    onSuccess: finishImport,
    onError: onErrorToast(toast, t, { titleKey: 'dataImport:toast.importError' }),
  });
  const providerImportMutation = trpc.launchMigration.importProviders.useMutation({
    onSuccess: finishImport,
    onError: onErrorToast(toast, t, { titleKey: 'dataImport:toast.importError' }),
  });
  const previewPending =
    entity === 'customers' ? customerPreviewMutation.isPending : providerPreviewMutation.isPending;
  const importPending =
    entity === 'customers' ? customerImportMutation.isPending : providerImportMutation.isPending;
  const isBusy = isParsing || previewPending || importPending;

  useEffect(() => {
    onBusyChange?.(isBusy);
    return () => onBusyChange?.(false);
  }, [isBusy, onBusyChange]);

  const invalidatePreview = () => {
    setPreview(null);
    setReport(null);
    customerPreviewMutation.reset();
    providerPreviewMutation.reset();
    customerImportMutation.reset();
    providerImportMutation.reset();
  };

  const handleFile = async (selected: File) => {
    if (isBusy) return;
    setIsParsing(true);
    setFileError(null);
    invalidatePreview();
    try {
      const parsed = await parseImportFile(selected);
      setFile(parsed);
      setMapping(autoMapPartyHeaders(entity, parsed.headers));
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
    if (!file || !mapping || !hasRequiredPartyMapping(mapping)) return;
    if (entity === 'customers') {
      customerPreviewMutation.mutate({
        sourceName: file.sourceName,
        rows: mappedRows as CustomerImportRowsInput,
      });
    } else {
      providerPreviewMutation.mutate({
        sourceName: file.sourceName,
        rows: mappedRows as ProviderImportRowsInput,
      });
    }
  };

  const handleImport = () => {
    if (!file || !preview) return;
    if (entity === 'customers') {
      customerImportMutation.mutate({
        sourceName: file.sourceName,
        rows: mappedRows as CustomerImportRowsInput,
        previewHash: preview.previewHash,
      });
    } else {
      providerImportMutation.mutate({
        sourceName: file.sourceName,
        rows: mappedRows as ProviderImportRowsInput,
        previewHash: preview.previewHash,
      });
    }
  };

  const buildIssueRows = (): PartyIssueExportRow[] => {
    if (!preview) return [];
    if (report) {
      return buildPartyImportReportRows(preview, report)
        .filter(row => row.issue !== null)
        .map(row => ({
          row: row.rowNumber,
          status: t(`dataImport:report.statuses.${row.status}`),
          name: row.name,
          taxId: row.taxId,
          email: row.email,
          field: t(`dataImport:party.fields.${row.issue!.field}`),
          issue: t(`dataImport:party.issues.${row.issue!.code}`),
        }));
    }
    return preview.rows.flatMap(row =>
      row.issues.map(issue => ({
        row: row.rowNumber,
        status: t(`dataImport:statuses.${row.status}`),
        name: row.normalized.name,
        taxId: row.normalized.taxId ?? '',
        email: row.normalized.email ?? '',
        field: t(`dataImport:party.fields.${issue.field}`),
        issue: t(`dataImport:party.issues.${issue.code}`),
      }))
    );
  };

  const exportColumns = <T extends PartyIssueExportRow>(): ExportColumn<T>[] => [
    { key: 'row', header: t('dataImport:table.row') },
    { key: 'status', header: t('dataImport:table.status') },
    { key: 'name', header: t('dataImport:party.fields.name') },
    { key: 'taxId', header: t('dataImport:party.fields.taxId') },
    { key: 'email', header: t('dataImport:party.fields.email') },
    { key: 'field', header: t('dataImport:table.field') },
    { key: 'issue', header: t('dataImport:table.issues') },
  ];

  const handleDownloadIssues = () => {
    exportToCSV(buildIssueRows(), exportColumns(), `puntovivo-${entity}-import-issues`, {
      includeTimestamp: true,
    });
  };

  const handleDownloadReport = () => {
    if (!preview || !report) return;
    const rows: PartyReportExportRow[] = buildPartyImportReportRows(preview, report).map(row => ({
      row: row.rowNumber,
      status: t(`dataImport:report.statuses.${row.status}`),
      name: row.name,
      taxId: row.taxId,
      email: row.email,
      recordId: row.recordId,
      field: row.issue ? t(`dataImport:party.fields.${row.issue.field}`) : '',
      issue: row.issue ? t(`dataImport:party.issues.${row.issue.code}`) : '',
    }));
    const columns: ExportColumn<PartyReportExportRow>[] = [
      ...exportColumns<PartyReportExportRow>(),
      { key: 'recordId', header: t('dataImport:party.report.recordId') },
    ];
    exportToCSV(rows, columns, `puntovivo-${entity}-import-${report.importId}`, {
      includeTimestamp: true,
    });
  };

  const handleDownloadTemplate = () => {
    const columns: ExportColumn<Record<string, string>>[] = PARTY_IMPORT_FIELDS[entity].map(
      key => ({
        key,
        header: t(`dataImport:party.fields.${key}`),
      })
    );
    const sample = Object.fromEntries(
      PARTY_IMPORT_FIELDS[entity].map(key => [key, t(`dataImport:party.${entity}.template.${key}`)])
    );
    exportToCSV([sample], columns, `puntovivo-${entity}-template`, { includeTimestamp: false });
  };

  const handleReset = () => {
    if (isBusy) return;
    setFile(null);
    setMapping(null);
    setFileError(null);
    invalidatePreview();
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const canPreview = Boolean(file && mapping && hasRequiredPartyMapping(mapping));

  return (
    <div className="space-y-6" data-testid={`data-import-${entity}-workflow`}>
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
          <PartyImportMappingPanel
            disabled={isBusy}
            entity={entity}
            headers={file.headers}
            mapping={mapping}
            onMappingChange={(field: PartyImportField, source: string) => {
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
              {previewPending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              {t('dataImport:actions.preview')}
            </button>
          </div>
        </>
      ) : null}

      {preview ? (
        <PartyImportPreviewPanel
          completed={Boolean(report)}
          entity={entity}
          importing={importPending}
          onDownloadIssues={handleDownloadIssues}
          onImport={handleImport}
          preview={preview}
        />
      ) : null}

      {report ? (
        <PartyImportReportPanel
          entity={entity}
          onDownloadReport={handleDownloadReport}
          report={report}
        />
      ) : null}
    </div>
  );
}
