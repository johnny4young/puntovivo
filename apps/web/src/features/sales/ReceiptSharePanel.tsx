import { useMemo, useState } from 'react';
import { Download, MessageCircle, ShieldCheck, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, buttonVariants } from '@/components/ui';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { downloadFile } from '@/services/export/exportService';
import {
  buildReceiptImageFilename,
  buildReceiptWhatsAppUrl,
  createReceiptPng,
} from './receiptShare';

interface ReceiptSharePanelProps {
  saleId: string;
  siteId: string;
  onClose: () => void;
}

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
      downloadFile(image, buildReceiptImageFilename(share.saleNumber));
      setImageState('ready');
    } catch {
      setImageState('error');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section
      className="mb-5 overflow-hidden rounded-2xl border border-primary-200 bg-primary-50/70"
      aria-labelledby="receipt-share-title"
      data-testid="receipt-share-panel"
    >
      <div className="flex items-start justify-between gap-4 border-b border-primary-200 px-4 py-3 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 rounded-xl bg-primary-100 p-2 text-primary-700">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 id="receipt-share-title" className="font-semibold text-secondary-950">
              {t('title')}
            </h3>
            <p className="mt-1 text-sm leading-5 text-secondary-600">
              {t('description')}
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label={t('close')}
          className="shrink-0"
        >
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="space-y-3 px-4 py-4 sm:px-5">
        <div className="rounded-xl border border-secondary-200 bg-white px-4 py-3 text-sm text-secondary-700">
          <p className="font-medium text-secondary-950">{t('reviewTitle')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 leading-5">
            <li>{t('customerOnly')}</li>
            <li>{t('manualSend')}</li>
            <li>{t('localImage')}</li>
          </ul>
        </div>

        {shareQuery.isLoading && (
          <p role="status" className="text-sm text-secondary-600">
            {t('loading')}
          </p>
        )}
        {shareQuery.error && (
          <p role="alert" className="text-sm text-danger-700">
            {t('loadError')}
          </p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            className="flex-1 justify-center"
            disabled={!shareQuery.data?.html || isGenerating}
            onClick={() => void prepareImage()}
          >
            <Download className={isGenerating ? 'animate-pulse' : ''} aria-hidden="true" />
            {isGenerating ? t('generating') : t('download')}
          </Button>
          {shareUrl ? (
            <a
              className={cn(buttonVariants({ variant: 'primary' }), 'flex-1 justify-center')}
              href={shareUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void prepareImage()}
              data-testid="receipt-share-whatsapp"
            >
              <MessageCircle aria-hidden="true" />
              {t('openWhatsApp')}
            </a>
          ) : (
            <Button type="button" className="flex-1 justify-center" disabled>
              <MessageCircle aria-hidden="true" />
              {t('openWhatsApp')}
            </Button>
          )}
        </div>

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
      </div>
    </section>
  );
}
