import { useMemo, useState } from 'react';
import { ImageDown, MessageCircle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { downloadFile } from '@/services/export/exportService';
import {
  buildReceiptImageFilename,
  buildReceiptWhatsAppUrl,
  createReceiptPng,
  shareReceiptImage,
} from './receiptShare';

interface ReceiptSharePanelProps {
  saleId: string;
  siteId: string;
  onClose: () => void;
}

/** The exact WhatsApp message, then the two handoffs; the cashier picks the contact and sends. */
export function ReceiptSharePanel({ saleId, siteId, onClose }: ReceiptSharePanelProps) {
  const { t } = useTranslation('receiptShare');
  const [isGenerating, setIsGenerating] = useState(false);
  const [imageState, setImageState] = useState<'idle' | 'ready' | 'error'>('idle');
  const shareQuery = trpc.peripherals.renderReceiptShare.useQuery(
    { saleId, siteId },
    { staleTime: 0 }
  );
  const shareUrl = useMemo(
    () => (shareQuery.data ? buildReceiptWhatsAppUrl(shareQuery.data.text) : null),
    [shareQuery.data]
  );

  async function prepareImage(): Promise<void> {
    const share = shareQuery.data;
    if (!share || isGenerating) return;
    if (!share.html) {
      setImageState('error');
      return;
    }

    setIsGenerating(true);
    setImageState('idle');
    try {
      const image = await createReceiptPng(share.html);
      const filename = buildReceiptImageFilename(share.saleNumber);
      // Phones hand the picture to the share sheet; elsewhere it lands in downloads.
      if (!(await shareReceiptImage(image, filename))) {
        downloadFile(image, filename);
        setImageState('ready');
      }
    } catch {
      setImageState('error');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section
      className="receipt-share-card mb-5"
      aria-labelledby="receipt-share-title"
      data-testid="receipt-share-panel"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id="receipt-share-title" className="sales-cap">
          {t('title')}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label={t('close')}
          className="-mr-2 shrink-0"
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      {shareQuery.data && (
        <p className="receipt-share-bubble" data-testid="receipt-share-preview">
          {shareQuery.data.text}
        </p>
      )}
      {shareQuery.isLoading && (
        <p role="status" className="text-sm text-fg2">
          {t('loading')}
        </p>
      )}
      {shareQuery.error && (
        <p role="alert" className="text-sm text-danger-700">
          {t('loadError')}
        </p>
      )}
      <p className="text-[13px] leading-snug text-fg3">{t('description')}</p>

      {imageState === 'ready' && (
        <p role="status" className="text-sm text-success-700">
          {t('imageReady')}
        </p>
      )}
      {(imageState === 'error' || shareQuery.data?.status === 'text-fallback') && (
        <p role="alert" className="text-sm text-warning-700">
          {t('imageFallback')}
        </p>
      )}

      <div className="flex gap-2">
        {shareUrl ? (
          <a
            className={cn(
              buttonVariants({ variant: 'primary' }),
              'min-h-13 flex-1 justify-center whitespace-nowrap'
            )}
            href={shareUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="receipt-share-whatsapp"
          >
            <MessageCircle aria-hidden="true" />
            {t('openWhatsApp')}
          </a>
        ) : (
          <Button
            type="button"
            className="min-h-13 flex-1 justify-center whitespace-nowrap"
            disabled
          >
            <MessageCircle aria-hidden="true" />
            {t('openWhatsApp')}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="min-h-13 justify-center"
          disabled={!shareQuery.data?.html || isGenerating}
          onClick={() => void prepareImage()}
          data-testid="receipt-share-image"
        >
          <ImageDown
            className={isGenerating ? 'motion-safe:animate-pulse' : ''}
            aria-hidden="true"
          />
          {isGenerating ? t('generating') : t('download')}
        </Button>
      </div>
    </section>
  );
}
