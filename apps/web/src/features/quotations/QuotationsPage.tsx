import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useToast } from '@/components/feedback/ToastProvider';
import { useAuth } from '@/features/auth/AuthProvider';
import type { SaleCartItem } from '@/features/sales/saleCart';
import { useCartWorkspaceStore } from '@/features/sales/useCartWorkspaceStore';
import { useTenant } from '@/features/tenant/TenantProvider';
import { translateServerError } from '@/lib/translateServerError';
import { trpc } from '@/lib/trpc';
import { QuotationsHistoryTable } from './QuotationsHistoryTable';
import { QuotationCreateModal } from './QuotationCreateModal';
import { QuotationDetailsModal } from './QuotationDetailsModal';
import { canConvertQuotation } from './quotationStatus';

/**
 * top-level Quotations page.
 *
 * Composes the history table with the create + details modals. The create
 * modal is keyed by an instance counter so each open mounts a fresh form
 * tree (no leftover lines from a previous submission); the details modal is
 * keyed by `quotationId` for the same reason.
 */
export function QuotationsPage() {
  const { t } = useTranslation(['quotations', 'quotationPayablesErrors', 'errors']);
  const navigate = useNavigate();
  const toast = useToast();
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const { currentTenant, currentSite } = useTenant();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createInstance, setCreateInstance] = useState(0);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [convertingQuotationId, setConvertingQuotationId] = useState<string | null>(null);
  const conversionInFlightRef = useRef<string | null>(null);

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

  const handleConvertToSale = useCallback(
    async (quotationId: string) => {
      if (conversionInFlightRef.current) return;
      if (!currentTenant || !currentSite || !user) {
        toast.error({
          title: t('conversion.errorTitle'),
          description: t('conversion.siteRequired'),
        });
        return;
      }

      conversionInFlightRef.current = quotationId;
      setConvertingQuotationId(quotationId);
      try {
        // Re-read immediately before hydration: list rows may be cached while
        // another register converts/expires the quotation.
        const quotation = await utils.quotations.getById.fetch(
          { id: quotationId },
          // The app-wide query cache stays fresh for five minutes. Conversion
          // preparation is a correctness boundary, so it must bypass that
          // window and observe a conversion/expiry performed elsewhere.
          { staleTime: 0 }
        );
        if (!canConvertQuotation(quotation)) {
          toast.error({
            title: t('conversion.errorTitle'),
            description: t('conversion.notAvailable'),
          });
          return;
        }
        if (quotation.siteId !== currentSite.id) {
          toast.error({
            title: t('conversion.errorTitle'),
            description: t('conversion.siteMismatch', { site: quotation.siteName }),
          });
          return;
        }
        if (quotation.items.some(item => !item.unitId || item.unitEquivalence == null)) {
          toast.error({
            title: t('conversion.errorTitle'),
            description: t('conversion.unitSnapshotMissing'),
          });
          return;
        }

        const items: SaleCartItem[] = quotation.items.map(item => ({
          // Quotation rows remain distinct even when two rows reference the
          // same product/unit. Collapsing them would lose immutable line ids.
          key: `quotation:${item.id}`,
          sourceQuotationItemId: item.id,
          productId: item.productId,
          productName: item.productName,
          productSku: item.productSku,
          unitId: item.unitId!,
          unitName: item.unitName ?? item.unitAbbreviation ?? item.unitId!,
          unitEquivalence: item.unitEquivalence!,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discount: item.discount,
          taxRate: item.taxRate,
          taxComponents: (item.taxComponents ?? []).flatMap(component =>
            component.vatRateId ? [{ vatRateId: component.vatRateId }] : []
          ),
          availableStock: item.availableStock,
          tracksStock: item.tracksStock !== false,
          sellByFraction: item.sellByFraction === true,
          fractionStep: item.fractionStep,
          fractionMinimum: item.fractionMinimum,
          tracksSerials: item.tracksSerials === true,
          serialIds: [],
          serialSiteId: null,
          catalogUnitPrice: item.unitPrice,
          isBaseUnit: true,
          // The accepted value is never re-priced by a customer-tier change.
          priceEdited: true,
        }));

        useCartWorkspaceStore.getState().hydrateFromQuotation({
          ownerKey: `${currentTenant.id}:${user.id}`,
          quotationId: quotation.id,
          quotationNumber: quotation.quotationNumber,
          siteId: quotation.siteId,
          customerId: quotation.customerId,
          customerName: quotation.customerName,
          priceTier: quotation.priceTier,
          items,
        });
        toast.success({
          title: t('conversion.readyTitle'),
          description: t('conversion.readyDescription', {
            number: quotation.quotationNumber,
          }),
        });
        navigate('/sales');
      } catch (error) {
        toast.error({
          title: t('conversion.errorTitle'),
          description: translateServerError(error, t, t('errors:server.unknown')),
        });
      } finally {
        conversionInFlightRef.current = null;
        setConvertingQuotationId(null);
      }
    },
    [currentSite, currentTenant, navigate, t, toast, user, utils.quotations.getById]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-secondary-900">{t('page.title')}</h1>
        <button
          type="button"
          className="btn-primary inline-flex items-center gap-2"
          onClick={handleOpenCreate}
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('page.newAction')}
        </button>
      </div>

      <QuotationsHistoryTable
        onOpenDetails={handleOpenDetails}
        onConvertToSale={handleConvertToSale}
        convertingQuotationId={convertingQuotationId}
      />

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
