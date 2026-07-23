import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, UploadCloud } from 'lucide-react';
import { Overlay } from '@/components/overlay/Overlay';
import { trpc } from '@/lib/trpc';
import { useAiFeatureFlag } from '@/features/ai-shared';
import { useToast } from '@/components/feedback/ToastProvider';
import { InvoiceOcrPreview } from './InvoiceOcrPreview';
import { ExtractedFieldsForm } from './ExtractedFieldsForm';
import type { PurchaseDraft } from './types';
import type { Provider } from '@/types';

interface InvoiceOcrDialogProps {
  open: boolean;
  onClose: () => void;
  providers: Provider[];
  onConfirmed?: (draft: PurchaseDraft) => void;
}

type Stage = 'idle' | 'uploading' | 'extracting' | 'review' | 'error';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const MAX_BYTES = 10 * 1024 * 1024;

export function InvoiceOcrDialog({ open, onClose, providers, onConfirmed }: InvoiceOcrDialogProps) {
  const { t } = useTranslation(['invoiceOcr', 'common']);
  const toast = useToast();
  const enabled = useAiFeatureFlag('invoiceOcr');

  const fileRef = useRef<HTMLInputElement | null>(null);
  const cameraRef = useRef<HTMLInputElement | null>(null);

  const [stage, setStage] = useState<Stage>('idle');
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [previewMimeType, setPreviewMimeType] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [draft, setDraft] = useState<PurchaseDraft | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const uploadMutation = trpc.upload.uploadInvoice.useMutation();
  const extractMutation = trpc.ai.invoiceOcr.extract.useMutation();
  const confirmMutation = trpc.ai.invoiceOcr.confirm.useMutation();

  const resetState = useCallback(() => {
    setStage('idle');
    setImagePreviewUrl(prev => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPreviewMimeType(null);
    setFileName(null);
    setDraft(null);
    setErrorMsg(null);
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  async function handleFile(file: File) {
    if (!ALLOWED_MIME.has(file.type)) {
      setErrorMsg(
        t('invoiceOcr:error.unsupportedType', { defaultValue: 'Tipo de archivo no soportado.' })
      );
      setStage('error');
      return;
    }
    if (file.size > MAX_BYTES) {
      setErrorMsg(
        t('invoiceOcr:error.tooLarge', { defaultValue: 'Archivo demasiado grande (máx 10 MB).' })
      );
      setStage('error');
      return;
    }
    setStage('uploading');
    try {
      const preview = URL.createObjectURL(file);
      setImagePreviewUrl(preview);
      setPreviewMimeType(file.type);
      setFileName(file.name);
      const base64 = await fileToBase64(file);
      const upload = await uploadMutation.mutateAsync({
        imageBase64: base64,
        mimeType: file.type as 'image/jpeg' | 'image/png' | 'application/pdf',
        fileName: file.name,
      });
      setStage('extracting');
      const data = await extractMutation.mutateAsync({ uploadId: upload.uploadId });
      setDraft(data);
      setStage('review');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStage('error');
    }
  }

  async function handleConfirm(updated: PurchaseDraft) {
    try {
      const unresolved = updated.lines.find(line => !line.matchedProductId || !line.unitId);
      if (!updated.providerId || unresolved) {
        toast.error({
          title: t('invoiceOcr:error.title', { defaultValue: 'No pude leer esa factura' }),
          description: t('invoiceOcr:error.missingRequired', {
            defaultValue: 'Selecciona proveedor y producto para cada línea antes de confirmar.',
          }),
        });
        return;
      }
      await confirmMutation.mutateAsync({
        uploadId: updated.uploadId,
        extractAuditId: updated.extractAuditId,
        providerId: updated.providerId,
        supplier: { name: updated.supplier.name, nit: updated.supplier.nit },
        invoiceNumber: updated.invoiceNumber.value || null,
        totals: {
          subtotal: updated.totals.subtotal,
          iva: updated.totals.iva,
          total: updated.totals.total,
          linesSum: updated.totals.linesSum,
        },
        lines: updated.lines.map(line => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          matchedProductId: line.matchedProductId!,
          unitId: line.unitId!,
        })),
      });
      toast.success({
        title: t('invoiceOcr:success.title', { defaultValue: 'Borrador listo' }),
        description: t('invoiceOcr:success.description', {
          defaultValue: 'Revisa la compra borrador antes de finalizarla.',
        }),
      });
      onConfirmed?.(updated);
      handleClose();
    } catch (err) {
      toast.error({
        title: t('invoiceOcr:error.title', { defaultValue: 'No pude registrar la confirmación' }),
        description: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!enabled.enabled) return null;

  return (
    <Overlay
      isOpen={open}
      onClose={handleClose}
      size="full"
      className="max-w-[min(92vw,60rem)] rounded-[16px] bg-card/98 shadow-[var(--shadow-modal)] lg:max-w-[min(70vw,60rem)]"
      bodyClassName="mt-3"
      kicker={t('invoiceOcr:dialog.kicker', { defaultValue: 'OCR de factura' })}
      title={t('invoiceOcr:dialog.title', { defaultValue: 'Sube una foto, la IA lee la factura' })}
      description={t('invoiceOcr:dialog.subtitle', {
        defaultValue:
          'Soporta JPG, PNG y PDF hasta 10 MB. Revisa cada campo antes de registrar la compra.',
      })}
    >
      <div className="space-y-5">
        {stage === 'idle' && (
          <div className="grid place-items-center gap-4 rounded-[14px] border border-dashed border-line bg-surface-2/40 p-10 text-center">
            <UploadCloud className="h-10 w-10 text-primary-700" aria-hidden="true" />
            <p className="max-w-md text-sm text-secondary-600">
              {t('invoiceOcr:upload.help', {
                defaultValue:
                  'Selecciona la factura del proveedor o tómale una foto desde la tableta.',
              })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="btn-primary inline-flex items-center gap-2 rounded-[14px] px-4 py-2 text-xs"
              >
                <UploadCloud className="h-4 w-4" aria-hidden="true" />
                {t('invoiceOcr:upload.upload', { defaultValue: 'Subir archivo' })}
              </button>
              <button
                type="button"
                onClick={() => cameraRef.current?.click()}
                className="btn-outline inline-flex items-center gap-2 rounded-[14px] px-4 py-2 text-xs"
              >
                <Camera className="h-4 w-4" aria-hidden="true" />
                {t('invoiceOcr:upload.camera', { defaultValue: 'Tomar foto' })}
              </button>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,application/pdf"
              hidden
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <input
              ref={cameraRef}
              type="file"
              accept="image/png,image/jpeg"
              capture="environment"
              hidden
              onChange={e => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            <p className="text-[11px] text-secondary-500">
              {t('invoiceOcr:upload.fileTypes', { defaultValue: 'JPG · PNG · PDF — máx 10 MB' })}
            </p>
          </div>
        )}

        {(stage === 'uploading' || stage === 'extracting') && imagePreviewUrl && (
          <div>
            <InvoiceOcrPreview
              imageUrl={imagePreviewUrl}
              mimeType={previewMimeType}
              fileName={fileName}
              className="mx-auto max-w-md"
              animateScan
            />
            <p className="mt-3 text-center text-sm text-secondary-600">
              {stage === 'uploading'
                ? t('invoiceOcr:stage.uploading', { defaultValue: 'Preparando imagen...' })
                : t('invoiceOcr:stage.extracting', { defaultValue: 'Leyendo la factura...' })}
            </p>
          </div>
        )}

        {stage === 'review' && draft && imagePreviewUrl && (
          <div className="grid gap-3.5 lg:grid-cols-[1fr_1.2fr]">
            <InvoiceOcrPreview
              imageUrl={imagePreviewUrl}
              mimeType={previewMimeType}
              fileName={fileName}
              className="self-start lg:-rotate-2"
            />
            <ExtractedFieldsForm
              draft={draft}
              providers={providers}
              onChange={setDraft}
              onConfirm={updated => void handleConfirm(updated)}
              onCancel={handleClose}
              isPending={confirmMutation.isPending}
            />
          </div>
        )}

        {stage === 'error' && (
          <div className="rounded-[14px] border border-danger-500/30 bg-danger-50 p-4 text-sm text-danger-700">
            <p className="font-semibold">
              {t('invoiceOcr:error.title', { defaultValue: 'No pude leer esa factura' })}
            </p>
            <p className="mt-1">{errorMsg}</p>
            <button
              type="button"
              onClick={() => {
                setErrorMsg(null);
                setStage('idle');
              }}
              className="btn-outline mt-3"
            >
              {t('invoiceOcr:error.tryAgain', { defaultValue: 'Reintentar' })}
            </button>
          </div>
        )}
      </div>
    </Overlay>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      const idx = result.indexOf('base64,');
      resolve(idx >= 0 ? result.slice(idx + 'base64,'.length) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsDataURL(file);
  });
}
