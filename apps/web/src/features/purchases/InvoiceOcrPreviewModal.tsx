/**
 * ENG-040a — Provider-invoice OCR preview modal.
 * ENG-040 slice 1b — adds the line-to-product matching pass plus a
 * "Create purchase with matches" CTA that pre-fills the parent cart.
 *
 * Reads an image from the operator, ships it to `ai.extractInvoiceLines`,
 * and renders a preview of the structured invoice. Matched lines are
 * surfaced inline; the operator can then push the matches into the
 * draft purchase via `onMatchedLinesReady`. Unmatched lines remain
 * visible so they can be added manually with the regular product
 * picker.
 */
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, ScanLine, Sparkles, ShoppingCart, Upload } from 'lucide-react';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { useIsModuleActive } from '@/features/modules';
import { onErrorToast } from '@/lib/mutationHelpers';
import { trpc } from '@/lib/trpc';
import { formatCurrency } from '@/lib/utils';
import type { PurchaseCartItem } from './purchaseCart';

interface InvoiceOcrPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Slice 1b — handler invoked when the operator clicks "Create
   * purchase with matches". Receives one item per matched line in the
   * exact shape `PurchasesPage` already merges into its cart state.
   */
  onMatchedLinesReady?: (items: PurchaseCartItem[]) => void;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;

type ExtractInvoiceResponse =
  ReturnType<typeof trpc.ai.extractInvoiceLines.useMutation> extends {
    mutateAsync: (...args: never[]) => Promise<infer R>;
  }
    ? R
    : never;

type MatchInvoiceLinesResponse =
  ReturnType<typeof trpc.ai.matchInvoiceLines.useMutation> extends {
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

export function InvoiceOcrPreviewModal({
  isOpen,
  onClose,
  onMatchedLinesReady,
}: InvoiceOcrPreviewModalProps) {
  const { t } = useTranslation(['purchases', 'common', 'errors']);
  const toast = useToast();
  const semanticSearchActive = useIsModuleActive('semantic-search');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [invoice, setInvoice] = useState<ExtractInvoiceResponse | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [matchResult, setMatchResult] = useState<MatchInvoiceLinesResponse | null>(null);

  const extractMutation = trpc.ai.extractInvoiceLines.useMutation({
    onSuccess: (result: ExtractInvoiceResponse) => {
      setInvoice(result);
      setMatchResult(null);
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'purchases:ocr.error',
    }),
  });

  const matchMutation = trpc.ai.matchInvoiceLines.useMutation({
    onSuccess: (result: MatchInvoiceLinesResponse) => {
      setMatchResult(result);
    },
    onError: onErrorToast(toast, t, {
      titleKey: 'purchases:ocr.error',
    }),
  });

  const handleClose = () => {
    if (extractMutation.isPending || matchMutation.isPending) return;
    setFileName(null);
    setInvoice(null);
    setMatchResult(null);
    setValidationError(null);
    extractMutation.reset();
    matchMutation.reset();
    onClose();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setInvoice(null);
    setMatchResult(null);
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

  const handleMatch = async () => {
    if (!invoice?.invoice.lines.length) return;
    await matchMutation
      .mutateAsync({
        lines: invoice.invoice.lines.map(line => ({
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          totalLine: line.totalLine,
        })),
      })
      .catch(() => {
        // onErrorToast handles surfaced server errors. The match result
        // stays null so the CTA can be retried by the operator.
      });
  };

  const handleCreatePurchase = () => {
    if (!matchResult || matchResult.mode !== 'matched' || !onMatchedLinesReady) return;
    const items: PurchaseCartItem[] = [];
    let unmatched = 0;
    for (const entry of matchResult.matches) {
      if (!entry.product) {
        unmatched += 1;
        continue;
      }
      const line = entry.line;
      const quantity = line.quantity !== null && line.quantity > 0 ? line.quantity : 1;
      const costPerUnit =
        line.unitPrice !== null && line.unitPrice >= 0
          ? line.unitPrice
          : entry.product.cost;
      items.push({
        key: `${entry.product.productId}:${entry.product.unitId}`,
        productId: entry.product.productId,
        productName: entry.product.productName,
        productSku: entry.product.productSku,
        unitId: entry.product.unitId,
        unitName:
          entry.product.unitName ??
          entry.product.unitAbbreviation ??
          entry.product.unitId,
        unitEquivalence: entry.product.unitEquivalence,
        quantity,
        costPerUnit,
        currentStock: entry.product.stock,
      });
    }
    if (items.length === 0 && unmatched === 0) return;
    onMatchedLinesReady(items);
    if (items.length > 0) {
      toast.success({
        title: t('purchases:ocr.match.toastMatched', { count: items.length }),
      });
    }
    if (unmatched > 0) {
      toast.info({
        title: t('purchases:ocr.match.toastUnmatched', { count: unmatched }),
      });
    }
    handleClose();
  };

  const isWorking = extractMutation.isPending;
  const isMatching = matchMutation.isPending;
  const data = invoice?.invoice;

  // Render-side flags that gate the slice 1b CTAs. The match column +
  // CTAs only appear when the operator has read an invoice AND the
  // tenant has the semantic-search module active. Hiding the CTA when
  // the module is off avoids surfacing the underlying tRPC FORBIDDEN
  // (the procedure itself stays gated for defense-in-depth).
  const hasLines = Boolean(data?.lines.length);
  const showMatchCta = hasLines && semanticSearchActive;
  const matchFailed = matchMutation.isError && matchResult === null;
  const matchUnavailable =
    matchResult !== null && matchResult.mode === 'unavailable';
  const matchedRows =
    matchResult !== null && matchResult.mode === 'matched' ? matchResult.matches : null;
  const matchedItemCount = useMemo(
    () =>
      matchedRows
        ? matchedRows.filter(entry => entry.product !== null).length
        : 0,
    [matchedRows]
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={t('purchases:ocr.title')}
      footer={
        <div className="flex w-full items-center justify-between gap-2">
          {matchedRows && matchedItemCount > 0 ? (
            <button
              type="button"
              className="btn-primary w-full sm:w-auto sm:min-w-[9rem]"
              onClick={handleCreatePurchase}
              disabled={isMatching || !onMatchedLinesReady}
              data-testid="ocr-create-purchase-button"
            >
              {t('purchases:ocr.match.createPurchaseCta')}
            </button>
          ) : (
            <span />
          )}
          <ModalButton onClick={handleClose} disabled={isWorking || isMatching}>
            {t('common:actions.close')}
          </ModalButton>
        </div>
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
            disabled={isWorking || isMatching}
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
              <>
                {showMatchCta && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn-outline flex items-center gap-2"
                      onClick={handleMatch}
                      disabled={isMatching}
                      data-testid="ocr-match-button"
                    >
                      {isMatching ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {isMatching
                        ? t('purchases:ocr.match.loading')
                        : matchFailed
                          ? t('purchases:ocr.match.retryCta')
                          : t('purchases:ocr.match.cta')}
                    </button>
                    {matchUnavailable && (
                      <p
                        className="text-sm text-warning-700"
                        data-testid="ocr-match-unavailable"
                      >
                        {t('purchases:ocr.match.unavailable')}
                      </p>
                    )}
                  </div>
                )}
                {!semanticSearchActive && (
                  <p
                    className="rounded-md border border-secondary-200 bg-secondary-50 px-3 py-2 text-xs text-secondary-600"
                    data-testid="ocr-match-module-hint"
                  >
                    {t('purchases:ocr.match.moduleHint')}
                  </p>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-left text-xs uppercase tracking-wide text-secondary-500">
                      <tr>
                        <th className="px-2 py-1">{t('purchases:ocr.lines.description')}</th>
                        <th className="px-2 py-1 text-right">{t('purchases:ocr.lines.quantity')}</th>
                        <th className="px-2 py-1 text-right">{t('purchases:ocr.lines.unitPrice')}</th>
                        <th className="px-2 py-1 text-right">{t('purchases:ocr.lines.totalLine')}</th>
                        {matchedRows && (
                          <th className="px-2 py-1 text-left">
                            {t('purchases:ocr.match.suggestedColumn')}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {data.lines.map((line, idx) => {
                        const match = matchedRows?.[idx] ?? null;
                        return (
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
                            {matchedRows && (
                              <td
                                className="px-2 py-1 text-secondary-700"
                                data-testid={`ocr-match-cell-${idx}`}
                              >
                                {match?.product ? (
                                  <span className="flex items-center gap-2">
                                    <span className="flex items-center gap-1">
                                      <ShoppingCart className="h-3.5 w-3.5 text-success-600" />
                                      {match.product.productName}
                                    </span>
                                    {match.similarity !== null && (
                                      <span className="rounded-full bg-success-50 px-2 py-0.5 text-xs text-success-700">
                                        {t('purchases:ocr.match.confidence', {
                                          percent: Math.round(match.similarity * 100),
                                        })}
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span className="rounded-full border border-warning-300 bg-warning-50 px-2 py-0.5 text-xs text-warning-700">
                                    {t('purchases:ocr.match.unmatchedPill')}
                                  </span>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
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
