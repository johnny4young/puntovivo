import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, Download, Check } from 'lucide-react';
import { Modal } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';

export interface FiscalDocumentXmlModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Raw XML emitido por el adapter; null cuando el documento no tiene xmlRef. */
  xml: string | null;
  /** CUFE / UUID del documento — usado en el filename de descarga. */
  cufe: string;
  /** Document number (Folio) — usado en el filename de descarga. */
  documentNumber: string;
}

/**
 * ENG-035b — Modal admin-only que muestra el XML CFDI 4.0
 * (estructuralmente válido, sin firmar) emitido por
 * `MexicoCFDIAdapter`. Read-only: el operador puede copiar al
 * portapapeles o descargar el archivo .xml para revisión / debug.
 *
 * El XML llega ya pretty-printed desde el server, o como un string
 * sin indentación cuando el caller no aplicó `prettyPrintCfdi`. El
 * componente lo muestra en un `<pre>` con scroll horizontal.
 */
export function FiscalDocumentXmlModal({
  isOpen,
  onClose,
  xml,
  cufe,
  documentNumber,
}: FiscalDocumentXmlModalProps) {
  const { t } = useTranslation('fiscal');
  const toast = useToast();
  const [justCopied, setJustCopied] = useState(false);

  const filename = useMemo(
    () => `${documentNumber || cufe || 'cfdi'}.xml`,
    [documentNumber, cufe]
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
    const blob = new Blob([xml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('document.xml.title')}
      size="xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-secondary-500">
            {t('document.xml.draftHint')}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-secondary inline-flex items-center gap-2"
              onClick={handleCopy}
              disabled={!xml}
            >
              {justCopied ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
              <span>
                {justCopied
                  ? t('document.xml.copied')
                  : t('document.xml.copy')}
              </span>
            </button>
            <button
              type="button"
              className="btn btn-primary inline-flex items-center gap-2"
              onClick={handleDownload}
              disabled={!xml}
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

        {xml ? (
          <pre
            className="max-h-[60vh] overflow-auto rounded-md border border-line bg-secondary-50/40 p-3 text-xs leading-relaxed text-secondary-800"
            data-testid="cfdi-xml-pre"
          >
            <code>{xml}</code>
          </pre>
        ) : (
          <p className="text-sm text-secondary-500">
            {t('document.xml.emptyState')}
          </p>
        )}
      </div>
    </Modal>
  );
}
