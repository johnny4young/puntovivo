import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/feedback/ToastProvider';
import { invalidateGroups } from '@/lib/invalidateGroups';
import { formatDateTime } from '@/lib/utils';
import type { Purchase } from '@/types';
import {
  getAcceptedPurchaseDocumentMimes,
  preparePurchaseDocumentFile,
} from './preparePurchaseDocumentFile';

interface PurchaseDocumentPanelProps {
  purchase: Purchase;
}

const ACCEPTED_MIME = getAcceptedPurchaseDocumentMimes();

interface DocumentPreview {
  url: string;
  mimeType: string;
  fileName: string | null;
}

/** Base64 → browser object URL. The caller owns revocation. */
function documentObjectUrl(documentBase64: string, mimeType: string): string {
  const bytes = Uint8Array.from(atob(documentBase64), character => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function PurchaseDocumentPanel({ purchase }: PurchaseDocumentPanelProps) {
  const { t } = useTranslation('purchases');
  const toast = useToast();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DocumentPreview | null>(null);
  const attached = purchase.document ?? null;

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview]
  );

  const refreshPurchase = async () => {
    await invalidateGroups(utils, [u => u.purchases.list, u => u.purchases.getById]);
  };

  const attachMutation = trpc.purchases.attachDocument.useMutation({
    onSuccess: async () => {
      await refreshPurchase();
      toast.success({ title: t('document.attachSuccess') });
      setError(null);
      setBusy(false);
    },
    onError: async attachError => {
      // A stale purchase copy with a document already attached cannot accept
      // another upload: say so specifically and refresh so the existing paper
      // becomes visible instead of inviting retries that cannot succeed.
      if ((attachError as { data?: { code?: string } }).data?.code === 'CONFLICT') {
        setError(t('document.attachConflict'));
        await refreshPurchase();
      } else {
        setError(t('document.attachError'));
      }
      setBusy(false);
    },
  });

  const documentTypeLabel =
    purchase.documentType != null
      ? t(
          `document.type${purchase.documentType.charAt(0).toUpperCase()}${purchase.documentType.slice(1)}`
        )
      : t('document.typeNone');

  const handleFileSelected = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const prepared = await preparePurchaseDocumentFile(file);
      attachMutation.mutate({
        purchaseId: purchase.id,
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
        documentBase64: prepared.documentBase64,
      });
    } catch {
      setError(t('document.attachError'));
      setBusy(false);
    }
  };

  const handleViewDocument = async () => {
    setBusy(true);
    setError(null);
    try {
      const document = await utils.purchases.getDocument.fetch({ purchaseId: purchase.id });
      if (preview) URL.revokeObjectURL(preview.url);
      setPreview({
        url: documentObjectUrl(document.documentBase64, document.mimeType),
        mimeType: document.mimeType,
        fileName: document.fileName,
      });
    } catch {
      setError(t('document.attachError'));
    } finally {
      setBusy(false);
    }
  };

  const closePreview = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };

  return (
    <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
      <p className="text-xs uppercase tracking-wide text-secondary-500">{t('document.title')}</p>
      <p className="mt-2 text-sm font-medium text-secondary-900">
        {documentTypeLabel}
        {purchase.documentNumber ? ` · ${purchase.documentNumber}` : ''}
      </p>

      {attached ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-xs text-secondary-500">
            {t('document.attachedOn', { date: formatDateTime(attached.createdAt) })}
          </span>
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2"
            disabled={isBusy}
            onClick={handleViewDocument}
          >
            <Paperclip className="h-4 w-4" aria-hidden="true" />
            {t('document.view')}
          </button>
        </div>
      ) : (
        <div className="mt-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={ACCEPTED_MIME.join(',')}
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void handleFileSelected(file);
            }}
          />
          <button
            type="button"
            className="btn-secondary inline-flex items-center gap-2"
            disabled={isBusy}
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="h-4 w-4" aria-hidden="true" />
            {t('document.attachLabel')}
          </button>
        </div>
      )}

      {/* In-app preview: the desktop build blocks renderer-created windows and
          external blob navigation, so the paper is shown inside the panel. */}
      {preview && (
        <div className="mt-3 space-y-2">
          <p className="text-xs font-semibold text-secondary-700">{t('document.previewTitle')}</p>
          {preview.mimeType === 'application/pdf' ? (
            <iframe
              title={t('document.previewTitle')}
              src={preview.url}
              className="h-96 w-full rounded-lg border border-secondary-200 bg-white"
            />
          ) : (
            <img
              src={preview.url}
              alt={preview.fileName ?? t('document.previewTitle')}
              className="max-h-96 w-full rounded-lg border border-secondary-200 bg-white object-contain"
            />
          )}
          <div className="flex flex-wrap gap-3">
            <a
              href={preview.url}
              download={preview.fileName ?? 'documento'}
              className="btn-secondary inline-flex items-center"
            >
              {t('document.download')}
            </a>
            <button type="button" className="btn-secondary" onClick={closePreview}>
              {t('document.close')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 text-sm text-danger-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
