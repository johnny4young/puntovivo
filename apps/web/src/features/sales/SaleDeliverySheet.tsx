import { useId, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { useToast } from '@/components/feedback/ToastProvider';
import { DeliveryRecipientFields } from '@/features/delivery/DeliveryRecipientFields';
import { readDeliveryRecipient } from '@/features/delivery/deliveryRecipient';
import { trpc } from '@/lib/trpc';
import { translateServerError } from '@/lib/translateServerError';
import { useCriticalMutation } from '@/lib/useCriticalMutation';
import { formatCurrency } from '@/lib/utils';
import type { CompletedSaleSummary } from './SaleCompleteStrip';
import { useHardwareCopy } from './useHardwareCopy';

interface SaleDeliverySheetProps {
  siteId: string;
  /** Its customer fills in who receives and where. */
  sale: CompletedSaleSummary;
  /** `created` is true once the delivery exists. */
  onClose: (created: boolean) => void;
}

/** Sends a just-charged sale out as a delivery to the customer's job site. */
export default function SaleDeliverySheet({ siteId, sale, onClose }: SaleDeliverySheetProps) {
  const { t } = useTranslation(['delivery', 'errors', 'fulfillmentErrors']);
  const { t: th } = useHardwareCopy();
  const toast = useToast();
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const customerId = sale.customerId ?? null;
  const customer = trpc.customers.getById.useQuery(
    { id: customerId ?? '' },
    { enabled: !!customerId, staleTime: 60_000 }
  );
  const createFromSale = useCriticalMutation('deliveryOrders.createFromSale');
  // Uncontrolled inputs take their defaults once, so wait for the customer.
  const loadingCustomer = !!customerId && customer.isLoading;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (createFromSale.isPending) return;
    setError(null);
    const recipient = readDeliveryRecipient(new FormData(event.currentTarget));
    try {
      await createFromSale.mutateAsync({ siteId, saleId: sale.id, ...recipient });
      toast.success({
        title: th('delivery.created'),
        description: th('delivery.createdDetail', {
          saleNumber: sale.saleNumber,
          address: recipient.address,
        }),
      });
      onClose(true);
    } catch (failure) {
      setError(translateServerError(failure, t, t('create.error')));
    }
  }

  return (
    <Modal
      isOpen
      onClose={() => onClose(false)}
      title={th('delivery.title')}
      size="md"
      footerClassName="sm:justify-between"
      footer={
        <>
          <ModalButton onClick={() => onClose(false)}>{t('create.dismiss')}</ModalButton>
          <ModalButton
            variant="primary"
            pending={createFromSale.isPending}
            disabled={loadingCustomer}
            onClick={() => formRef.current?.requestSubmit()}
            testId="sale-delivery-submit"
          >
            {createFromSale.isPending ? t('create.saving') : t('create.submit')}
          </ModalButton>
        </>
      }
    >
      <form
        ref={formRef}
        onSubmit={submit}
        aria-label={th('delivery.title')}
        className="space-y-3"
        data-testid="sale-delivery-sheet"
      >
        <p className="font-semibold text-fg1">
          {th('delivery.sale', { saleNumber: sale.saleNumber, total: formatCurrency(sale.total) })}
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
        )}
        {!loadingCustomer && (
          <fieldset disabled={createFromSale.isPending} className="space-y-3">
            <DeliveryRecipientFields
              idPrefix={formId}
              defaults={{
                customerName: customer.data?.name ?? sale.customerName ?? undefined,
                customerPhone: customer.data?.phone ?? undefined,
                address: customer.data?.address ?? undefined,
              }}
            />
          </fieldset>
        )}
      </form>
    </Modal>
  );
}
