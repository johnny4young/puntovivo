import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Paperclip } from 'lucide-react';
import {
  PURCHASE_DOCUMENT_MIME_TYPES,
  purchaseDocumentExtensionForMime,
  type PurchaseDocumentType,
} from '@puntovivo/shared/purchase-documents';
import { useAuth } from '@/features/auth/AuthProvider';
import { trpc } from '@/lib/trpc';
import { useToast } from '@/components/feedback/ToastProvider';
import { invalidateGroups } from '@/lib/invalidateGroups';
import { formatDateTime } from '@/lib/utils';
import type { Purchase } from '@/types';

interface PurchaseDocumentPanelProps {
  purchase: Purchase;
}

const ACCEPTED_MIME = PURCHASE_DOCUMENT_MIME_TYPES;

const DOCUMENT_TYPE_KEYS: Record<PurchaseDocumentType, string> = {
  invoice: 'document.typeInvoice',
  remision: 'document.typeRemision',
  other: 'document.typeOther',
};

interface DocumentPreview {
  purchaseId: string;
  url: string;
  mimeType: string;
  fileName: string | null;
}

interface ScopedError {
  purchaseId: string;
  message: string;
}

/** Base64 → browser object URL. The caller owns revocation. */
function documentObjectUrl(documentBase64: string, mimeType: string): string {
  const binary = atob(documentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

export function PurchaseDocumentPanel({ purchase }: PurchaseDocumentPanelProps) {
  const { t } = useTranslation('purchases');
  const { user } = useAuth();
  const toast = useToast();
  const utils = trpc.useUtils();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const viewRequestIdRef = useRef(0);
  const [busyPurchaseId, setBusyPurchaseId] = useState<string | null>(null);
  const [errorState, setErrorState] = useState<ScopedError | null>(null);
  const [previewState, setPreviewState] = useState<DocumentPreview | null>(null);
  const [renderedPurchaseId, setRenderedPurchaseId] = useState(purchase.id);
  if (renderedPurchaseId !== purchase.id) {
    // Dropping the preview lets its cleanup effect revoke the blob URL.
    setRenderedPurchaseId(purchase.id);
    setPreviewState(null);
  }
  const attached = purchase.document ?? null;
  const canManageDocument = user?.role === 'admin' || user?.role === 'manager';
  const isBusy = busyPurchaseId === purchase.id;
  const preview = previewState?.purchaseId === purchase.id ? previewState : null;
  const error = errorState?.purchaseId === purchase.id ? errorState.message : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      viewRequestIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    viewRequestIdRef.current += 1;
  }, [purchase.id]);

  useEffect(
    () => () => {
      if (previewState) URL.revokeObjectURL(previewState.url);
    },
    [previewState]
  );

  const setError = (message: string | null) => {
    setErrorState(message ? { purchaseId: purchase.id, message } : null);
  };

  const refreshPurchase = async () => {
    await invalidateGroups(utils, [u => u.purchases.list, u => u.purchases.getById]);
  };

  const attachMutation = trpc.purchases.attachDocument.useMutation({
    onSuccess: async (_data, variables) => {
      await refreshPurchase();
      toast.success({ title: t('document.attachSuccess') });
      if (mountedRef.current) {
        setErrorState(current => (current?.purchaseId === variables.purchaseId ? null : current));
        setBusyPurchaseId(current => (current === variables.purchaseId ? null : current));
      }
    },
    onError: async (attachError, variables) => {
      // A stale purchase copy with a document already attached cannot accept
      // another upload: say so specifically and refresh so the existing paper
      // becomes visible instead of inviting retries that cannot succeed.
      if (attachError.data?.code === 'CONFLICT') {
        if (mountedRef.current) {
          setErrorState({
            purchaseId: variables.purchaseId,
            message: t('document.attachConflict'),
          });
        }
        await refreshPurchase();
      } else if (mountedRef.current) {
        setErrorState({ purchaseId: variables.purchaseId, message: t('document.attachError') });
      }
      if (mountedRef.current) {
        setBusyPurchaseId(current => (current === variables.purchaseId ? null : current));
      }
    },
  });

  const documentIdentityLabel = (() => {
    if (purchase.documentType != null) {
      const typeLabel = t(DOCUMENT_TYPE_KEYS[purchase.documentType]);
      return purchase.documentNumber ? `${typeLabel} · ${purchase.documentNumber}` : typeLabel;
    }
    if (purchase.documentNumber) return purchase.documentNumber;
    if (attached) return attached.fileName ?? t('document.typeOther');
    return t('document.typeNone');
  })();

  const handleFileSelected = async (file: File) => {
    const activePurchaseId = purchase.id;
    setBusyPurchaseId(activePurchaseId);
    setError(null);
    try {
      const { preparePurchaseDocumentFile } = await import('./preparePurchaseDocumentFile');
      const prepared = await preparePurchaseDocumentFile(file);
      // A background refetch can remount the panel; the upload must still go out.
      attachMutation.mutate({
        purchaseId: activePurchaseId,
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
        documentBase64: prepared.documentBase64,
      });
    } catch (prepareError) {
      if (!mountedRef.current) return;
      const message = prepareError instanceof Error ? prepareError.message : '';
      if (message === 'EMPTY_DOCUMENT') {
        setErrorState({ purchaseId: activePurchaseId, message: t('document.errorEmpty') });
      } else if (message === 'DOCUMENT_TOO_LARGE') {
        setErrorState({ purchaseId: activePurchaseId, message: t('document.errorTooLarge') });
      } else if (message === 'UNSUPPORTED_MIME') {
        setErrorState({
          purchaseId: activePurchaseId,
          message: t('document.errorUnsupportedType'),
        });
      } else {
        setErrorState({ purchaseId: activePurchaseId, message: t('document.attachError') });
      }
      setBusyPurchaseId(current => (current === activePurchaseId ? null : current));
    }
  };

  const handleViewDocument = async () => {
    const activePurchaseId = purchase.id;
    const requestId = viewRequestIdRef.current + 1;
    viewRequestIdRef.current = requestId;
    setBusyPurchaseId(activePurchaseId);
    setError(null);
    try {
      // Avoid retaining large base64 payloads in the React Query cache.
      const document = await utils.purchases.getDocument.fetch(
        { purchaseId: activePurchaseId },
        { gcTime: 0, staleTime: 0 }
      );
      if (!mountedRef.current || requestId !== viewRequestIdRef.current) return;
      setPreviewState({
        purchaseId: activePurchaseId,
        url: documentObjectUrl(document.documentBase64, document.mimeType),
        mimeType: document.mimeType,
        fileName: document.fileName,
      });
    } catch {
      if (!mountedRef.current || requestId !== viewRequestIdRef.current) return;
      setErrorState({ purchaseId: activePurchaseId, message: t('document.viewError') });
    } finally {
      if (mountedRef.current) {
        setBusyPurchaseId(current => (current === activePurchaseId ? null : current));
      }
    }
  };

  const closePreview = () => {
    setPreviewState(null);
  };

  const downloadFileName = preview
    ? (preview.fileName ??
      `${t('document.defaultFileName')}${purchaseDocumentExtensionForMime(preview.mimeType)}`)
    : undefined;

  return (
    <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4">
      <p className="text-xs uppercase tracking-wide text-secondary-500">{t('document.title')}</p>
      <p className="mt-2 text-sm font-medium text-secondary-900">{documentIdentityLabel}</p>

      {attached ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span className="text-xs text-secondary-500">
            {t('document.attachedOn', { date: formatDateTime(attached.createdAt) })}
          </span>
          {canManageDocument && (
            <button
              type="button"
              className="btn-secondary inline-flex items-center gap-2"
              disabled={isBusy}
              onClick={handleViewDocument}
            >
              <Paperclip className="h-4 w-4" aria-hidden="true" />
              {t('document.view')}
            </button>
          )}
        </div>
      ) : canManageDocument ? (
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
      ) : null}

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
              download={downloadFileName}
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
