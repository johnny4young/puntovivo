import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

interface InvoiceOcrPreviewProps {
  imageUrl: string;
  mimeType?: string | null;
  fileName?: string | null;
  animateScan?: boolean;
  className?: string;
}

export function InvoiceOcrPreview({
  imageUrl,
  mimeType,
  fileName,
  animateScan = false,
  className,
}: InvoiceOcrPreviewProps) {
  const { t } = useTranslation('invoiceOcr');
  const isPdf = mimeType === 'application/pdf';
  return (
    <div
      data-testid="invoice-ocr-preview"
      className={cn(
        'relative overflow-hidden rounded-[10px] border border-line bg-warning-50/45 font-mono text-secondary-800',
        className
      )}
    >
      {isPdf ? (
        <div className="grid min-h-[18rem] place-items-center px-6 py-10 text-center">
          <div>
            <p className="font-mono text-sm font-semibold text-secondary-900">
              {fileName ?? 'invoice.pdf'}
            </p>
            <p className="mt-2 text-xs text-secondary-500">{t('preview.pdfOnePage')}</p>
          </div>
        </div>
      ) : (
        <img
          src={imageUrl}
          alt=""
          className="block max-h-[min(60vh,34rem)] w-full object-contain"
          draggable={false}
        />
      )}
      {animateScan && <div aria-hidden="true" className="ocr-scan-band" />}
    </div>
  );
}
