import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { formatCurrency } from '@/lib/utils';
import type { Provider } from '@/types';

export interface OrderFinalizeValues {
  providerId: string;
  notes: string;
}

interface OrderFinalizeModalProps {
  isOpen: boolean;
  total: number;
  providers: Provider[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: OrderFinalizeValues) => Promise<void>;
}

export function OrderFinalizeModal({
  isOpen,
  total,
  providers,
  isSaving,
  error,
  onClose,
  onSubmit,
}: OrderFinalizeModalProps) {
  const { t } = useTranslation('orders');
  const form = useForm<OrderFinalizeValues>({
    defaultValues: {
      providerId: '',
      notes: '',
    },
  });

  const handleSubmit = form.handleSubmit(onSubmit);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('checkout.createOrder')}
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Saving...' : t('checkout.createOrder')}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
          <p className="text-sm text-primary-700">Order total</p>
          <p className="mt-1 text-3xl font-semibold text-primary-900">{formatCurrency(total)}</p>
        </div>

        <div>
          <label htmlFor="order-provider" className="label">
            Provider
          </label>
          <select
            id="order-provider"
            className="input mt-1"
            {...form.register('providerId', {
              required: 'Provider is required',
            })}
          >
            <option value="">Select provider</option>
            {providers.map(provider => (
              <option key={provider.id} value={provider.id}>
                {provider.name}
              </option>
            ))}
          </select>
          {form.formState.errors.providerId && (
            <p className="mt-1 text-sm text-danger-500">{form.formState.errors.providerId.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="order-notes" className="label">
            Notes
          </label>
          <textarea
            id="order-notes"
            className="input mt-1 min-h-[96px]"
            placeholder="Optional supplier instructions or follow-up note"
            {...form.register('notes')}
          />
        </div>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
