/**
 * Fiscal Document detail Drawer.
 *
 * Read-only slide-over holding the fiscal-documents columns trimmed off the
 * default list table (provider id, full CUFE) plus the full record, so the
 * admin compliance table can default to the smallest useful column set (when,
 * document number, kind, status, buyer, total). Reuses the shared `Drawer`
 * primitive () and mirrors the  detail drawers. The footer
 * "View XML" action hands off to the existing `FiscalDocumentXmlModal` (wired
 * by the caller) and only renders when the document has an XML ref.
 *
 * @module features/fiscal/FiscalDocumentDetailsDrawer
 */
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FileCode2 } from 'lucide-react';
import { Drawer } from '@/components/feedback/Drawer';
import { formatCurrency, formatDateTime } from '@/lib/utils';
import {
  FiscalStatusBadge,
  type FiscalDocumentStatus,
} from '@/components/fiscal/FiscalStatusBadge';
import { FiscalMaturityBadge } from '@/components/fiscal/FiscalMaturityBadge';
import type { FiscalDocumentListItem } from '@/types';

/**
 * Props for {@link FiscalDocumentDetailsDrawer}. The Drawer is open exactly
 * when `item` is non-null (the parent owns the open/close state).
 */
export interface FiscalDocumentDetailsDrawerProps {
  /** The fiscal-document row to detail. `null` keeps the Drawer closed. */
  item: FiscalDocumentListItem | null;
  /** Close the Drawer (ESC / backdrop / close button). */
  onClose: () => void;
  /**
   * Open the XML viewer for this document. Omitted (or simply not rendered)
   * when the document has no XML ref. The caller hands off to the existing
   * `FiscalDocumentXmlModal`.
   */
  onViewXml?: ((item: FiscalDocumentListItem) => void) | undefined;
}

/** One label/value row in the read-only detail list. */
function DetailField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line/60 py-2 last:border-0">
      <dt className="text-sm text-secondary-500">{label}</dt>
      <dd className="text-right text-sm font-medium text-secondary-900">{value}</dd>
    </div>
  );
}

export function FiscalDocumentDetailsDrawer({
  item,
  onClose,
  onViewXml,
}: FiscalDocumentDetailsDrawerProps) {
  const { t } = useTranslation('fiscal');

  const footer = item ? (
    <div className="flex justify-end gap-2">
      <button type="button" className="btn-outline" onClick={onClose}>
        {t('list.details.close')}
      </button>
      {item.xmlRef && onViewXml ? (
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2"
          onClick={() => onViewXml(item)}
        >
          <FileCode2 className="h-4 w-4" aria-hidden="true" />
          {t('document.xml.viewButton')}
        </button>
      ) : null}
    </div>
  ) : undefined;

  return (
    <Drawer
      isOpen={!!item}
      onClose={onClose}
      title={item?.documentNumber ?? t('list.details.title')}
      size="md"
      testId="fiscal-document-details-drawer"
      footer={footer}
    >
      {item && (
        <dl data-testid="fiscal-document-details-fields">
          <DetailField label={t('list.columns.emittedAt')} value={formatDateTime(item.emittedAt)} />
          <DetailField label={t('list.columns.kind')} value={t(`kind.${item.kind}`)} />
          <DetailField
            label={t('list.columns.status')}
            value={
              <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
                <FiscalStatusBadge status={item.status as FiscalDocumentStatus} />
                <FiscalMaturityBadge maturity={item.maturity} />
              </span>
            }
          />
          <DetailField label={t('list.columns.documentNumber')} value={item.documentNumber} />
          <DetailField label={t('list.columns.buyer')} value={item.buyerName} />
          <DetailField
            label={t('list.columns.total')}
            value={formatCurrency(item.totalAmount, item.currencyCode)}
          />
          <DetailField label={t('list.columns.provider')} value={item.providerId} />
          <DetailField
            label={t('list.columns.cufe')}
            value={<span className="break-all font-mono text-xs">{item.cufe}</span>}
          />
        </dl>
      )}
    </Drawer>
  );
}
