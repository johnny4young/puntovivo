import { useForm } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { formatCurrency } from '@/lib/utils';
import type { Order } from '@/types';

interface OrderReceiveFormValues {
  items: Array<{
    orderItemId: string;
    quantity: number;
  }>;
  notes: string;
}

export interface OrderReceiveValues {
  items: Array<{
    orderItemId: string;
    quantity: number;
  }>;
  notes: string;
}

interface OrderReceiveModalProps {
  isOpen: boolean;
  order: Order;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: OrderReceiveValues) => Promise<void>;
}

export function OrderReceiveModal({
  isOpen,
  order,
  isSaving,
  error,
  onClose,
  onSubmit,
}: OrderReceiveModalProps) {
  const form = useForm<OrderReceiveFormValues>({
    defaultValues: {
      items: (order.items ?? []).map(item => ({
        orderItemId: item.id,
        quantity: 0,
      })),
      notes: '',
    },
  });

  const handleSubmit = form.handleSubmit(async values => {
    const selectedItems = values.items.filter(item => Number(item.quantity) > 0);

    if (selectedItems.length === 0) {
      form.setError('root', {
        type: 'manual',
        message: 'Select at least one line quantity to receive',
      });
      return;
    }

    await onSubmit({
      items: selectedItems.map(item => ({
        orderItemId: item.orderItemId,
        quantity: Number(item.quantity),
      })),
      notes: values.notes,
    });
  });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Receive Items for ${order.orderNumber}`}
      size="xl"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Create Receipt'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
          <p className="text-sm text-primary-700">
            Receive only the quantities that physically entered stock in this delivery.
          </p>
        </div>

        <div className="space-y-3">
          {(order.items ?? []).map((item, index) => {
            const receivedQuantity = item.receivedQuantity ?? 0;
            const remainingQuantity = item.remainingQuantity ?? item.quantity;
            const fieldError = form.formState.errors.items?.[index]?.quantity?.message;

            return (
              <div key={item.id} className="rounded-xl border border-secondary-200 px-4 py-4">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <p className="text-sm font-medium text-secondary-900">
                      {item.productName ?? item.productId}
                    </p>
                    <p className="text-xs text-secondary-500">
                      {item.productSku ?? 'No SKU'}
                      {' · '}
                      {item.unitName ?? item.unitAbbreviation ?? item.unitId}
                    </p>
                    <p className="mt-2 text-sm text-secondary-600">
                      Cost {formatCurrency(item.costPerUnit)} each
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-lg bg-secondary-50 px-3 py-2 text-sm">
                      <p className="text-secondary-500">Ordered</p>
                      <p className="font-medium text-secondary-900">{item.quantity}</p>
                    </div>
                    <div className="rounded-lg bg-secondary-50 px-3 py-2 text-sm">
                      <p className="text-secondary-500">Received</p>
                      <p className="font-medium text-secondary-900">{receivedQuantity}</p>
                    </div>
                    <div className="rounded-lg bg-secondary-50 px-3 py-2 text-sm">
                      <p className="text-secondary-500">Pending</p>
                      <p className="font-medium text-secondary-900">{remainingQuantity}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 max-w-[180px]">
                  <label htmlFor={`order-receive-${item.id}`} className="label">
                    Receive Quantity
                  </label>
                  <input
                    id={`order-receive-${item.id}`}
                    type="number"
                    min={0}
                    max={remainingQuantity}
                    className="input mt-1"
                    disabled={remainingQuantity <= 0}
                    {...form.register(`items.${index}.quantity`, {
                      valueAsNumber: true,
                      min: {
                        value: 0,
                        message: 'Received quantity cannot be negative',
                      },
                      validate: value =>
                        value <= remainingQuantity ||
                        `Only ${remainingQuantity} units remain pending receipt`,
                    })}
                  />
                  {fieldError && <p className="mt-1 text-sm text-danger-500">{fieldError}</p>}
                </div>
              </div>
            );
          })}
        </div>

        <div>
          <label htmlFor="order-receive-notes" className="label">
            Receipt Notes
          </label>
          <textarea
            id="order-receive-notes"
            className="input mt-1 min-h-[96px]"
            placeholder="Optional note about this delivery batch"
            {...form.register('notes')}
          />
        </div>

        {(form.formState.errors.root?.message || error) && (
          <p className="text-sm text-danger-500">
            {form.formState.errors.root?.message ?? error}
          </p>
        )}
      </form>
    </Modal>
  );
}
