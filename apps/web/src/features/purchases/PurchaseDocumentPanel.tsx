import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/feedback/ToastProvider';
import { invalidateGroups } from '@/lib/invalidateGroups';
import { formatDateTime } from '@/lib/utils';
import type { Purchase } from '@/types';

interface PurchaseDocumentPanelProps {
  purchase: Purchase;
}

const ACCEPTED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const dataUrlPrefix = /^data:[^;]+;base64,/;

export function PurchaseDocumentPanel({ purchase }: PurchaseDocumentPanelProps) {
  const { t } = useTranslation('purchases');
  const toast = useToast();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attached = purchase.document ?? null;

  const attachMutation = trpc.purchases.attachDocument.useMutation({
    onSuccess: async () => {
      await invalidateGroups(utils, [u => u.purchases.list, u => u.purchases.getById]);
      toast.success({ title: t('document.attachSuccess') });
      setError(null);
      setBusy(false);
    },
    onError: () => {
      setError(t('document.attachError'));
      setBusy(false);
    },
  });

  const documentTypeLabel =
    purchase.documentType != null
      ? t(`document.type${purchase.documentType.charAt(0).toUpperCase()}${purchase.documentType.slice(1)}`)
      : t('document.typeNone');

  const handleFileSelected = async (file: File) => {
    if (!ACCEPTED_MIME.includes(file.type as (typeof ACCEPTED_MIME)[number])) {
      setError(t('document.attachError'));
      return;
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      setError(t('document.attachError'));
      return;
    }
    const documentBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(dataUrlPrefix, ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setBusy(true);
    attachMutation.mutate({
      purchaseId: purchase.id,
      fileName: file.name,
      mimeType: file.type as (typeof ACCEPTED_MIME)[number],
      documentBase64,
    });
  };

  const handleViewDocument = async () => {
    setBusy(true);
    setError(null);
    try {
      const document = await utils.purchases.getDocument.fetch({ purchaseId: purchase.id });
      const bytes = Uint8Array.from(atob(document.documentBase64), character =>
        character.charCodeAt(0)
      );
      const blob = new Blob([bytes], { type: document.mimeType });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setError(t('document.attachError'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
      <p className="text-xs uppercase tracking-wide text-secondary-500">
        {t('document.title')}
      </p>
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

      {error && (
        <p className="mt-2 text-sm text-danger-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
