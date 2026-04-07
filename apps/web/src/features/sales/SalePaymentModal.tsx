import { useForm } from 'react-hook-form';
import { Modal, ModalButton } from '@/components/form-controls/Modal';
import { formatCurrency } from '@/lib/utils';
import type { Customer, PaymentMethod } from '@/types';

export interface SalePaymentValues {
  customerId: string;
  paymentMethod: PaymentMethod;
  amountReceived: number;
  notes: string;
}

interface SalePaymentModalProps {
  isOpen: boolean;
  total: number;
  customers: Customer[];
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (values: SalePaymentValues) => Promise<void>;
}

function getDefaultValues(total: number): SalePaymentValues {
  return {
    customerId: '',
    paymentMethod: 'cash',
    amountReceived: total,
    notes: '',
  };
}

export function SalePaymentModal({
  isOpen,
  total,
  customers,
  isSaving,
  error,
  onClose,
  onSubmit,
}: SalePaymentModalProps) {
  const form = useForm<SalePaymentValues>({
    defaultValues: getDefaultValues(total),
  });

  const handleSubmit = form.handleSubmit(onSubmit);
  const paymentMethod = form.watch('paymentMethod');
  const amountReceived = form.watch('amountReceived');
  const isCash = paymentMethod === 'cash';
  const change = isCash ? Math.max(0, amountReceived - total) : 0;
  const outstanding = Math.max(0, total - (amountReceived || 0));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Charge Sale"
      footer={
        <>
          <ModalButton onClick={onClose} disabled={isSaving}>
            Cancel
          </ModalButton>
          <ModalButton variant="primary" onClick={handleSubmit} disabled={isSaving}>
            {isSaving ? 'Processing...' : 'Confirm Sale'}
          </ModalButton>
        </>
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-4">
          <p className="text-sm text-primary-700">Sale total</p>
          <p className="mt-1 text-3xl font-semibold text-primary-900">{formatCurrency(total)}</p>
        </div>

        <div>
          <label htmlFor="sale-payment-customer" className="label">
            Customer
          </label>
          <select id="sale-payment-customer" className="input mt-1" {...form.register('customerId')}>
            <option value="">Walk-in customer</option>
            {customers.map(customer => (
              <option key={customer.id} value={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor="sale-payment-method" className="label">
              Payment method
            </label>
            <select
              id="sale-payment-method"
              className="input mt-1"
              {...form.register('paymentMethod')}
            >
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="transfer">Transfer</option>
              <option value="credit">Credit</option>
              <option value="other">Other</option>
            </select>
          </div>

          <div>
            <label htmlFor="sale-payment-amount" className="label">
              Amount received
            </label>
            <input
              id="sale-payment-amount"
              type="number"
              min={0}
              step="0.01"
              className="input mt-1"
              {...form.register('amountReceived', {
                valueAsNumber: true,
                min: { value: 0, message: 'Amount received cannot be negative' },
              })}
            />
            {form.formState.errors.amountReceived && (
              <p className="mt-1 text-sm text-danger-500">
                {form.formState.errors.amountReceived.message}
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-secondary-200 bg-secondary-50 px-4 py-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-secondary-500">Amount received</span>
            <span className="font-medium text-secondary-900">{formatCurrency(amountReceived || 0)}</span>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-secondary-500">{isCash ? 'Change' : 'Outstanding balance'}</span>
            <span className="font-medium text-secondary-900">
              {formatCurrency(isCash ? change : outstanding)}
            </span>
          </div>
        </div>

        <div>
          <label htmlFor="sale-payment-notes" className="label">
            Notes
          </label>
          <textarea
            id="sale-payment-notes"
            className="input mt-1 min-h-[96px]"
            placeholder="Optional comments for the sale"
            {...form.register('notes')}
          />
        </div>

        {error && <p className="text-sm text-danger-500">{error}</p>}
      </form>
    </Modal>
  );
}
