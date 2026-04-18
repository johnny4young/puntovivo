import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { QuotationsHistoryTable } from './QuotationsHistoryTable';
import { QuotationCreateModal } from './QuotationCreateModal';
import { QuotationDetailsModal } from './QuotationDetailsModal';

/**
 * Phase 5 / Tier-2 #6 step 1 — top-level Quotations page.
 *
 * Composes the history table with the create + details modals. The create
 * modal is keyed by an instance counter so each open mounts a fresh form
 * tree (no leftover lines from a previous submission); the details modal is
 * keyed by `quotationId` for the same reason.
 */
export function QuotationsPage() {
  const { t } = useTranslation('quotations');

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createInstance, setCreateInstance] = useState(0);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const handleOpenCreate = useCallback(() => {
    setCreateInstance(prev => prev + 1);
    setIsCreateOpen(true);
  }, []);

  const handleCloseCreate = useCallback(() => {
    setIsCreateOpen(false);
  }, []);

  const handleOpenDetails = useCallback((id: string) => {
    setDetailsId(id);
  }, []);

  const handleCloseDetails = useCallback(() => {
    setDetailsId(null);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="page-kicker">{t('page.kicker')}</p>
          <h1 className="text-2xl font-semibold text-secondary-900">
            {t('page.title')}
          </h1>
          <p className="text-sm text-secondary-600">{t('page.description')}</p>
        </div>
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2"
          onClick={handleOpenCreate}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('page.newAction')}
        </button>
      </div>

      <QuotationsHistoryTable onOpenDetails={handleOpenDetails} />

      <QuotationCreateModal
        key={`create-${createInstance}`}
        isOpen={isCreateOpen}
        onClose={handleCloseCreate}
      />

      <QuotationDetailsModal
        key={detailsId ?? 'details-closed'}
        isOpen={detailsId !== null}
        quotationId={detailsId}
        onClose={handleCloseDetails}
      />
    </div>
  );
}
