/**
 * ENG-040a — Provider-invoice OCR preview modal.
 *
 * Reads an image from the operator, ships it to `ai.extractInvoiceLines`,
 * and renders a read-only preview of the structured invoice the vision
 * model returned. Slice 1 keeps this strictly read-only: line-to-product
 * mapping + cart pre-fill lands in slice 1b.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ScanLine, Upload } from 'lucide-react';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';

interface InvoiceOcrPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

type ExtractInvoiceResponse =
  ReturnType<typeof trpc.ai.extractInvoiceLines.useMutation> extends {
    mutateAsync: (...args: never[]) => Promise<infer R>;
  }
    ? R
    : never;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader returned a non-string payload'));
        return;
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

export function InvoiceOcrPreviewModal({ isOpen, onClose }: InvoiceOcrPreviewModalProps) {
  const { t } = useTranslation(['purchases', 'common', 'errors']);
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<ExtractInvoiceResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const extractMutation = trpc.ai.extractInvoiceLines.useMutation({
    onSuccess: (result: ExtractInvoiceResponse) => {
      setInvoice(result);
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'purchases:ocr.error',
    }),
  });

  const handleClose = () => {
    if (extractMutation.isPending) return;
    setFileName(null);
    setInvoice(null);
    setValidationError(null);
    extractMutation.reset();
    onClose();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setInvoice(null);
    setValidationError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setValidationError(t('purchases:ocr.errors.unsupportedType'));
      return;
    }
    if (file.size > MAX_BYTES) {
      setValidationError(t('purchases:ocr.errors.tooLarge'));
      return;
    }

    setFileName(file.name);
    let dataUrl: string;
    try {
      dataUrl = await readFileAsBase64(file);
    } catch (error) {
      setValidationError(
        error instanceof Error ? error.message : t('purchases:ocr.errors.readFailed')
      );
      return;
    }

    await extractMutation
      .mutateAsync({
        imageBase64: dataUrl,
        mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
      })
      .catch(() => {
        // Server-side AI errors are already localized by onErrorToast.
        // Keep this validation box scoped to local file-read failures.
      });
  };

  const isWorking = extractMutation.isPending;
  const data = invoice?.invoice;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('purchases:ocr.title')}
      footer={
        <ModalButton onClick={handleClose} disabled={isWorking}>
          {t('common:actions.close')}
        </ModalButton>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-secondary-600">{t('purchases:ocr.description')}</p>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES.join(',')}
            className="hidden"
            onChange={handleFileChange}
            data-testid="ocr-file-input"
          />
          <button
            type="button"
            className="btn-primary flex items-center gap-2"
            onClick={() => fileInputRef.current?.click()}
            disabled={isWorking}
            data-testid="ocr-upload-button"
          >
            {isWorking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {t('purchases:ocr.uploadCta')}
          </button>
          {fileName && (
            <p className="text-sm text-secondary-500" data-testid="ocr-filename">
              {fileName}
            </p>
          )}
        </div>

        {validationError && (
          <div className="rounded-md border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {validationError}
          </div>
        )}

        {isWorking && (
          <p className="flex items-center gap-2 text-sm text-secondary-600">
            <ScanLine className="h-4 w-4" />
            {t('purchases:ocr.processing')}
          </p>
        )}

        {data && !isWorking && (
          <div className="space-y-3" data-testid="ocr-preview">
            <div className="grid gap-2 sm:grid-cols-2">
              <PreviewField label={t('purchases:ocr.fields.supplierName')} value={data.supplierName} />
              <PreviewField
                label={t('purchases:ocr.fields.supplierTaxId')}
                value={data.supplierTaxId}
              />
              <PreviewField
                label={t('purchases:ocr.fields.invoiceNumber')}
                value={data.invoiceNumber}
              />
              <PreviewField label={t('purchases:ocr.fields.invoiceDate')} value={data.invoiceDate} />
            </div>

            {data.lines.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                    <tr>
                      <th className="px-2 py-1">{t('purchases:ocr.lines.description')}</th>
                      <th className="px-2 py-1 text-right">{t('purchases:ocr.lines.quantity')}</th>
                      <th className="px-2 py-1 text-right">{t('purchases:ocr.lines.unitPrice')}</th>
                      <th className="px-2 py-1 text-right">{t('purchases:ocr.lines.totalLine')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.lines.map((line, idx) => (
                      <tr
                        key={`${line.description}-${idx}`}
                        className="border-t border-secondary-200"
                      >
                        <td className="px-2 py-1 text-secondary-700">{line.description}</td>
                        <td className="px-2 py-1 text-right text-secondary-700">
                          {line.quantity ?? '—'}
                        </td>
                        <td className="px-2 py-1 text-right text-secondary-700">
                          {line.unitPrice !== null ? formatCurrency(line.unitPrice) : '—'}
                        </td>
                        <td className="px-2 py-1 text-right text-secondary-700">
                          {line.totalLine !== null ? formatCurrency(line.totalLine) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-3">
              <PreviewField
                label={t('purchases:ocr.totals.subtotal')}
                value={data.subtotal !== null ? formatCurrency(data.subtotal) : null}
              />
              <PreviewField
                label={t('purchases:ocr.totals.taxAmount')}
                value={data.taxAmount !== null ? formatCurrency(data.taxAmount) : null}
              />
              <PreviewField
                label={t('purchases:ocr.totals.total')}
                value={data.total !== null ? formatCurrency(data.total) : null}
              />
            </div>

            <p className="text-xs text-secondary-500">{t('purchases:ocr.footnote')}</p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function PreviewField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-md border border-secondary-200 bg-secondary-50 px-3 py-2">
      <p className="text-xs uppercase tracking-wide text-secondary-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-secondary-900 break-words">{value ?? '—'}</p>
    </div>
  );
}
