import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import type { EditorReceiptLayout } from './defaultLayouts';

interface ReceiptTemplatePreviewProps {
  layout: EditorReceiptLayout;
  kind: 'sale' | 'quotation' | 'fiscal_dee';
  /**
   * Optional CSS string applied to the preview container — lets the
   * editor frame the receipt with a paper-like shadow without leaking
   * styles into the receipt's own CSS scope (the iframe srcDoc keeps
   * the receipt isolated from the host stylesheet).
   */
  className?: string;
}

/**
 * Renders the live editor preview by piping the in-memory layout through
 * the server's `renderPreview` procedure. The HTML is mounted in an
 * iframe with `srcDoc` so the receipt's own CSS cannot affect the host
 * page (and vice versa) — important because the host uses Tailwind
 * utilities and the receipt is hard-coded to a courier monospace look
 * that would clash if rendered inline.
 */
export function ReceiptTemplatePreview({
  layout,
  kind,
  className,
}: ReceiptTemplatePreviewProps) {
  const { t } = useTranslation(['receiptTemplates', 'errors']);
  // Debounce client-side so a fast typist in a text block does not
  // blast the server with one query per keystroke. The renderer is
  // server-side because it is the same code path used at print time —
  // we want the preview and the production output to always agree.
  const [debouncedLayout, setDebouncedLayout] = useState(layout);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(() => {
      setDebouncedLayout(layout);
    }, 200);
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [layout]);

  const previewLabels = useMemo(
    () => ({
      documentTitle: t('preview.documentTitle'),
      itemColumns: {
        name: t('editor.blockColumns.name'),
        qty: t('editor.blockColumns.qty'),
        unitPrice: t('editor.blockColumns.unitPrice'),
        taxPercent: t('editor.blockColumns.taxPercent'),
        discount: t('editor.blockColumns.discount'),
        total: t('editor.blockColumns.total'),
      },
      totalsLines: {
        subtotal: t('editor.totalsLines.subtotal'),
        discount: t('editor.totalsLines.discount'),
        taxTotal: t('editor.totalsLines.taxTotal'),
        tip: t('editor.totalsLines.tip'),
        grandTotal: t('editor.totalsLines.grandTotal'),
      },
      tendersTable: {
        method: t('preview.tendersTable.method'),
        reference: t('preview.tendersTable.reference'),
        amount: t('preview.tendersTable.amount'),
        change: t('preview.tendersTable.change'),
      },
    }),
    [t]
  );

  const previewQuery = trpc.receiptTemplates.renderPreview.useQuery(
    { layout: debouncedLayout, kind, labels: previewLabels },
    {
      // The preview is read-only and stable until the layout changes;
      // there is no benefit to refetching on focus.
      refetchOnWindowFocus: false,
      staleTime: Infinity,
    }
  );

  return (
    <div
      className={className ?? 'rounded-lg border border-line bg-surface p-4 shadow-sm'}
    >
      {previewQuery.isLoading ? (
        <div className="flex h-72 items-center justify-center text-sm text-secondary-500">
          …
        </div>
      ) : previewQuery.error ? (
        <div className="text-sm text-error">
          {translateServerError(
            previewQuery.error,
            t,
            t('errors:server.unknown')
          )}
        </div>
      ) : (
        <iframe
          title={t('editor.previewPanel.title')}
          data-testid="receipt-preview-iframe"
          className="h-[36rem] w-full border-0 bg-white"
          srcDoc={previewQuery.data?.html ?? ''}
          sandbox=""
        />
      )}
    </div>
  );
}
