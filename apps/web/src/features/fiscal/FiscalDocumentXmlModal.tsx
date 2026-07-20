import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Download, Check } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { trpc } from '@/lib/trpc';
import { buildSemanticFilename, downloadFile } from '@/services/export/exportService';

export interface FiscalDocumentXmlModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * internal `fiscal_documents.id` (NOT cufe). The modal
   * lazily fetches the signed XML body via `reports.fiscal.getXml`
   * the first time it opens, so the list query no longer has to
   * ship ~10kb per row to render the "Ver XML" affordance.
   */
  documentId: string;
  /** CUFE / UUID del documento — usado en metadatos visibles del modal. */
  cufe: string;
  /** Document number (Folio) — usado en metadatos visibles del modal. */
  documentNumber: string;
}

/**
 * Modal admin-only que muestra el XML CFDI 4.0 / DTE10 / FE
 * emitido por el adapter fiscal del país activo. Read-only: el operador
 * puede copiar al portapapeles o descargar el archivo .xml.
 *
 * La descarga ahora pasa por `downloadFile` del helper
 * centralizado en `services/export/exportService.ts`, y el XML se
 * pide lazy via `reports.fiscal.getXml`. El server arma el filename
 * canónico (`cfdi-<country>-<documentNumber>.xml`) y el MIME type
 * con charset apropiado para CL (ISO-8859-1).
 */
export function FiscalDocumentXmlModal({
  isOpen,
  onClose,
  documentId,
  cufe,
  documentNumber,
}: FiscalDocumentXmlModalProps) {
  const { t } = useTranslation('fiscal');
  const toast = useToast();
  const [justCopied, setJustCopied] = useState(false);

  // Lazy fetch: only hit the server while the modal is open. The
  // `enabled` flag prevents the query from firing for the dozens of
  // documents in the list that the operator never expands.
  const xmlQuery = trpc.reports.fiscal.getXml.useQuery(
    { documentId },
    { enabled: isOpen && documentId.length > 0 }
  );

  const xml = xmlQuery.data?.data ?? null;
  const serverFilename = xmlQuery.data?.filename ?? null;
  const serverMimeType = xmlQuery.data?.mimeType ?? null;
  // Failure fallback for the filename: derive a semantic one from the
  // visible metadata. The server normally provides this; we only fall
  // back if the operator triggers the download before the query lands
  // (which the disabled state below should prevent — but defense in
  // depth keeps the OS handoff from getting a UUID name).
  const fallbackFilename = buildSemanticFilename(
    {
      kind: 'fiscal',
      country: 'xx',
      documentNumber: documentNumber || cufe || documentId,
    },
    'xml'
  );

  const handleCopy = async () => {
    if (!xml) return;
    try {
      await navigator.clipboard.writeText(xml);
      setJustCopied(true);
      window.setTimeout(() => setJustCopied(false), 2000);
      toast.success({ title: t('document.xml.xmlCopiedToast') });
    } catch {
      toast.error({ title: t('document.xml.xmlCopyError') });
    }
  };

  const handleDownload = () => {
    if (!xml) return;
    const filename = serverFilename ?? fallbackFilename;
    const mimeType = serverMimeType ?? 'application/xml;charset=utf-8';
    const blob = new Blob([xml], { type: mimeType });
    downloadFile(blob, filename);
  };

  const isLoading = xmlQuery.isLoading;
  const downloadDisabled = !xml || isLoading;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('document.xml.title')}
      size="xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-secondary-500">{t('document.xml.draftHint')}</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary inline-flex items-center gap-2"
              onClick={handleCopy}
              disabled={downloadDisabled}
            >
              {justCopied ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
              <span>{justCopied ? t('document.xml.copied') : t('document.xml.copy')}</span>
            </button>
            <button
              type="button"
              className="btn btn-primary inline-flex items-center gap-2"
              onClick={handleDownload}
              disabled={downloadDisabled}
            >
              <Download className="h-4 w-4" aria-hidden />
              <span>{t('document.xml.download')}</span>
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
          <div>
            <span className="label">{t('document.xml.documentNumber')}</span>
            <p className="font-mono text-secondary-700">{documentNumber}</p>
          </div>
          <div>
            <span className="label">{t('document.xml.cufe')}</span>
            <p className="break-all font-mono text-xs text-secondary-700">{cufe}</p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-secondary-500" data-testid="cfdi-xml-loading">
            {t('document.xml.loading')}
          </p>
        ) : xml ? (
          <pre
            className="max-h-[60vh] overflow-auto rounded-md border border-line bg-secondary-50/40 p-3 text-xs leading-relaxed text-secondary-800"
            data-testid="cfdi-xml-pre"
          >
            <code>{xml}</code>
          </pre>
        ) : (
          <p className="text-sm text-secondary-500">{t('document.xml.emptyState')}</p>
        )}
      </div>
    </Modal>
  );
}
